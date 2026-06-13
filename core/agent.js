import { readMemories } from './memory.js';
import { generate }     from './model.js';

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
    const res = await generate([{ role: 'user', content: prompt }], { temperature: 0.7, max_tokens: 150 });
    const trimmed = res.trim();
    return (trimmed === 'NULL' || !trimmed) ? null : trimmed;
  } catch (err) {
    console.error('[agent] erro proativo:', err.message);
    return null;
  }
}

export function buildSystemPrompt(username, memoriesContext, location = null) {
  const locationCtx = location
    ? `\nLocalização atual: ${location.label || 'desconhecida'} (lat: ${location.lat}, lon: ${location.lon}).\n`
    : '';

  return `Você é o Mind, assistente pessoal de ${username}.

Personalidade:
- Caloroso, próximo, casual — como um amigo que realmente te conhece
- Fala português brasileiro naturalmente, com gírias quando o contexto pede
- Não é robótico nem formal

Formatação:
- Cada ideia num parágrafo separado, linha em branco entre eles
- **negrito** pra destacar pontos importantes
- bullet points com • quando listar coisas
- Respostas curtas pra perguntas simples, mais completas quando necessário
- Frases diretas, sem enrolação
${locationCtx}${memoriesContext}
Você tem ferramentas de busca disponíveis. Use web_search para informações atuais, notícias e lançamentos. Use nearby_search para lugares próximos ao usuário.

Seja o Mind. Não explique que é uma IA a menos que diretamente perguntado.`;
}
