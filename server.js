import 'dotenv/config';
import express            from 'express';
import fs                 from 'fs';
import path               from 'path';
import crypto             from 'crypto';
import { fileURLToPath }  from 'url';
import { Resend }         from 'resend';
import webpush            from 'web-push';

import { generateStream }                                    from './core/model.js';
import { extractMemories, memoriesAsContext, readMemories }  from './core/memory.js';
import { buildSystemPrompt, checkProactive }                 from './core/agent.js';
import { startCrawl, stopCrawl, isCrawling }                 from './crawler/crawler.js';
import { initReminders, extractReminder }                    from './core/reminders.js';
import { webSearch, formatSearchResults }                    from './core/search.js';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app       = express();
const resend    = new Resend(process.env.RESEND_API_KEY);

// VAPID — gere com: npx web-push generate-vapid-keys
webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_EMAIL || 'mind@mind.app'),
  process.env.VAPID_PUBLIC_KEY  || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

app.use(express.json());

// CORS
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─────────────────────────────────────────
//  PUSH NOTIFICATIONS
// ─────────────────────────────────────────
function subFile(userId) { return path.join(userDir(userId), 'push.json'); }
function getSubs(userId) { return readJSON(subFile(userId), []); }
function saveSubs(userId, subs) { writeJSON(subFile(userId), subs); }

export async function sendPush(userId, title, body) {
  const subs    = getSubs(userId);
  const payload = JSON.stringify({ title, body });
  const results = await Promise.allSettled(subs.map(s => webpush.sendNotification(s, payload)));
  const valid   = subs.filter((_, i) => results[i].status === 'fulfilled');
  if (valid.length !== subs.length) saveSubs(userId, valid);
}

// Inicializa reminders com acesso ao sendPush e à pasta de usuários
const USERS_DIR = path.join(__dirname, 'users');
fs.mkdirSync(USERS_DIR, { recursive: true });
initReminders(USERS_DIR, sendPush);

// GET /push/vapid-key
app.get('/push/vapid-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

// POST /push/subscribe
app.post('/push/subscribe', requireAuth, (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'subscription inválida' });
  const subs = getSubs(req.user.id);
  if (!subs.some(s => s.endpoint === sub.endpoint)) { subs.push(sub); saveSubs(req.user.id, subs); }
  res.json({ ok: true });
});

// POST /push/test
app.post('/push/test', requireAuth, async (req, res) => {
  try {
    await sendPush(req.user.id, 'Mind 🧠', 'OIII!! as notificações tão funcionando 💜');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function userDir(userId)          { return path.join(USERS_DIR, userId); }

function readJSON(filePath, fallback = null) {
  try   { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ─────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────
const pendingCodes = new Map();
const sessions     = new Map();

function getUsers()          { return readJSON(path.join(USERS_DIR, 'users.json'), []); }
function saveUsers(users)    { writeJSON(path.join(USERS_DIR, 'users.json'), users); }
function findUserByEmail(e)  { return getUsers().find(u => u.email === e) || null; }
function findUserById(id)    { return getUsers().find(u => u.id === id)   || null; }

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, userId);
  return token;
}
function getSession(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  return sessions.get(token) || null;
}
function requireAuth(req, res, next) {
  const userId = getSession(req);
  if (!userId) return res.status(401).json({ error: 'não autenticado' });
  const user = findUserById(userId);
  if (!user)   return res.status(401).json({ error: 'usuário não encontrado' });
  req.user = user;
  next();
}

// POST /auth/send-code
app.post('/auth/send-code', async (req, res) => {
  const { email, mode } = req.body;
  if (!email) return res.status(400).json({ error: 'email obrigatório' });

  const userExists = !!findUserByEmail(email);
  if (mode === 'login'    && !userExists) return res.status(404).json({ error: 'email não cadastrado' });
  if (mode === 'register' &&  userExists) return res.status(409).json({ error: 'email já cadastrado' });

  const code      = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000;
  pendingCodes.set(email, { code, expiresAt, mode });

  console.log(`\n🔑 CÓDIGO PARA ${email}: ${code}\n`);

  await resend.emails.send({
    from: 'Mind <onboarding@resend.dev>',
    to: email,
    subject: 'Seu código Mind',
    html: `
      <div style="background:#0D0D0F;color:#F0EEF8;font-family:sans-serif;padding:40px;border-radius:12px;max-width:400px;margin:0 auto">
        <h2 style="font-size:22px;margin-bottom:8px">🧠 Mind</h2>
        <p style="color:#8A87A0;margin-bottom:24px">Seu código de verificação:</p>
        <div style="background:#1C1C20;border:1px solid #2D1F4E;border-radius:10px;padding:24px;text-align:center;font-size:36px;font-weight:600;letter-spacing:10px;color:#9B6DFF">${code}</div>
        <p style="color:#4A4760;font-size:12px;margin-top:20px">Expira em 10 minutos. Se não foi você, ignore este email.</p>
      </div>`,
  });

  res.json({ ok: true });
});

// POST /auth/check-code
app.post('/auth/check-code', (req, res) => {
  const { email, code } = req.body;
  const pending = pendingCodes.get(email);
  if (!pending)                       return res.status(400).json({ error: 'nenhum código pendente' });
  if (Date.now() > pending.expiresAt) { pendingCodes.delete(email); return res.status(400).json({ error: 'código expirado' }); }
  if (pending.code !== String(code))  return res.status(400).json({ error: 'código incorreto' });
  res.json({ ok: true });
});

// POST /auth/verify-code
app.post('/auth/verify-code', (req, res) => {
  const { email, code, username } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'campos obrigatórios' });

  const pending = pendingCodes.get(email);
  if (!pending)                       return res.status(400).json({ error: 'nenhum código pendente' });
  if (Date.now() > pending.expiresAt) { pendingCodes.delete(email); return res.status(400).json({ error: 'código expirado' }); }
  if (pending.code !== String(code))  return res.status(400).json({ error: 'código incorreto' });

  pendingCodes.delete(email);
  let user = findUserByEmail(email);

  if (pending.mode === 'register') {
    if (!username) return res.status(400).json({ error: 'username obrigatório no cadastro' });
    user = { id: crypto.randomUUID(), email, username, photo: null, criadoEm: new Date().toISOString() };
    const users = getUsers();
    users.push(user);
    saveUsers(users);
    fs.mkdirSync(userDir(user.id), { recursive: true });
    writeJSON(path.join(userDir(user.id), 'conversations.json'), []);
  }

  const token = createSession(user.id);
  res.json({ ok: true, token, user: { id: user.id, username: user.username, photo: user.photo } });
});

// POST /auth/logout
app.post('/auth/logout', requireAuth, (req, res) => {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  sessions.delete(token);
  res.json({ ok: true });
});

// ─────────────────────────────────────────
//  PERFIL
// ─────────────────────────────────────────
app.get('/me', requireAuth, (req, res) => {
  const { id, username, email, photo } = req.user;
  res.json({ id, username, email, photo });
});

app.put('/me', requireAuth, (req, res) => {
  const { username, photo } = req.body;
  const users = getUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'usuário não encontrado' });
  if (username)            users[idx].username = username;
  if (photo !== undefined) users[idx].photo    = photo;
  saveUsers(users);
  res.json({ ok: true, user: users[idx] });
});

// ─────────────────────────────────────────
//  MEMÓRIAS
// ─────────────────────────────────────────

// GET /memories — retorna memórias do usuário
app.get('/memories', requireAuth, (req, res) => {
  const memories = readMemories(USERS_DIR, req.user.id);
  res.json(memories);
});

// DELETE /memories/:id — apaga uma memória específica
app.delete('/memories/:id', requireAuth, (req, res) => {
  const file     = path.join(userDir(req.user.id), 'memory.json');
  const memories = readMemories(USERS_DIR, req.user.id);
  const filtered = memories.filter(m => m.id !== req.params.id);
  if (filtered.length === memories.length) return res.status(404).json({ error: 'memória não encontrada' });
  writeJSON(file, filtered);
  res.json({ ok: true });
});

// ─────────────────────────────────────────
//  CONVERSAS
// ─────────────────────────────────────────
function getConvFile(userId) { return path.join(userDir(userId), 'conversations.json'); }
function getConvs(userId)    { return readJSON(getConvFile(userId), []); }
function saveConvs(userId, convs) { writeJSON(getConvFile(userId), convs); }

app.get('/conversations', requireAuth, (req, res) => {
  const convs = getConvs(req.user.id).map(({ id, titulo, atualizadoEm, messages }) => ({
    id, titulo, atualizadoEm,
    preview: messages.at(-1)?.text?.slice(0, 40) || '',
  }));
  res.json(convs);
});

app.post('/conversations', requireAuth, (req, res) => {
  const conv = {
    id:           crypto.randomUUID(),
    titulo:       req.body.titulo || 'Nova conversa',
    criadoEm:    new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    messages:     [],
  };
  const convs = getConvs(req.user.id);
  convs.unshift(conv);
  saveConvs(req.user.id, convs);
  res.json(conv);
});

app.get('/conversations/:id/messages', requireAuth, (req, res) => {
  const conv = getConvs(req.user.id).find(c => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'conversa não encontrada' });
  res.json({ messages: conv.messages });
});

app.put('/conversations/:id', requireAuth, (req, res) => {
  const convs = getConvs(req.user.id);
  const conv  = convs.find(c => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'conversa não encontrada' });
  if (req.body.titulo) conv.titulo = req.body.titulo;
  saveConvs(req.user.id, convs);
  res.json({ ok: true });
});

app.delete('/conversations/:id', requireAuth, (req, res) => {
  let convs = getConvs(req.user.id);
  const antes = convs.length;
  convs = convs.filter(c => c.id !== req.params.id);
  if (convs.length === antes) return res.status(404).json({ error: 'conversa não encontrada' });
  saveConvs(req.user.id, convs);
  res.json({ ok: true });
});

// ─────────────────────────────────────────
//  CHAT COM STREAMING + WEB SEARCH
// ─────────────────────────────────────────

// Definição da ferramenta pra o Groq
const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Busca informações atuais na web. Use quando precisar de dados recentes, fatos específicos, preços, notícias, ou qualquer coisa que possa ter mudado.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termo de busca em português ou inglês' },
      },
      required: ['query'],
    },
  },
};

const NEARBY_TOOL = {
  type: 'function',
  function: {
    name: 'nearby_search',
    description: 'Busca lugares próximos à localização atual do usuário (restaurantes, padarias, farmácias, etc). Use quando o usuário perguntar sobre lugares perto dele.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Tipo do lugar em inglês: bakery, restaurant, pharmacy, supermarket, hospital, bank, gas_station, gym, etc' },
        keyword: { type: 'string', description: 'Palavra-chave opcional pra refinar (ex: lanchonete, pizza)' },
        radius: { type: 'number', description: 'Raio em metros (padrão 1000)' },
      },
      required: ['type'],
    },
  },
};

async function nearbySearch(lat, lon, type, keyword = '', radius = 1500) {
  try {
    // tenta amenity primeiro, depois shop (padaria = shop=bakery no OSM)
    const shopMap = { bakery: 'bakery', supermarket: 'supermarket', convenience: 'convenience' };
    const isShop  = shopMap[type];
    const tagA    = isShop ? `shop=${isShop}` : `amenity=${type}`;
    const tagB    = `amenity=${type}`;

    const buildQ = tag =>
      `[out:json][timeout:15];(node[${tag}](around:${radius},${lat},${lon});way[${tag}](around:${radius},${lat},${lon}););out center 10;`;

    console.log(`[nearby] lat=${lat} lon=${lon} type=${type} radius=${radius}`);

    let data;
    const res1 = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(buildQ(tagA))}`,
    });
    data = await res1.json();

    // se não achou com a primeira tag, tenta a segunda
    if (!data.elements?.length && isShop) {
      const res2 = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(buildQ(tagB))}`,
      });
      data = await res2.json();
    }

    console.log(`[nearby] encontrou ${data.elements?.length || 0} resultados`);
    const elements = (data.elements || []).slice(0, 6);
    if (!elements.length) return `Não encontrei ${type} num raio de ${radius}m. O OpenStreetMap pode não ter mapeado essa área ainda.`;

    return elements.map(e => {
      const name = e.tags?.name || 'Sem nome';
      const addr = [e.tags?.['addr:street'], e.tags?.['addr:housenumber']].filter(Boolean).join(', ');
      const lat2 = e.lat || e.center?.lat;
      const lon2 = e.lon || e.center?.lon;
      const mapsUrl = lat2 ? `https://maps.google.com/?q=${lat2},${lon2}` : '';
      return `• ${name}${addr ? ' — ' + addr : ''}${mapsUrl ? '\n  ' + mapsUrl : ''}`;
    }).join('\n');
  } catch (e) {
    console.error('[nearby] erro:', e.message);
    return 'Não consegui buscar lugares próximos agora.';
  }
}

app.post('/conversations/:id/chat', requireAuth, async (req, res) => {
  const convs = getConvs(req.user.id);
  const conv  = convs.find(c => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'conversa não encontrada' });

  const { messages: clientMsgs } = req.body;
  if (!clientMsgs?.length) return res.status(400).json({ error: 'messages obrigatório' });

  // Verifica se é um pedido de lembrete
  const lastUserMsg = [...clientMsgs].reverse().find(m => m.role === 'user');
  if (lastUserMsg) {
    const confirmação = await extractReminder(req.user.id, req.user.username, lastUserMsg.text).catch(() => null);
    if (confirmação) {
      conv.messages = [
        ...clientMsgs,
        { role: 'mind', text: confirmação, time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
      ];
      conv.atualizadoEm = new Date().toISOString();
      saveConvs(req.user.id, convs);
      return res.json({ type: 'done', text: confirmação });
    }
  }

  // Monta system prompt com memórias
  const memCtx = memoriesAsContext(USERS_DIR, req.user.id);
  const loc    = readLoc(req.user.id);
  const locCtx = loc.enabled && loc.lat ? {
    label: loc.place || 'desconhecida',
    lat:   loc.lat,
    lon:   loc.lon,
  } : null;
  const sysPrompt = buildSystemPrompt(req.user.username, memCtx, locCtx);

  const groqMsgs = [
    { role: 'system', content: sysPrompt },
    ...clientMsgs.map(m => ({
      role:    m.role === 'mind' ? 'assistant' : 'user',
      content: m.text,
    })),
  ];

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (type, payload) =>
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  try {
    // Primeira chamada — com ferramentas disponíveis
    const tools = [SEARCH_TOOL];
    if (locCtx) tools.push(NEARBY_TOOL); // só oferece busca próxima se tem localização

    const firstCall = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages:    groqMsgs,
      tools,
      tool_choice: 'auto',
      max_tokens:  1024,
      temperature: 0.85,
    });

    const firstChoice = firstCall.choices[0];

    if (firstChoice.finish_reason === 'tool_calls') {
      const toolCall = firstChoice.message.tool_calls[0];
      const args     = JSON.parse(toolCall.function.arguments);
      let   resultText;

      if (toolCall.function.name === 'nearby_search') {
        if (!locCtx) {
          resultText = 'Localização não disponível.';
        } else {
          send('status', { text: `📍 buscando ${args.keyword || args.type} próximo...` });
          resultText = await nearbySearch(locCtx.lat, locCtx.lon, args.type, args.keyword, args.radius || 1000);
        }
      } else {
        // web_search
        send('status', { text: `🔍 pesquisando "${args.query}"...` });
        const results = await webSearch(args.query);
        resultText    = formatSearchResults(results);
      }

      console.log(`[tool] ${toolCall.function.name}:`, args);

      // Segunda chamada — com resultado da busca, agora em streaming
      const msgsComBusca = [
        ...groqMsgs,
        firstChoice.message, // msg do assistant com tool_calls
        {
          role:         'tool',
          tool_call_id: toolCall.id,
          content:      resultText,
        },
      ];

      const stream = await groq.chat.completions.create({
        model:       'llama-3.3-70b-versatile',
        messages:    msgsComBusca,
        stream:      true,
        max_tokens:  1024,
        temperature: 0.85,
      });

      let fullText = '';
      for await (const chunk of stream) {
        if (res.writableEnded) break;
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) { fullText += delta; send('delta', { text: delta }); }
      }

      if (!res.writableEnded && fullText) {
        salvarEExtrair(conv, convs, clientMsgs, fullText, req.user, send);
      }

    } else {
      // Modelo não quis buscar — stream normal da resposta já gerada
      // (o texto já veio completo, só streamamos token a token pra manter UX)
      const content = firstChoice.message?.content || '';
      if (content) {
        // simula streaming char a char em chunks de ~4 chars
        const CHUNK = 4;
        for (let i = 0; i < content.length; i += CHUNK) {
          if (res.writableEnded) break;
          send('delta', { text: content.slice(i, i + CHUNK) });
          await new Promise(r => setTimeout(r, 8));
        }
        if (!res.writableEnded) salvarEExtrair(conv, convs, clientMsgs, content, req.user, send);
      }
    }

    res.end();
  } catch (err) {
    console.error('Chat error:', err.message);
    if (!res.writableEnded) { send('error', { message: 'Erro ao gerar resposta' }); res.end(); }
  }
});

function salvarEExtrair(conv, convs, clientMsgs, fullText, user, send) {
  conv.messages = [
    ...clientMsgs,
    { role: 'mind', text: fullText, time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
  ];
  conv.atualizadoEm = new Date().toISOString();
  saveConvs(user.id, convs);
  send('done', { text: fullText });

  // extrai memórias silencioso
  const lastUserIdx = [...clientMsgs].map((m,i) => m.role==='user'?i:-1).filter(i=>i>=0).at(-1);
  if (lastUserIdx !== undefined) {
    const snapshot = [
      ...clientMsgs.slice(Math.max(0, lastUserIdx - 3), lastUserIdx + 1),
      { role: 'mind', text: fullText, time: new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) },
    ];
    extractMemories(USERS_DIR, user.id, user.username, clientMsgs[lastUserIdx].text, snapshot)
      .catch(e => console.error('[memory]', e.message));
  }
}

// ─────────────────────────────────────────
//  CRAWLER
// ─────────────────────────────────────────

// POST /crawler/start  — { url, maxPages? }
app.post('/crawler/start', requireAuth, (req, res) => {
  const { url, maxPages } = req.body;
  if (!url) return res.status(400).json({ error: 'url obrigatória' });
  if (isCrawling()) return res.status(409).json({ error: 'crawler já em execução' });

  // Roda em background — não bloqueia a resposta
  startCrawl(url, maxPages || 500)
    .catch(e => console.error('[crawler]', e.message));

  res.json({ ok: true, message: `crawler iniciado em ${url}` });
});

// POST /crawler/stop
app.post('/crawler/stop', requireAuth, (req, res) => {
  stopCrawl();
  res.json({ ok: true });
});

// GET /crawler/status
app.get('/crawler/status', requireAuth, (req, res) => {
  const knowledgePath = path.join(__dirname, 'data', 'knowledge.json');
  let count = 0;
  try {
    const k = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
    count = k.length;
  } catch { /* ainda vazio */ }

  res.json({ running: isCrawling(), pagesIndexed: count });
});

// ─────────────────────────────────────────
//  LOCALIZAÇÃO
// ─────────────────────────────────────────

function locFile(userId)   { return path.join(userDir(userId), 'location.json'); }
function locPlaceFile(uid) { return path.join(userDir(uid),    'places.json'); }

function readLoc(userId)    { return readJSON(locFile(userId),    { enabled: false, lat: null, lon: null, place: null, updatedAt: null }); }
function readPlaces(userId) { return readJSON(locPlaceFile(userId), []); }

// distância em metros entre dois pontos
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// resolve o nome do lugar via Nominatim (sem chave)
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=pt`;
    console.log(`[geocode] ${url}`);
    const res  = await fetch(url, { headers: { 'User-Agent': 'MindApp/1.0' } });
    const data = await res.json();
    console.log(`[geocode] resultado:`, JSON.stringify(data.address || data.error));
    const addr = data.address || {};
    const bairro  = addr.neighbourhood || addr.quarter || addr.suburb || '';
    const cidade  = addr.town || addr.city || addr.city_district || '';
    const estado  = addr.state || '';
    const partes  = [bairro, cidade, estado].filter(Boolean);
    return partes.join(', ') || 'lugar desconhecido';
  } catch (e) { console.error('[geocode] erro:', e.message); return null; }
}

// detecta o tipo do lugar atual baseado nos lugares salvos
function detectPlaceType(userId, lat, lon) {
  if (!lat || !lon) return 'unknown';
  const places = readPlaces(userId);
  const RADIUS = 200; // metros
  for (const p of places) {
    if (haversine(lat, lon, p.lat, p.lon) <= RADIUS) return p.type;
  }
  // detecta hora — madrugada = dormindo
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 7) return 'sleeping';
  return 'unknown';
}

// POST /location — frontend manda coords a cada 5min
app.post('/location', requireAuth, async (req, res) => {
  const { lat, lon, enabled } = req.body;
  console.log(`[location] userId=${req.user.id} lat=${lat} lon=${lon} enabled=${enabled}`);
  const loc = readLoc(req.user.id);

  if (!enabled) {
    writeJSON(locFile(req.user.id), { ...loc, enabled: false });
    return res.json({ ok: true });
  }

  let placeName = null;
  if (lat && lon) {
    placeName = await reverseGeocode(lat, lon);
    writeJSON(locFile(req.user.id), {
      enabled: true, lat, lon,
      place:     placeName,
      type:      detectPlaceType(req.user.id, lat, lon),
      updatedAt: new Date().toISOString(),
    });
  }

  res.json({ ok: true, place: placeName });
});

// GET /location/places
app.get('/location/places', requireAuth, (req, res) => {
  res.json(readPlaces(req.user.id));
});

// POST /location/places — salva um lugar
app.post('/location/places', requireAuth, (req, res) => {
  const { lat, lon, name, type } = req.body;
  if (!lat || !lon || !name) return res.status(400).json({ error: 'campos obrigatórios' });
  const places = readPlaces(req.user.id);
  places.push({ id: crypto.randomUUID(), lat, lon, name, type: type || 'other' });
  writeJSON(locPlaceFile(req.user.id), places);
  res.json({ ok: true });
});

// DELETE /location/places/:id
app.delete('/location/places/:id', requireAuth, (req, res) => {
  const places = readPlaces(req.user.id).filter(p => p.id !== req.params.id);
  writeJSON(locPlaceFile(req.user.id), places);
  res.json({ ok: true });
});

// ─────────────────────────────────────────
//  LOOP PROATIVO (verifica a cada 1h)
// ─────────────────────────────────────────
setInterval(async () => {
  const users = getUsers();
  for (const user of users) {
    try {
      // checa localização antes de tudo
      const loc  = readLoc(user.id);
      const type = loc.enabled ? detectPlaceType(user.id, loc.lat, loc.lon) : 'unknown';

      // silencia completamente em trabalho/escola ou madrugada
      if (type === 'work' || type === 'sleeping') {
        console.log(`[agent] silenciado para ${user.username} (${type})`);
        continue;
      }

      const msg = await checkProactive(USERS_DIR, user.id, user.username);
      if (!msg) continue;

      console.log(`[agent] proativo para ${user.username}: ${msg}`);

      // em lugar desconhecido ou academia — só push, sem injetar na conversa
      if (type === 'unknown' || type === 'gym') {
        await sendPush(user.id, 'Mind 🧠', msg).catch(() => {});
        continue;
      }

      // em casa (home) ou outro lugar normal — push + injeta na conversa
      await sendPush(user.id, 'Mind 🧠', msg).catch(() => {});

      const convs   = getConvs(user.id);
      const time    = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const mindMsg = { role: 'mind', text: msg, time, proactive: true };

      if (convs.length > 0) {
        convs[0].messages.push(mindMsg);
        convs[0].atualizadoEm = new Date().toISOString();
      } else {
        convs.unshift({
          id:           crypto.randomUUID(),
          titulo:       'Mind entrou em contato',
          criadoEm:    new Date().toISOString(),
          atualizadoEm: new Date().toISOString(),
          messages:     [mindMsg],
        });
      }
      saveConvs(user.id, convs);

    } catch (e) {
      console.error('[agent] erro proativo:', e.message);
    }
  }
}, 60 * 60 * 1000);

// ─────────────────────────────────────────
//  START
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🧠 Mind rodando em http://localhost:${PORT}\n`);
});
