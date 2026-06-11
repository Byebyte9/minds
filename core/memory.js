import fs   from 'fs';
import path  from 'path';
import { generate } from './model.js';

/**
 * Retorna o caminho do arquivo de memórias do usuário
 */
function memoryFile(usersDir, userId) {
  return path.join(usersDir, userId, 'memory.json');
}

/**
 * Lê as memórias salvas de um usuário
 * @returns {Array} lista de memórias
 */
export function readMemories(usersDir, userId) {
  try {
    return JSON.parse(fs.readFileSync(memoryFile(usersDir, userId), 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Salva uma nova memória pra um usuário
 */
function saveMemory(usersDir, userId, memory) {
  const file = memoryFile(usersDir, userId);
  const memories = readMemories(usersDir, userId);

  // Evita duplicatas muito parecidas (comparação simples)
  const exists = memories.some(m =>
    m.content.toLowerCase() === memory.content.toLowerCase()
  );
  if (exists) return;

  memories.push({
    id:        crypto.randomUUID(),
    content:   memory.content,
    category:  memory.category || 'geral',
    criadoEm: new Date().toISOString(),
  });

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(memories, null, 2), 'utf8');
}

/**
 * Analisa a última mensagem do usuário e extrai memórias relevantes.
 * Roda silenciosamente após cada resposta do Mind.
 */
export async function extractMemories(usersDir, userId, username, userMessage) {
  const prompt = `Analise a mensagem abaixo de ${username} e extraia APENAS fatos pessoais relevantes para lembrar no futuro.

Exemplos do que extrair:
- datas e eventos ("tem uma consulta na sexta")
- preferências ("gosta de café forte")
- projetos em andamento ("tá construindo um app chamado Mind")
- informações pessoais ("mora em São Paulo", "pratica Umbanda")
- intenções ("quer aprender Yorubá")

Responda SOMENTE em JSON válido, sem texto extra, no formato:
[
  { "content": "fato extraído", "category": "data|preferencia|projeto|pessoal|intencao" }
]

Se não houver nada relevante para lembrar, responda com: []

Mensagem: "${userMessage}"`;

  try {
    const raw = await generate([{ role: 'user', content: prompt }], {
      temperature: 0.2,
      max_tokens: 512,
    });

    const clean = raw.replace(/```json|```/g, '').trim();
    const extracted = JSON.parse(clean);

    if (Array.isArray(extracted)) {
      for (const mem of extracted) {
        if (mem.content) saveMemory(usersDir, userId, mem);
      }
    }
  } catch (err) {
    // Falha silenciosa — não quebra o chat
    console.error('[memory] erro ao extrair:', err.message);
  }
}

/**
 * Formata as memórias como contexto pro system prompt
 */
export function memoriesAsContext(usersDir, userId) {
  const memories = readMemories(usersDir, userId);
  if (!memories.length) return '';

  const lines = memories.map(m => `- ${m.content}`).join('\n');
  return `\nO que você já sabe sobre o usuário:\n${lines}\n`;
}
