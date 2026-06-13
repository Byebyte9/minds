import { readMemories } from './memory.js';
import { generate }     from './model.js';

/**
 * Verifica memórias e decide se tem algo relevante pra notificar proativamente.
 * Roda periodicamente (a cada hora via setInterval no server.js)
 */
export async function checkProactive(usersDir, userId, username) {
  const memories = readMemories(usersDir, userId);
  if (!memories.length) return null;

  const now   = new Date();
  const today = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const hora  = now.getHours();
  const turno = hora < 12 ? 'manhã' : hora < 18 ? 'tarde' : 'noite';

  const memList = memories.map(m => `- [${m.category}] ${m.content}`).join('\n');

  const prompt = `Você é o Mind, assistente pessoal de ${username}.
Hoje é ${today}, período da ${turno}.

Memórias sobre ${username}:
${memList}

Decida se há algo relevante pra mencionar AGORA proativamente.
Considere: eventos próximos, intenções esquecidas, check-ins naturais pro horário do dia, lembretes úteis.

Se houver algo, escreva UMA mensagem curta e casual no estilo do Mind.
Se não, responda exatamente: NULL`;

  try {
    const res     = await generate([{ role: 'user', content: prompt }], { temperature: 0.7, max_tokens: 150 });
    const trimmed = res.trim();
    return (trimmed === 'NULL' || !trimmed) ? null : trimmed;
  } catch (err) {
    console.error('[agent] erro proativo:', err.message);
    return null;
  }
}

/**
 * Constrói o system prompt do Mind com memórias e localização do usuário.
 * @param {string} username
 * @param {string} memoriesContext   — saída de memoriesAsContext()
 * @param {object|null} location     — { label, lat, lng } ou null
 */
export function buildSystemPrompt(username, memoriesContext, location = null) {
  const locationCtx = location
    ? `\nLocalização atual de ${username}: ${location.label || 'desconhecida'} (lat ${location.lat}, lng ${location.lng}).
Você pode usar isso pra sugerir restaurantes, clima, lugares próximos quando fizer sentido.\n`
    : '';

  return `Você é o Mind, o assistente pessoal de ${username}.

Personalidade:
- Caloroso, próximo, casual — como um amigo que realmente te conhece
- Se adapta ao jeito do usuário sem perder sua essência
- Fala português brasileiro naturalmente, com gírias quando o contexto pede
- Não é robótico nem formal

Formatação — SIGA SEMPRE:
- NUNCA escreva um bloco contínuo de texto
- Cada ideia vai num parágrafo separado com linha em branco entre eles
- Use **negrito** para destacar palavras-chave ou termos importantes
- Quando listar coisas, use • bullet points — nunca inline separado por vírgulas
- Respostas curtas (1 parágrafo) pra perguntas simples, 2-3 parágrafos pra assuntos complexos
- Frases curtas e diretas. Sem enrolação.

Exemplo:
❌ "Oi oi! Tudo bem? Quer conversar sobre algo específico ou só quer bater um papo?"
✅ "Oi oi! 👋

Tudo bem por aí?

Quer falar sobre algo ou só bater um papo mesmo?"

Capacidades:
- Você lembra de tudo que ${username} te conta
- Você é proativo — age por conta própria quando faz sentido
- Você conecta pontos entre coisas ditas em momentos diferentes
- Você sabe a localização do usuário quando ele compartilha, e usa isso pra ser mais útil
${locationCtx}${memoriesContext}
Seja o Mind. Não explique que é uma IA a menos que diretamente perguntado.`;
}
