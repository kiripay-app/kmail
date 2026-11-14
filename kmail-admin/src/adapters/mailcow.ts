import http from "node:http";
import https from "node:https";
import { AdminError, type Alias, type DkimInfo, type Domain, type HealthItem, type MailAdmin, type Mailbox, type QueueItem } from "./types.js";

export interface MailcowOptions { url: string; key: string; rejectUnauthorized: boolean }

const MIB = 1024 * 1024;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const bool = (v: unknown) => v === 1 || v === "1" || v === true;
/** Mailcow answers some calls with a bare array/object and others with a `[ {type, msg} ]` wrapper; accept both. */
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : v && typeof v === "object" && Object.keys(v).length ? [v] : []);

export class MailcowAdmin implements MailAdmin {
  readonly kind = "mailcow";
  constructor(private o: MailcowOptions) {}

  private call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const u = new URL(this.o.url.replace(/\/$/, "") + path);
    const lib = u.protocol === "https:" ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = lib.request(u, {
        method, timeout: 20_000, rejectUnauthorized: this.o.rejectUnauthorized,
        headers: { "X-API-Key": this.o.key, Accept: "application/json", ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}) },
      } as https.RequestOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) return reject(new AdminError(`Mail server answered ${res.statusCode}`, 502));
          if (!text) return resolve([]);
          try { resolve(JSON.parse(text)); } catch { reject(new AdminError("Mail server sent an unreadable answer", 502)); }
        });
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => reject(new AdminError("Cannot reach the mail server API", 502)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** Write calls report failure inside a 200 response: [{type:"danger", msg:"..."}]. */
  private async write(path: string, body: unknown) {
    const r = arr(await this.call("POST", path, body));
    const bad = r.find((x) => x && x.type && x.type !== "success");
    if (bad) throw new AdminError(String(Array.isArray(bad.msg) ? bad.msg.join(" ") : bad.msg ?? "The mail server refused the change"), 400);
  }

  async health(): Promise<HealthItem[]> {
    try {
      const r = (await this.call("GET", "/get/status/containers")) as Record<string, any>;
      return Object.entries(r).filter(([, v]) => v && typeof v === "object" && "state" in v)
        .map(([k, v]) => ({ name: k.replace(/-mailcow$/, ""), ok: v.state === "running", detail: String(v.state) }));
    } catch (e) { return [{ name: "mailcow api", ok: false, detail: (e as Error).message }]; }
  }

  async listDomains(): Promise<Domain[]> {
    return arr(await this.call("GET", "/get/domain/all")).map((d) => ({
      name: d.domain_name, description: d.description ?? "", active: bool(d.active), mailboxes: num(d.mboxes_in_domain), maxMailboxes: num(d.max_num_mboxes_for_domain),
      quotaMiB: Math.round(num(d.max_quota_for_domain) / MIB), usedMiB: Math.round(num(d.bytes_total ?? d.quota_used_in_domain) / MIB),
    }));
  }
  addDomain(d: { name: string; description?: string; quotaMiB?: number; maxMailboxes?: number }) {
    const quota = d.quotaMiB ?? 3072;
    return this.write("/add/domain", { domain: d.name, description: d.description ?? "", active: 1, aliases: 400, mailboxes: d.maxMailboxes ?? 10, defquota: Math.min(3072, quota), maxquota: quota, quota, restart_sogo: 1 });
  }
  setDomainActive(name: string, active: boolean) { return this.write("/edit/domain", { items: [name], attr: { active: active ? 1 : 0 } }); }
  deleteDomain(name: string) { return this.write("/delete/domain", [name]); }

  async listMailboxes(domain?: string): Promise<Mailbox[]> {
    const path = domain ? `/get/mailbox/all/${encodeURIComponent(domain)}` : "/get/mailbox/all";
    return arr(await this.call("GET", path)).map((m) => ({
      address: m.username, name: m.name ?? "", domain: m.domain, active: bool(m.active), quotaMiB: Math.round(num(m.quota) / MIB),
      usedMiB: Math.round(num(m.quota_used) / MIB), messages: num(m.messages), lastLogin: num(m.last_imap_login) || null,
    }));
  }
  addMailbox(m: { localPart: string; domain: string; name?: string; password: string; quotaMiB: number }) {
    return this.write("/add/mailbox", { local_part: m.localPart, domain: m.domain, name: m.name ?? "", password: m.password, password2: m.password, quota: m.quotaMiB, active: 1, force_pw_update: 0 });
  }
  updateMailbox(address: string, p: { name?: string; quotaMiB?: number; active?: boolean; password?: string }) {
    const attr: Record<string, unknown> = {};
    if (p.name !== undefined) attr.name = p.name;
    if (p.quotaMiB !== undefined) attr.quota = p.quotaMiB;
    if (p.active !== undefined) attr.active = p.active ? 1 : 0;
    if (p.password !== undefined) { attr.password = p.password; attr.password2 = p.password; }
    return this.write("/edit/mailbox", { items: [address], attr });
  }
  deleteMailbox(address: string) { return this.write("/delete/mailbox", [address]); }

  async listAliases(domain?: string): Promise<Alias[]> {
    return arr(await this.call("GET", "/get/alias/all"))
      .filter((a) => !domain || a.domain === domain)
      .map((a) => ({ id: String(a.id), address: a.address, goto: a.goto ?? "", active: bool(a.active) }));
  }
  addAlias(a: { address: string; goto: string }) { return this.write("/add/alias", { address: a.address, goto: a.goto, active: 1 }); }
  setAliasActive(id: string, active: boolean) { return this.write("/edit/alias", { items: [id], attr: { active: active ? 1 : 0 } }); }
  deleteAlias(id: string) { return this.write("/delete/alias", [id]); }

  async getDkim(domain: string): Promise<DkimInfo | null> {
    const r = (await this.call("GET", `/get/dkim/${encodeURIComponent(domain)}`)) as any;
    if (!r || Array.isArray(r) || !r.dkim_txt) return null;
    return { domain, selector: r.dkim_selector ?? "dkim", txt: r.dkim_txt, length: num(r.length) };
  }
  createDkim(domain: string, selector: string, bits: 1024 | 2048 | 4096) { return this.write("/add/dkim", { domains: domain, dkim_selector: selector, key_size: bits }); }
  deleteDkim(domain: string) { return this.write("/delete/dkim", [domain]); }

  async queue(): Promise<QueueItem[]> {
    return arr(await this.call("GET", "/get/mailq/all")).map((m) => ({
      id: String(m.queue_id), sender: m.sender ?? "", recipients: arr(m.recipients).map((r) => String(r)),
      size: num(m.message_size), arrival: num(m.arrival_time), reason: "",
    }));
  }
  flushQueue() { return this.write("/edit/mailq", { action: "flush" }); }
  clearQueue() { return this.write("/delete/mailq", { action: "super_delete" }); }

  async logs(kind: "postfix" | "dovecot" | "auth", count: number): Promise<string[]> {
    const name = kind === "auth" ? "netfilter" : kind;
    const rows = arr(await this.call("GET", `/get/logs/${name}/${Math.min(Math.max(count, 1), 500)}`));
    return rows.map((r) => (typeof r === "string" ? r : r.message ?? JSON.stringify(r)));
  }
}
