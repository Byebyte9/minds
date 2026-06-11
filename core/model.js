import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Modelo e parâmetros padrão — troca aqui quando mudar de LLM
const DEFAULTS = {
  model:       'llama-3.3-70b-versatile',
  max_tokens:  1024,
  temperature: 0.85,
};

/**
 * Gera uma resposta completa (sem streaming)
 * @param {Array}  messages  - array no formato [{role, content}]
 * @param {Object} opts      - sobrescreve DEFAULTS se quiser
 * @returns {Promise<string>}
 */
export async function generate(messages, opts = {}) {
  const res = await groq.chat.completions.create({
    ...DEFAULTS,
    ...opts,
    messages,
    stream: false,
  });
  return res.choices[0]?.message?.content || '';
}

/**
 * Gera com streaming — chama onDelta a cada chunk
 * @param {Array}    messages
 * @param {Function} onDelta  - chamada com cada pedaço de texto
 * @param {Object}   opts
 * @returns {Promise<string>} texto completo ao final
 */
export async function generateStream(messages, onDelta, opts = {}) {
  const stream = await groq.chat.completions.create({
    ...DEFAULTS,
    ...opts,
    messages,
    stream: true,
  });

  let full = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      full += delta;
      onDelta(delta);
    }
  }
  return full;
}
