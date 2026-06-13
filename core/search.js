import { search as duckSearch } from 'duck-duck-scrape';

/**
 * Busca no DuckDuckGo e retorna os top N resultados resumidos
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<{title, url, snippet}>>}
 */
export async function webSearch(query, limit = 4) {
  try {
    const results = await duckSearch(query, { safeSearch: 'OFF' });

    return (results.results || [])
      .slice(0, limit)
      .map(r => ({
        title:   r.title   || '',
        url:     r.url     || '',
        snippet: r.description || '',
      }));
  } catch (err) {
    console.error('[search] erro:', err.message);
    return [];
  }
}

/**
 * Formata os resultados como texto pro modelo usar como contexto
 */
export function formatSearchResults(results) {
  if (!results.length) return 'Nenhum resultado encontrado.';
  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.snippet}\nFonte: ${r.url}`
  ).join('\n\n');
}
