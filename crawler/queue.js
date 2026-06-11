/**
 * Fila simples de URLs pro crawler.
 * Evita visitar a mesma URL duas vezes.
 */
export class Queue {
  constructor() {
    this.pending  = [];
    this.visited  = new Set();
  }

  add(url) {
    if (!url || this.visited.has(url) || this.pending.includes(url)) return;
    this.pending.push(url);
  }

  next() {
    return this.pending.shift() || null;
  }

  markVisited(url) {
    this.visited.add(url);
  }

  get size()    { return this.pending.length; }
  get total()   { return this.visited.size; }
  get isEmpty() { return this.pending.length === 0; }
}
