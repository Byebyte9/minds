/**
 * Extrai texto limpo e links de um HTML bruto.
 * Usa regex simples — sem dependência de DOM.
 */

// Tags que não têm conteúdo útil
const SKIP_TAGS = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'form'];

export function parseHTML(html, baseUrl) {
  // Remove tags inúteis e seu conteúdo
  let clean = html;
  for (const tag of SKIP_TAGS) {
    clean = clean.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }

  // Extrai texto — remove todas as tags restantes
  const text = clean
    .replace(/<[^>]+>/g, ' ')        // remove tags
    .replace(/&nbsp;/g, ' ')          // entidades HTML comuns
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')       // múltiplos espaços → parágrafo
    .trim();

  // Extrai links
  const linkRegex = /href=["']([^"'#?]+)["']/g;
  const links = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const url = new URL(match[1], baseUrl).href;
      // Só links do mesmo domínio e que parecem artigos
      if (url.startsWith(baseUrl) && !url.match(/\.(jpg|png|gif|pdf|svg|css|js)$/i)) {
        links.push(url);
      }
    } catch {
      // URL inválida — ignora
    }
  }

  // Extrai título
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  return { title, text, links };
}

/**
 * Filtra texto de baixa qualidade
 * Retorna true se o texto vale a pena salvar
 */
export function isGoodContent(text) {
  if (!text || text.length < 200) return false;               // muito curto
  const words = text.split(/\s+/).length;
  if (words < 50) return false;                               // poucas palavras
  const specialRatio = (text.match(/[^a-zA-ZÀ-ú0-9\s.,!?;:()\-]/g) || []).length / text.length;
  if (specialRatio > 0.15) return false;                      // muito lixo
  return true;
}
