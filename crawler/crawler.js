import fs       from 'fs';
import path     from 'path';
import { Queue }             from './queue.js';
import { parseHTML, isGoodContent } from './parser.js';

const DATA_DIR    = path.join(process.cwd(), 'data');
const KNOWLEDGE   = path.join(DATA_DIR, 'knowledge.json');
const DELAY_MS    = 800;   // pausa entre requests (respeita o servidor)
const MAX_PAGES   = 500;   // limite por sessão

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadKnowledge() {
  try { return JSON.parse(fs.readFileSync(KNOWLEDGE, 'utf8')); }
  catch { return []; }
}

function saveKnowledge(entries) {
  fs.writeFileSync(KNOWLEDGE, JSON.stringify(entries, null, 2), 'utf8');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let running = false;

/**
 * Inicia o crawler a partir de uma URL seed
 * @param {string} startUrl  - ex: "https://pt.wikipedia.org/wiki/Intelig%C3%AAncia_artificial"
 * @param {number} maxPages  - quantas páginas visitar (padrão: MAX_PAGES)
 */
export async function startCrawl(startUrl, maxPages = MAX_PAGES) {
  if (running) {
    console.log('[crawler] já está rodando');
    return;
  }

  running = true;
  const queue      = new Queue();
  const knowledge  = loadKnowledge();
  const knownUrls  = new Set(knowledge.map(e => e.url));

  queue.add(startUrl);
  console.log(`[crawler] iniciando em ${startUrl}`);

  let count = 0;

  while (!queue.isEmpty && count < maxPages) {
    const url = queue.next();
    if (!url || knownUrls.has(url)) continue;

    try {
      const res  = await fetch(url, {
        headers: { 'User-Agent': 'MindCrawler/1.0 (educational project)' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) { queue.markVisited(url); continue; }

      const html            = await res.text();
      const base            = new URL(url).origin;
      const { title, text, links } = parseHTML(html, base);

      queue.markVisited(url);
      knownUrls.add(url);

      if (isGoodContent(text)) {
        knowledge.push({
          url,
          title,
          text: text.slice(0, 8000),   // limite por entrada
          crawledAt: new Date().toISOString(),
        });
        saveKnowledge(knowledge);
        count++;
        console.log(`[crawler] ${count}/${maxPages} — ${title || url}`);
      }

      // Adiciona links novos na fila
      for (const link of links) {
        if (!knownUrls.has(link)) queue.add(link);
      }

      await sleep(DELAY_MS);

    } catch (err) {
      console.error(`[crawler] erro em ${url}: ${err.message}`);
      queue.markVisited(url);
    }
  }

  running = false;
  console.log(`[crawler] finalizado. ${count} páginas salvas.`);
}

export function isCrawling() { return running; }

export function stopCrawl()  { running = false; }
