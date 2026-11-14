import { q } from "./db.js";

/** Append-only (enforced by database triggers). Never put passwords, codes or keys in `detail`. */
export function audit(actor: string, ip: string, action: string, target = "", ok = true, detail: unknown = "") {
  q().prepare("INSERT INTO audit (ts, actor, ip, action, target, ok, detail) VALUES (?,?,?,?,?,?,?)")
    .run(Date.now(), actor, ip, action, target, ok ? 1 : 0, typeof detail === "string" ? detail : JSON.stringify(detail));
}

export interface AuditRow { id: number; ts: number; actor: string; ip: string; action: string; target: string; ok: number; detail: string }
export function listAudit(limit: number, before?: number): AuditRow[] {
  return (before
    ? q().prepare("SELECT * FROM audit WHERE id < ? ORDER BY id DESC LIMIT ?").all(before, limit)
    : q().prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?").all(limit)) as unknown as AuditRow[];
}
