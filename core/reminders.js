import fs   from 'fs';
import path  from 'path';
import { generate } from './model.js';

let USERS_DIR  = '';
let pushFn     = null; // injetado pelo server.js

export function initReminders(usersDir, sendPushFn) {
  USERS_DIR = usersDir;
  pushFn    = sendPushFn;
  reloadAllReminders();
}

// ─────────────────────────────────────────
//  PERSISTÊNCIA
// ─────────────────────────────────────────
function remindersFile(userId) {
  return path.join(USERS_DIR, userId, 'reminders.json');
}

function readReminders(userId) {
  try   { return JSON.parse(fs.readFileSync(remindersFile(userId), 'utf8')); }
  catch { return []; }
}

function saveReminders(userId, reminders) {
  const file = remindersFile(userId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(reminders, null, 2), 'utf8');
}

// ─────────────────────────────────────────
//  TIMERS ATIVOS (em memória)
// ─────────────────────────────────────────
const activeTimers = new Map(); // reminderId → timeout handle

function scheduleTimer(userId, reminder) {
  const delay = new Date(reminder.fireAt).getTime() - Date.now();
  if (delay <= 0) {
    fireReminder(userId, reminder);
    return;
  }
  const handle = setTimeout(() => fireReminder(userId, reminder), delay);
  activeTimers.set(reminder.id, handle);
}

async function fireReminder(userId, reminder) {
  activeTimers.delete(reminder.id);

  // Marca como disparado
  const reminders = readReminders(userId);
  const idx = reminders.findIndex(r => r.id === reminder.id);
  if (idx !== -1) {
    reminders[idx].fired = true;
    saveReminders(userId, reminders);
  }

  // Envia push
  if (pushFn) {
    await pushFn(userId, 'Mind 🧠', reminder.text).catch(() => {});
  }

  console.log(`[reminders] disparado para ${userId}: ${reminder.text}`);
}

// Ao iniciar o servidor, recarrega lembretes pendentes que ainda não dispararam
function reloadAllReminders() {
  if (!USERS_DIR || !fs.existsSync(USERS_DIR)) return;
  const userFolders = fs.readdirSync(USERS_DIR);
  for (const userId of userFolders) {
    const reminders = readReminders(userId).filter(r => !r.fired);
    for (const r of reminders) scheduleTimer(userId, r);
  }
  console.log('[reminders] lembretes recarregados');
}

// ─────────────────────────────────────────
//  EXTRAÇÃO DE LEMBRETE VIA LLM
// ─────────────────────────────────────────

/**
 * Analisa uma mensagem e verifica se é um pedido de lembrete.
 * Se for, agenda e retorna a mensagem de confirmação do Mind.
 * Se não for, retorna null.
 */
export async function extractReminder(userId, username, userMessage) {
  const now = new Date();
  const nowStr = now.toLocaleString('pt-BR');

  const prompt = `Agora são ${nowStr}.

O usuário "${username}" enviou: "${userMessage}"

Verifique se essa mensagem é um pedido de lembrete (ex: "me lembra daqui X minutos", "me avisa em 1 hora", "lembra de mim amanhã às 9h").

Se FOR um lembrete, responda SOMENTE com JSON:
{
  "isReminder": true,
  "fireAt": "ISO 8601 datetime",
  "text": "mensagem curta e natural do lembrete (ex: 'ei, você pediu pra fazer o café!')",
  "confirmação": "resposta curta e casual do Mind confirmando o lembrete"
}

Se NÃO for um lembrete, responda SOMENTE com:
{ "isReminder": false }

Sem texto extra, sem markdown.`;

  try {
    const raw   = await generate([{ role: 'user', content: prompt }], { temperature: 0.1, max_tokens: 200 });
    const clean = raw.replace(/```json|```/g, '').trim();
    const data  = JSON.parse(clean);

    if (!data.isReminder) return null;

    // Cria e salva o lembrete
    const reminder = {
      id:        crypto.randomUUID(),
      text:      data.text,
      fireAt:    data.fireAt,
      criadoEm: now.toISOString(),
      fired:     false,
    };

    const reminders = readReminders(userId);
    reminders.push(reminder);
    saveReminders(userId, reminders);
    scheduleTimer(userId, reminder);

    console.log(`[reminders] agendado para ${username}: "${data.text}" em ${data.fireAt}`);
    return data.confirmação || 'Anotado! Vou te lembrar. 💜';

  } catch (err) {
    console.error('[reminders] erro ao extrair:', err.message);
    return null;
  }
}
