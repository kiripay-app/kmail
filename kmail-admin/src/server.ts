import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import QRCode from "qrcode";
import { z } from "zod";
import { AdminError, type MailAdmin } from "./adapters/types.js";
import { audit, listAudit } from "./audit.js";
import * as auth from "./auth.js";
import { allowed } from "./cidr.js";
import { config } from "./config.js";
import { passwordProblem, randomPassword } from "./crypto.js";
import { getAdmin, q, type Admin } from "./db.js";
import * as sessions from "./session.js";
import { otpauthUri } from "./totp.js";

const COOKIE = "kmail_admin";
const BASE = "/kmail-admin";
const domainRe = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const localRe = /^[a-z0-9][a-z0-9._+-]{0,63}$/i;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mib = z.number().int().min(0).max(10_000_000);

const publicAdmin = (a: Admin) => ({ id: a.id, username: a.username, totp: !!a.totp_enabled, disabled: !!a.disabled, locked: auth.isLocked(a), lastLogin: a.last_login, createdAt: a.created_at });

export async function buildServer(backend: MailAdmin, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 64 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff").header("X-Frame-Options", "DENY").header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store")
      .header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    if (!allowed(req.ip, config.allowCidrs)) { audit("-", req.ip, "blocked.ip", "", false); return reply.code(403).send({ error: "Not allowed from this address" }); }
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-kmail-csrf"] !== "1") return reply.code(403).send({ error: "Missing CSRF header" });
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof AdminError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    reply.code(500).send({ error: "Something went wrong" });
  });

  const sess = (req: FastifyRequest) => sessions.get(req.cookies[COOKIE]);
  const setCookie = (reply: FastifyReply, id: string) =>
    reply.setCookie(COOKIE, id, { path: BASE, httpOnly: true, sameSite: "strict", secure: config.cookieSecure });

  /** Route guard: returns the session and the admin, or sends 401. */
  function need(req: FastifyRequest, reply: FastifyReply, stage: sessions.Stage = "full") {
    const s = sess(req);
    const a = s && getAdmin(s.adminId);
    if (!s || !a || a.disabled || s.stage !== stage) { reply.code(401).send({ error: "Sign in required", stage: s?.stage }); return undefined; }
    return { s, a };
  }
  const noTotp = z.object({ code: z.string().min(6).max(20) });

  app.register(async (r) => {
    // ---------- sign in ----------
    r.post("/api/login", { config: { rateLimit: { max: config.rateMax, timeWindow: "1 minute" } } }, async (req, reply) => {
      const b = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) }).parse(req.body);
      const res = await auth.checkPassword(b.username, b.password);
      if (!res.ok) {
        audit(b.username, req.ip, "login.password", "", false, res.reason);
        return reply.code(res.reason === "locked" ? 429 : 401).send({ error: res.reason === "locked" ? "Too many attempts. Try again later." : "Wrong username or password" });
      }
      const s = sessions.create(res.admin.id, res.admin.username, res.admin.totp_enabled ? "totp" : "setup", req.ip);
      setCookie(reply, s.id);
      return { stage: s.stage };
    });

    r.post("/api/login/totp", { config: { rateLimit: { max: config.rateMax, timeWindow: "1 minute" } } }, async (req, reply) => {
      const x = need(req, reply, "totp"); if (!x) return;
      const { code } = noTotp.parse(req.body);
      const res = auth.checkSecondFactor(x.a.id, code);
      if (!res.ok) {
        audit(x.a.username, req.ip, "login.2fa", "", false);
        if (res.locked) sessions.destroy(x.s.id);
        return reply.code(res.locked ? 429 : 401).send({ error: res.locked ? "Too many attempts. Try again later." : "That code is not right" });
      }
      // new session id after privilege change (prevents fixation)
      sessions.destroy(x.s.id);
      const full = sessions.create(x.a.id, x.a.username, "full", req.ip);
      setCookie(reply, full.id);
      audit(x.a.username, req.ip, res.used === "recovery" ? "login.ok.recovery" : "login.ok");
      return { stage: "full", recoveryLeft: auth.recoveryLeft(x.a.id), usedRecovery: res.used === "recovery" };
    });

    r.post("/api/logout", async (req, reply) => {
      const s = sess(req); if (s) { sessions.destroy(s.id); audit(s.username, req.ip, "logout"); }
      reply.clearCookie(COOKIE, { path: BASE });
      return { ok: true };
    });

    r.get("/api/me", async (req, reply) => {
      const s = sess(req); const a = s && getAdmin(s.adminId);
      if (!s || !a) return reply.code(401).send({ error: "Sign in required" });
      return { stage: s.stage, username: a.username, backend: backend.kind, mustChangePassword: !!a.must_change_pw };
    });

    // ---------- first-time setup (password change + authenticator) ----------
    r.get("/api/setup", async (req, reply) => {
      const x = need(req, reply, "setup"); if (!x) return;
      const secret = auth.beginEnrol(x.a.id);
      const uri = otpauthUri(config.issuer, x.a.username, secret);
      return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }), mustChangePassword: !!x.a.must_change_pw };
    });
    r.post("/api/setup", { config: { rateLimit: { max: config.rateMax, timeWindow: "1 minute" } } }, async (req, reply) => {
      const x = need(req, reply, "setup"); if (!x) return;
      const b = z.object({ code: z.string().min(6).max(8), password: z.string().max(256).optional() }).parse(req.body);
      // Check everything first, change nothing until both the new password and the code are good.
      if (x.a.must_change_pw) {
        if (!b.password) return reply.code(400).send({ error: "Choose a new password" });
        const problem = passwordProblem(b.password, x.a.username);
        if (problem) return reply.code(400).send({ error: problem });
      }
      const codes = auth.finishEnrol(x.a.id, b.code);
      if (!codes) { audit(x.a.username, req.ip, "2fa.enrol", "", false); return reply.code(400).send({ error: "That code is not right. Check the phone clock and try again." }); }
      if (x.a.must_change_pw) { await auth.setPassword(x.a.id, x.a.username, b.password!); audit(x.a.username, req.ip, "password.change"); }
      audit(x.a.username, req.ip, "2fa.enrol");
      sessions.destroy(x.s.id);
      setCookie(reply, sessions.create(x.a.id, x.a.username, "full", req.ip).id);
      return { stage: "full", recoveryCodes: codes };
    });

    // ---------- everything below needs a fully signed-in admin ----------
    r.register(async (g) => {
      g.addHook("preHandler", async (req, reply) => {
        const x = need(req, reply); if (!x) return reply;
        if (x.a.must_change_pw) return reply.code(403).send({ error: "Change your password first" });
        (req as any).me = x.a;
      });
      const me = (req: FastifyRequest) => (req as any).me as Admin;
      /** Runs a change, then records it in the audit log (success or failure). */
      async function act<T>(req: FastifyRequest, action: string, target: string, fn: () => Promise<T>, detail: unknown = ""): Promise<T> {
        try { const v = await fn(); audit(me(req).username, req.ip, action, target, true, detail); return v; }
        catch (e) { audit(me(req).username, req.ip, action, target, false, (e as Error).message); throw e; }
      }

      g.get("/api/health", async () => ({ backend: backend.kind, items: await backend.health() }));

      // domains
      g.get("/api/domains", () => backend.listDomains());
      g.post("/api/domains", async (req) => {
        const b = z.object({ name: z.string().regex(domainRe), description: z.string().max(200).optional(), quotaMiB: mib.optional(), maxMailboxes: z.number().int().min(1).max(100000).optional() }).parse(req.body);
        await act(req, "domain.add", b.name, () => backend.addDomain({ ...b, name: b.name.toLowerCase() })); return { ok: true };
      });
      g.patch("/api/domains/:name", async (req) => {
        const name = z.string().regex(domainRe).parse((req.params as any).name);
        const b = z.object({ active: z.boolean() }).parse(req.body);
        await act(req, b.active ? "domain.enable" : "domain.disable", name, () => backend.setDomainActive(name, b.active)); return { ok: true };
      });
      g.delete("/api/domains/:name", async (req) => {
        const name = z.string().regex(domainRe).parse((req.params as any).name);
        await act(req, "domain.delete", name, () => backend.deleteDomain(name)); return { ok: true };
      });

      // mailboxes
      g.get("/api/mailboxes", (req) => backend.listMailboxes(z.string().regex(domainRe).optional().parse((req.query as any).domain)));
      g.post("/api/mailboxes", async (req) => {
        const b = z.object({ localPart: z.string().regex(localRe), domain: z.string().regex(domainRe), name: z.string().max(100).optional(), password: z.string().min(12).max(256).optional(), quotaMiB: mib }).parse(req.body);
        const password = b.password ?? randomPassword();
        const domain = b.domain.toLowerCase();
        await act(req, "mailbox.add", `${b.localPart}@${domain}`, () => backend.addMailbox({ ...b, domain, password }), { quotaMiB: b.quotaMiB });
        return { ok: true, generatedPassword: b.password ? undefined : password };
      });
      g.patch("/api/mailboxes/:address", async (req) => {
        const address = z.string().regex(emailRe).parse((req.params as any).address).toLowerCase();
        const b = z.object({ name: z.string().max(100).optional(), quotaMiB: mib.optional(), active: z.boolean().optional(), resetPassword: z.boolean().optional(), password: z.string().min(12).max(256).optional() }).parse(req.body);
        const password = b.password ?? (b.resetPassword ? randomPassword() : undefined);
        await act(req, password ? "mailbox.password" : "mailbox.edit", address, () => backend.updateMailbox(address, { name: b.name, quotaMiB: b.quotaMiB, active: b.active, password }),
          { name: b.name, quotaMiB: b.quotaMiB, active: b.active });
        return { ok: true, generatedPassword: b.password ? undefined : password };
      });
      g.delete("/api/mailboxes/:address", async (req) => {
        const address = z.string().regex(emailRe).parse((req.params as any).address).toLowerCase();
        await act(req, "mailbox.delete", address, () => backend.deleteMailbox(address)); return { ok: true };
      });

      // aliases
      g.get("/api/aliases", (req) => backend.listAliases(z.string().regex(domainRe).optional().parse((req.query as any).domain)));
      g.post("/api/aliases", async (req) => {
        const b = z.object({ address: z.string().regex(emailRe), goto: z.string().min(3).max(1000) }).parse(req.body);
        const targets = b.goto.split(/[,\s]+/).filter(Boolean);
        if (!targets.length || !targets.every((t) => emailRe.test(t))) throw new AdminError("Destinations must be email addresses");
        await act(req, "alias.add", b.address, () => backend.addAlias({ address: b.address, goto: targets.join(",") }), { goto: targets }); return { ok: true };
      });
      g.patch("/api/aliases/:id", async (req) => {
        const id = z.string().min(1).max(40).parse((req.params as any).id);
        const b = z.object({ active: z.boolean() }).parse(req.body);
        await act(req, b.active ? "alias.enable" : "alias.disable", id, () => backend.setAliasActive(id, b.active)); return { ok: true };
      });
      g.delete("/api/aliases/:id", async (req) => {
        const id = z.string().min(1).max(40).parse((req.params as any).id);
        await act(req, "alias.delete", id, () => backend.deleteAlias(id)); return { ok: true };
      });

      // DKIM
      g.get("/api/dkim/:domain", async (req) => ({ dkim: await backend.getDkim(z.string().regex(domainRe).parse((req.params as any).domain)) }));
      g.post("/api/dkim/:domain", async (req) => {
        const domain = z.string().regex(domainRe).parse((req.params as any).domain);
        const b = z.object({ selector: z.string().regex(/^[a-z0-9-]{1,32}$/i).default("dkim"), bits: z.union([z.literal(1024), z.literal(2048), z.literal(4096)]).default(2048) }).parse(req.body ?? {});
        await act(req, "dkim.create", domain, () => backend.createDkim(domain, b.selector, b.bits), b); return { ok: true };
      });
      g.delete("/api/dkim/:domain", async (req) => {
        const domain = z.string().regex(domainRe).parse((req.params as any).domain);
        await act(req, "dkim.delete", domain, () => backend.deleteDkim(domain)); return { ok: true };
      });

      // queue and logs
      g.get("/api/queue", () => backend.queue());
      g.post("/api/queue/flush", async (req) => { await act(req, "queue.flush", "", () => backend.flushQueue()); return { ok: true }; });
      g.post("/api/queue/clear", async (req) => {
        z.object({ confirm: z.literal(true) }).parse(req.body);
        await act(req, "queue.clear", "", () => backend.clearQueue()); return { ok: true };
      });
      g.get("/api/logs/:kind", async (req) => {
        const kind = z.enum(["postfix", "dovecot", "auth"]).parse((req.params as any).kind);
        const n = z.coerce.number().int().min(1).max(500).catch(100).parse((req.query as any).count);
        return { lines: await backend.logs(kind, n) };
      });

      g.get("/api/audit", (req) => {
        const qs = req.query as any;
        return listAudit(z.coerce.number().int().min(1).max(500).catch(100).parse(qs.limit), z.coerce.number().int().optional().catch(undefined).parse(qs.before));
      });

      // admins
      g.get("/api/admins", () => (q().prepare("SELECT * FROM admins ORDER BY username").all() as unknown as Admin[]).map(publicAdmin));
      g.post("/api/admins", async (req) => {
        const b = z.object({ username: z.string() }).parse(req.body);
        const temp = randomPassword();
        try { await act(req, "admin.create", b.username, () => auth.createAdmin(b.username, temp)); }
        catch (e: any) { throw new AdminError(/UNIQUE/.test(e.message) ? "That username exists" : e.message); }
        return { ok: true, temporaryPassword: temp };
      });
      const target = (req: FastifyRequest) => {
        const a = getAdmin(z.coerce.number().int().parse((req.params as any).id));
        if (!a) throw new AdminError("Not found", 404);
        return a;
      };
      g.post("/api/admins/:id/disable", async (req) => {
        const a = target(req);
        if (a.id === me(req).id) throw new AdminError("You cannot disable yourself");
        await act(req, "admin.disable", a.username, async () => { q().prepare("UPDATE admins SET disabled = 1 WHERE id = ?").run(a.id); sessions.destroyForAdmin(a.id); }); return { ok: true };
      });
      g.post("/api/admins/:id/enable", async (req) => {
        const a = target(req);
        await act(req, "admin.enable", a.username, async () => void q().prepare("UPDATE admins SET disabled = 0, failed = 0, locked_until = 0 WHERE id = ?").run(a.id)); return { ok: true };
      });
      g.post("/api/admins/:id/reset", async (req) => {
        const a = target(req);
        if (a.id === me(req).id) throw new AdminError("Use Account to change your own password");
        const temp = randomPassword();
        await act(req, "admin.reset", a.username, async () => {
          await auth.setPassword(a.id, a.username, temp, true); auth.resetTwoFactor(a.id); sessions.destroyForAdmin(a.id);
          q().prepare("UPDATE admins SET failed = 0, locked_until = 0 WHERE id = ?").run(a.id);
        });
        return { ok: true, temporaryPassword: temp };
      });
      g.delete("/api/admins/:id", async (req) => {
        const a = target(req);
        if (a.id === me(req).id) throw new AdminError("You cannot delete yourself");
        await act(req, "admin.delete", a.username, async () => { sessions.destroyForAdmin(a.id); q().prepare("DELETE FROM admins WHERE id = ?").run(a.id); }); return { ok: true };
      });

      // own account
      g.post("/api/account/password", async (req) => {
        const b = z.object({ current: z.string().max(256), next: z.string().max(256) }).parse(req.body);
        const a = me(req);
        const ok = await auth.checkPassword(a.username, b.current);
        if (!ok.ok) throw new AdminError("Current password is wrong", 400);
        const problem = await auth.setPassword(a.id, a.username, b.next);
        if (problem) throw new AdminError(problem);
        audit(a.username, req.ip, "password.change");
        return { ok: true };
      });
      g.post("/api/account/recovery", async (req) => {
        const { code } = noTotp.parse(req.body);
        const a = me(req);
        if (!auth.checkSecondFactor(a.id, code).ok) throw new AdminError("That code is not right", 400);
        const codes = auth.storeRecovery(a.id);
        audit(a.username, req.ip, "recovery.regenerate");
        return { recoveryCodes: codes };
      });
    });

    // ---------- the web UI ----------
    const ui = join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "dist");
    if (existsSync(ui)) {
      await r.register(fastifyStatic, { root: ui, prefix: "/", wildcard: false });
    }
  }, { prefix: BASE });

  const timer = setInterval(() => sessions.sweep(), 60_000); timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  return app;
}
