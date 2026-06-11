import { readMemories } from './memory.js';
import { generate }     from './model.js';

/**
 * O agente verifica as memórias do usuário e decide
 * se tem algo relevante pra notificar proativamente.
 *
 * Roda periodicamente (ex: a cada hora via setInterval no server.js)
 *
 * @param {string} usersDir
 * @param {string} userId
 * @param {string} username
 * @returns {Promise<string|null>} mensagem pra enviar, ou null se não tiver nada
 */
export async function checkProactive(usersDir, userId, username) {
  const memories = readMemories(usersDir, userId);
  if (!memories.length) return null;

  const today = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  const memList = memories.map(m => `- [${m.category}] ${m.content}`).join('\n');

  const prompt = `Você é o Mind, assistente pessoal de ${username}.
Hoje é ${today}.

Memórias que você tem sobre ${username}:
${memList}

Analise essas memórias e decida se há algo relevante pra mencionar HOJE proativamente.
Exemplos: um evento próximo, uma intenção que a pessoa mencionou e pode ter esquecido, um check-in natural.

Se houver algo relevante, escreva UMA mensagem curta e casual, do jeito que o Mind fala (caloroso, direto, em português brasileiro).
Se não houver nada relevante pra hoje, responda exatamente: NULL

Responda apenas com a mensagem ou NULL.`;

  try {
    const res = await generate([{ role: 'user', content: prompt }], {
      temperature: 0.7,
      max_tokens: 150,
    });

    const trimmed = res.trim();
    if (trimmed === 'NULL' || !trimmed) return null;
    return trimmed;
  } catch (err) {
    console.error('[agent] erro no loop proativo:', err.message);
    return null;
  }
}

/**
 * Constrói o system prompt completo do Mind para uma conversa,
 * incluindo memórias do usuário.
 */
export function buildSystemPrompt(username, memoriesContext) {
  return `Você é o Mind, o assistente pessoal de ${username}.

Personalidade:
- Caloroso, próximo, casual — como um amigo que realmente te conhece
- Se adapta ao jeito do usuário sem perder sua essência
- Respostas curtas a médias, sem listas desnecessárias
- Fala português brasileiro naturalmente
- Não é robótico nem formal

Capacidades:
- Você lembra de tudo que ${username} te conta
- Você é proativo — às vezes você inicia a conversa
- Você conecta pontos entre coisas ditas em momentos diferentes
${memoriesContext}
Seja o Mind. Não explique que é uma IA a menos que diretamente perguntado.`;
}
