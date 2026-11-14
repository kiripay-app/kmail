/** Sliding-window failure counter kept in memory. Used to stop password guessing before it reaches Dovecot. */
export class Throttle {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}

  private live(key: string, now: number): number[] {
    const h = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (h.length) this.hits.set(key, h); else this.hits.delete(key);
    return h;
  }
  blocked(key: string, now = Date.now()) { return this.live(key, now).length >= this.max; }
  fail(key: string, now = Date.now()) { const h = this.live(key, now); h.push(now); this.hits.set(key, h); }
  clear(key: string) { this.hits.delete(key); }
  /** Drop expired keys so the map cannot grow without bound. */
  sweep(now = Date.now()) { for (const k of [...this.hits.keys()]) this.live(k, now); }
  get size() { return this.hits.size; }
}
