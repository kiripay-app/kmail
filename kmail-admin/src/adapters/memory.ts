import { randomUUID } from "node:crypto";
import { AdminError, type Alias, type DkimInfo, type Domain, type HealthItem, type MailAdmin, type Mailbox, type QueueItem } from "./types.js";

/** In-memory backend for development, demos and tests. Nothing is persisted. */
export class MemoryAdmin implements MailAdmin {
  readonly kind = "memory";
  private domains = new Map<string, Domain>();
  private boxes = new Map<string, Mailbox & { password: string }>();
  private aliases = new Map<string, Alias>();
  private dkim = new Map<string, DkimInfo>();
  private mailq: QueueItem[] = [];
  private log: string[] = [];

  constructor(seed = false) {
    if (seed) {
      void this.addDomain({ name: "example.ki", description: "Demo domain", quotaMiB: 10240, maxMailboxes: 50 });
      void this.addMailbox({ localPart: "karotu", domain: "example.ki", name: "Karotu", password: "x", quotaMiB: 2048 });
      void this.addAlias({ address: "info@example.ki", goto: "karotu@example.ki" });
      this.mailq.push({ id: "A1B2C3", sender: "someone@example.org", recipients: ["gone@example.ki"], size: 2048, arrival: Date.now() / 1000 - 600, reason: "connect to mx timed out" });
      this.log.push("Nov 14 postfix/smtpd[1]: connect from unknown[203.0.113.9]");
    }
  }

  async health(): Promise<HealthItem[]> { return [{ name: "memory backend", ok: true, detail: "data is not persisted" }]; }
  async listDomains() {
    return [...this.domains.values()].map((d) => ({ ...d, mailboxes: [...this.boxes.values()].filter((b) => b.domain === d.name).length }));
  }
  async addDomain(d: { name: string; description?: string; quotaMiB?: number; maxMailboxes?: number }) {
    const name = d.name.toLowerCase();
    if (this.domains.has(name)) throw new AdminError("Domain already exists", 409);
    this.domains.set(name, { name, description: d.description ?? "", active: true, mailboxes: 0, maxMailboxes: d.maxMailboxes ?? 10, quotaMiB: d.quotaMiB ?? 3072, usedMiB: 0 });
  }
  async setDomainActive(name: string, active: boolean) { this.need(this.domains.get(name)).active = active; }
  async deleteDomain(name: string) {
    if ([...this.boxes.values()].some((b) => b.domain === name)) throw new AdminError("Remove the mailboxes first", 409);
    if (!this.domains.delete(name)) throw new AdminError("Not found", 404);
  }
  async listMailboxes(domain?: string) {
    return [...this.boxes.values()].filter((b) => !domain || b.domain === domain).map(({ password: _p, ...b }) => b);
  }
  async addMailbox(m: { localPart: string; domain: string; name?: string; password: string; quotaMiB: number }) {
    if (!this.domains.has(m.domain)) throw new AdminError("Unknown domain", 404);
    const address = `${m.localPart}@${m.domain}`.toLowerCase();
    if (this.boxes.has(address)) throw new AdminError("Mailbox already exists", 409);
    this.boxes.set(address, { address, name: m.name ?? "", domain: m.domain, active: true, quotaMiB: m.quotaMiB, usedMiB: 0, messages: 0, lastLogin: null, password: m.password });
  }
  async updateMailbox(address: string, p: { name?: string; quotaMiB?: number; active?: boolean; password?: string }) {
    const b = this.need(this.boxes.get(address));
    if (p.name !== undefined) b.name = p.name;
    if (p.quotaMiB !== undefined) b.quotaMiB = p.quotaMiB;
    if (p.active !== undefined) b.active = p.active;
    if (p.password !== undefined) b.password = p.password;
  }
  async deleteMailbox(address: string) { if (!this.boxes.delete(address)) throw new AdminError("Not found", 404); }
  async listAliases(domain?: string) { return [...this.aliases.values()].filter((a) => !domain || a.address.endsWith(`@${domain}`)); }
  async addAlias(a: { address: string; goto: string }) {
    const id = randomUUID().slice(0, 8);
    this.aliases.set(id, { id, address: a.address.toLowerCase(), goto: a.goto, active: true });
  }
  async setAliasActive(id: string, active: boolean) { this.need(this.aliases.get(id)).active = active; }
  async deleteAlias(id: string) { if (!this.aliases.delete(id)) throw new AdminError("Not found", 404); }
  async getDkim(domain: string) { return this.dkim.get(domain) ?? null; }
  async createDkim(domain: string, selector: string, bits: 1024 | 2048 | 4096) {
    if (!this.domains.has(domain)) throw new AdminError("Unknown domain", 404);
    this.dkim.set(domain, { domain, selector, length: bits, txt: `v=DKIM1;k=rsa;t=s;s=email;p=MEMORYKEYNOTREAL` });
  }
  async deleteDkim(domain: string) { this.dkim.delete(domain); }
  async queue() { return this.mailq; }
  async flushQueue() { /* nothing to deliver */ }
  async clearQueue() { this.mailq = []; }
  async logs(_kind: "postfix" | "dovecot" | "auth", count: number) { return this.log.slice(-count); }

  private need<T>(v: T | undefined): T { if (!v) throw new AdminError("Not found", 404); return v; }
}
