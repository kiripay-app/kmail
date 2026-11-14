import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { COOKIE, requireAuth, setSessionCookie } from "../auth.js";
import { isAuthFailure, newClient } from "../imap.js";
import { createSession, destroySession } from "../session.js";

const Login = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(512) });

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (req.headers["x-kmail-csrf"] !== "1") return reply.code(403).send({ error: "csrf" });
    const body = Login.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_input" });
    const { email, password } = body.data;

    // Verify against Dovecot, the single source of truth for mailbox credentials.
    const c = newClient({ user: email, pass: password });
    try {
      await c.connect();
    } catch (e) {
      if (isAuthFailure(e)) return reply.code(401).send({ error: "bad_credentials" });
      req.log.error({ err: e }, "imap login failed");
      return reply.code(502).send({ error: "mail_server_unreachable" });
    }
    await c.logout().catch(() => c.close());

    const s = createSession(email.toLowerCase(), password);
    setSessionCookie(reply, s.id);
    return { email: s.email };
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (req) => ({ email: req.session!.email }));

  app.post("/api/auth/logout", { preHandler: requireAuth }, async (req, reply) => {
    destroySession(req.session!.id);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
}
