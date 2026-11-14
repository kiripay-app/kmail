import type { FastifyInstance } from "fastify";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { credentials } from "../session.js";
import { withImap, withMailbox } from "../imap.js";
import { cleanHtml } from "../sanitize.js";

const uidParam = z.coerce.number().int().positive();
const folderParam = z.string().min(1).max(255);

const addr = (a?: { name?: string; address?: string }) => ({ name: a?.name ?? "", address: a?.address ?? "" });

export async function mailRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/mail/folders", async (req) => {
    return withImap(credentials(req.session!), async (c) => {
      const list = await c.list();
      const out = [];
      for (const m of list) {
        if (m.flags?.has("\\Noselect")) continue;
        const st = await c.status(m.path, { messages: true, unseen: true }).catch(() => undefined);
        out.push({ path: m.path, name: m.name, specialUse: m.specialUse ?? null, total: st?.messages ?? 0, unseen: st?.unseen ?? 0 });
      }
      return out;
    });
  });

  app.get("/api/mail/messages", async (req, reply) => {
    const q = z
      .object({ folder: folderParam.default("INBOX"), page: z.coerce.number().int().min(1).default(1), q: z.string().max(200).optional() })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_input" });
    const { folder, page, q: text } = q.data;
    const size = config.pageSize;

    return withImap(credentials(req.session!), (c) =>
      withMailbox(c, folder, async () => {
        const total = (c.mailbox && c.mailbox.exists) || 0;
        let range: string;
        let byUid = false;
        let matched = total;
        if (text) {
          const uids = (await c.search({ or: [{ subject: text }, { from: text }, { body: text }] }, { uid: true })) || [];
          matched = uids.length;
          const slice = uids.slice(Math.max(0, uids.length - page * size), uids.length - (page - 1) * size);
          if (!slice.length) return { total: 0, page, pageSize: size, messages: [] };
          range = slice.join(",");
          byUid = true;
        } else {
          if (total === 0) return { total: 0, page, pageSize: size, messages: [] };
          const end = total - (page - 1) * size;
          if (end < 1) return { total, page, pageSize: size, messages: [] };
          range = `${Math.max(1, end - size + 1)}:${end}`;
        }
        const messages = [];
        for await (const m of c.fetch(range, { uid: true, envelope: true, flags: true, internalDate: true }, { uid: byUid })) {
          messages.push({
            uid: m.uid,
            subject: m.envelope?.subject ?? "(no subject)",
            from: addr(m.envelope?.from?.[0]),
            date: m.envelope?.date || m.internalDate ? new Date((m.envelope?.date ?? m.internalDate) as Date | string).toISOString() : null,
            seen: m.flags?.has("\\Seen") ?? false,
            flagged: m.flags?.has("\\Flagged") ?? false,
          });
        }
        messages.sort((a, b) => b.uid - a.uid);
        return { total: matched, page, pageSize: size, messages };
      }),
    );
  });

  app.get("/api/mail/messages/:uid", async (req, reply) => {
    const uid = uidParam.safeParse((req.params as { uid: string }).uid);
    const q = z.object({ folder: folderParam.default("INBOX"), images: z.enum(["0", "1"]).default("0") }).safeParse(req.query);
    if (!uid.success || !q.success) return reply.code(400).send({ error: "invalid_input" });

    return withImap(credentials(req.session!), (c) =>
      withMailbox(c, q.data.folder, async () => {
        const m = await c.fetchOne(String(uid.data), { source: true, flags: true, uid: true }, { uid: true });
        if (!m || !m.source) return reply.code(404).send({ error: "not_found" });
        const p = await simpleParser(m.source);
        if (!m.flags?.has("\\Seen")) await c.messageFlagsAdd(String(uid.data), ["\\Seen"], { uid: true });

        // Inline (cid:) images become data URIs so they show without any remote fetch.
        let html = typeof p.html === "string" ? p.html : "";
        for (const a of p.attachments) {
          if (a.contentId && a.contentType.startsWith("image/") && a.size <= 2_000_000) {
            const cid = a.contentId.replace(/^<|>$/g, "");
            html = html.split(`cid:${cid}`).join(`data:${a.contentType};base64,${a.content.toString("base64")}`);
          }
        }
        const body = html
          ? cleanHtml(html, q.data.images === "1")
          : { html: cleanHtml(`<pre style="white-space:pre-wrap">${(p.text ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!)}</pre>`, false).html, blockedRemote: false };
        return {
          uid: uid.data,
          subject: p.subject ?? "(no subject)",
          from: p.from?.value.map(addr) ?? [],
          to: (Array.isArray(p.to) ? p.to : p.to ? [p.to] : []).flatMap((x) => x.value.map(addr)),
          cc: (Array.isArray(p.cc) ? p.cc : p.cc ? [p.cc] : []).flatMap((x) => x.value.map(addr)),
          date: p.date?.toISOString() ?? null,
          html: body.html,
          blockedRemoteImages: body.blockedRemote,
          attachments: p.attachments
            .map((a, i) => ({ a, i }))
            .filter(({ a }) => !(a.contentId && a.contentDisposition === "inline"))
            .map(({ a, i }) => ({ index: i, filename: a.filename ?? "attachment", size: a.size, contentType: a.contentType })),
        };
      }),
    );
  });

  app.get("/api/mail/messages/:uid/attachments/:index", async (req, reply) => {
    const params = req.params as { uid: string; index: string };
    const uid = uidParam.safeParse(params.uid);
    const idx = z.coerce.number().int().min(0).safeParse(params.index);
    const q = z.object({ folder: folderParam.default("INBOX") }).safeParse(req.query);
    if (!uid.success || !idx.success || !q.success) return reply.code(400).send({ error: "invalid_input" });

    return withImap(credentials(req.session!), (c) =>
      withMailbox(c, q.data.folder, async () => {
        const m = await c.fetchOne(String(uid.data), { source: true }, { uid: true });
        if (!m || !m.source) return reply.code(404).send({ error: "not_found" });
        const att = (await simpleParser(m.source)).attachments[idx.data];
        if (!att) return reply.code(404).send({ error: "not_found" });
        const name = encodeURIComponent(att.filename ?? "attachment");
        return reply
          .header("content-type", "application/octet-stream")
          .header("content-disposition", `attachment; filename*=UTF-8''${name}`)
          .header("x-content-type-options", "nosniff")
          .header("content-security-policy", "sandbox")
          .send(att.content);
      }),
    );
  });

  const Patch = z.object({
    folder: folderParam,
    seen: z.boolean().optional(),
    flagged: z.boolean().optional(),
    moveTo: folderParam.optional(),
  });
  app.patch("/api/mail/messages/:uid", async (req, reply) => {
    const uid = uidParam.safeParse((req.params as { uid: string }).uid);
    const b = Patch.safeParse(req.body);
    if (!uid.success || !b.success) return reply.code(400).send({ error: "invalid_input" });
    const id = String(uid.data);
    return withImap(credentials(req.session!), (c) =>
      withMailbox(c, b.data.folder, async () => {
        if (b.data.seen !== undefined) await (b.data.seen ? c.messageFlagsAdd : c.messageFlagsRemove).call(c, id, ["\\Seen"], { uid: true });
        if (b.data.flagged !== undefined) await (b.data.flagged ? c.messageFlagsAdd : c.messageFlagsRemove).call(c, id, ["\\Flagged"], { uid: true });
        if (b.data.moveTo) await c.messageMove(id, b.data.moveTo, { uid: true });
        return { ok: true };
      }),
    );
  });

  // Delete = move to Trash; deleting from Trash itself removes the message permanently.
  app.delete("/api/mail/messages/:uid", async (req, reply) => {
    const uid = uidParam.safeParse((req.params as { uid: string }).uid);
    const q = z.object({ folder: folderParam }).safeParse(req.query);
    if (!uid.success || !q.success) return reply.code(400).send({ error: "invalid_input" });
    const id = String(uid.data);
    return withImap(credentials(req.session!), async (c) => {
      const list = await c.list();
      const trash = list.find((m) => m.specialUse === "\\Trash")?.path ?? list.find((m) => /^trash$/i.test(m.name))?.path;
      return withMailbox(c, q.data.folder, async () => {
        if (trash && trash !== q.data.folder) await c.messageMove(id, trash, { uid: true });
        else await c.messageDelete(id, { uid: true });
        return { ok: true };
      });
    });
  });

  const Send = z.object({
    to: z.array(z.string().email()).min(1).max(100),
    cc: z.array(z.string().email()).max(100).default([]),
    bcc: z.array(z.string().email()).max(100).default([]),
    subject: z.string().max(998).default(""),
    text: z.string().max(5_000_000).default(""),
    html: z.string().max(10_000_000).optional(),
    inReplyTo: z.string().max(998).optional(),
    attachments: z.array(z.object({ filename: z.string().max(255), contentType: z.string().max(255).optional(), base64: z.string() })).max(20).default([]),
  });
  app.post("/api/mail/send", { bodyLimit: 40 * 1024 * 1024 }, async (req, reply) => {
    const b = Send.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_input" });
    const creds = credentials(req.session!);
    const mail = new MailComposer({
      from: creds.user,
      to: b.data.to,
      cc: b.data.cc,
      bcc: b.data.bcc,
      subject: b.data.subject,
      text: b.data.text,
      html: b.data.html,
      inReplyTo: b.data.inReplyTo,
      references: b.data.inReplyTo,
      attachments: b.data.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.base64, "base64") })),
    });
    const raw = await mail.compile().build();
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      requireTLS: true,
      auth: { user: creds.user, pass: creds.pass },
      tls: { rejectUnauthorized: config.smtp.rejectUnauthorized },
    });
    try {
      await transport.sendMail({ envelope: { from: creds.user, to: [...b.data.to, ...b.data.cc, ...b.data.bcc] }, raw });
    } catch (e) {
      req.log.error({ err: e }, "smtp send failed");
      return reply.code(502).send({ error: "send_failed" });
    }
    // File a copy in Sent (SMTP submission does not do that on its own). Best effort.
    await withImap(creds, async (c) => {
      const list = await c.list();
      const sent = list.find((m) => m.specialUse === "\\Sent")?.path ?? list.find((m) => /^sent/i.test(m.name))?.path;
      if (sent) await c.append(sent, raw, ["\\Seen"]);
    }).catch((e) => req.log.warn({ err: e }, "could not save to Sent"));
    return { ok: true };
  });
}
