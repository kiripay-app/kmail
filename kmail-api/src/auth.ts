import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { getSession, type Session } from "./session.js";

export const COOKIE = "kmail_sid";

export function setSessionCookie(reply: FastifyReply, id: string) {
  reply.setCookie(COOKIE, id, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.cookieSecure,
    path: "/",
    maxAge: config.sessionTtlMs / 1000,
  });
}

declare module "fastify" {
  interface FastifyRequest { session?: Session }
}

// Cookie is SameSite=Strict; state-changing calls also need a custom header, which a cross-site
// form post cannot set (CSRF defence in depth).
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (req.method !== "GET" && req.headers["x-kmail-csrf"] !== "1") {
    return reply.code(403).send({ error: "csrf" });
  }
  const s = getSession(req.cookies[COOKIE]);
  if (!s) return reply.code(401).send({ error: "unauthenticated" });
  req.session = s;
}
