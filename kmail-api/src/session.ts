import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

// MVP: sessions live in this process's memory. That means one API replica only; for Kubernetes the
// store must move to Redis (mailcow already ships one). The mailbox password is kept encrypted
// (AES-256-GCM) so IMAP/SMTP can be reopened per request; it is never written to disk.
if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET not set: using a random key, sessions will not survive a restart.");
}
const key = createHash("sha256").update(process.env.SESSION_SECRET || randomBytes(32)).digest();

export interface Session {
  id: string;
  email: string;
  secret: Buffer;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

function encrypt(plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function decrypt(buf: Buffer): string {
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export function createSession(email: string, password: string): Session {
  const s: Session = {
    id: randomBytes(32).toString("base64url"),
    email,
    secret: encrypt(password),
    expiresAt: Date.now() + config.sessionTtlMs,
  };
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: string | undefined): Session | undefined {
  if (!id) return undefined;
  const s = sessions.get(id);
  if (!s) return undefined;
  if (s.expiresAt < Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  s.expiresAt = Date.now() + config.sessionTtlMs; // sliding expiry
  return s;
}

export const credentials = (s: Session) => ({ user: s.email, pass: decrypt(s.secret) });
export const destroySession = (id: string) => sessions.delete(id);

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt < now) sessions.delete(id);
}, 60_000).unref();
