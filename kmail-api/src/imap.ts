import { ImapFlow } from "imapflow";
import { config } from "./config.js";

export interface Creds { user: string; pass: string }

export function newClient({ user, pass }: Creds): ImapFlow {
  const c = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: config.imap.rejectUnauthorized },
    logger: false,
  });
  c.on("error", () => {}); // surfaced through the failing call instead
  return c;
}

// One connection per request: simple and stateless. Pooling can come later if it shows up in profiling.
export async function withImap<T>(creds: Creds, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = newClient(creds);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.logout().catch(() => c.close());
  }
}

export async function withMailbox<T>(c: ImapFlow, path: string, fn: () => Promise<T>): Promise<T> {
  const lock = await c.getMailboxLock(path);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

export const isAuthFailure = (e: unknown) => Boolean((e as { authenticationFailed?: boolean })?.authenticationFailed);
