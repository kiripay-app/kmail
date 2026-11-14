import { randomBytes } from "node:crypto";
import { config } from "./config.js";

export type Stage = "totp" | "setup" | "full";
export interface Sess { id: string; adminId: number; username: string; stage: Stage; created: number; seen: number; ip: string }

const sessions = new Map<string, Sess>();

export function create(adminId: number, username: string, stage: Stage, ip: string): Sess {
  const s: Sess = { id: randomBytes(32).toString("base64url"), adminId, username, stage, created: Date.now(), seen: Date.now(), ip };
  sessions.set(s.id, s);
  return s;
}
export function get(id: string | undefined, now = Date.now()): Sess | undefined {
  if (!id) return undefined;
  const s = sessions.get(id);
  if (!s) return undefined;
  // half-finished logins (password ok, 2FA pending) only live for 10 minutes
  const idle = s.stage === "full" ? config.idleMs : 10 * 60_000;
  if (now - s.seen > idle || now - s.created > config.absoluteMs) { sessions.delete(id); return undefined; }
  s.seen = now;
  return s;
}
export const destroy = (id: string) => void sessions.delete(id);
/** Used after a password reset or disable so that existing logins stop working. */
export function destroyForAdmin(adminId: number) { for (const [k, s] of sessions) if (s.adminId === adminId) sessions.delete(k); }
export function sweep(now = Date.now()) { for (const k of [...sessions.keys()]) get(k, now); }
