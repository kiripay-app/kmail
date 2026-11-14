import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { belongsTo, carddav, davStatus, pickCollection } from "../dav.js";
import { credentials } from "../session.js";
import { buildCard, parseCard, splitCards, updateCard } from "../vcard.js";

const Body = z.object({
  book: z.string().url(),
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  emails: z.array(z.string().email()).max(20).default([]),
  phones: z.array(z.string().max(50)).max(20).default([]),
  org: z.string().max(300).optional(),
  notes: z.string().max(10_000).optional(),
});
const Update = Body.extend({ href: z.string().url(), etag: z.string().max(200).optional() });

const ensureOk = (r: Response) => { if (!r.ok) throw new Error(`DAV ${r.status}`); };
function fail(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) {
  const s = davStatus(e);
  if (s === 412) return reply.code(409).send({ error: "conflict" });
  if (s === 404) return reply.code(404).send({ error: "not_found" });
  return reply.code(502).send({ error: "contacts_unavailable" });
}

export async function contactRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  const open = async (req: { session?: Parameters<typeof credentials>[0] }) => {
    const client = await carddav(credentials(req.session!));
    return { client, books: await client.fetchAddressBooks() };
  };

  app.get("/api/contacts/books", async (req, reply) => {
    try {
      const { books } = await open(req);
      return books.map((b) => ({ id: b.url, name: typeof b.displayName === "string" ? b.displayName : "Contacts" }));
    } catch (e) {
      req.log.error({ err: e }, "address books failed");
      return fail(reply, e);
    }
  });

  app.get("/api/contacts", async (req, reply) => {
    const q = z.object({ book: z.string().url().optional(), q: z.string().max(200).optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { client, books } = await open(req);
      const wanted = q.data.book ? books.filter((b) => b.url === q.data.book) : books;
      const needle = q.data.q?.toLowerCase();
      const all = (
        await Promise.all(
          wanted.map(async (book) =>
            (await client.fetchVCards({ addressBook: book })).flatMap((v) => {
              const c = typeof v.data === "string" ? parseCard(v.data) : undefined;
              return c ? [{ ...c, id: v.url, href: v.url, etag: v.etag ?? "", book: book.url }] : [];
            }),
          ),
        )
      ).flat();
      const hit = needle ? all.filter((c) => [c.name, c.org, ...c.emails, ...c.phones].some((x) => x.toLowerCase().includes(needle))) : all;
      hit.sort((a, b) => a.name.localeCompare(b.name));
      return { contacts: hit.slice(0, 2000), total: hit.length };
    } catch (e) {
      req.log.error({ err: e }, "contacts failed");
      return fail(reply, e);
    }
  });

  // Address suggestions while typing a recipient. The address-book fetch is cached for a minute per session.
  const suggestCache = new Map<string, { at: number; people: { name: string; email: string }[] }>();
  app.get("/api/contacts/suggest", async (req, reply) => {
    const q = z.object({ q: z.string().trim().min(1).max(100) }).safeParse(req.query);
    if (!q.success) return [];
    try {
      const sid = req.session!.id;
      let hit = suggestCache.get(sid);
      if (!hit || Date.now() - hit.at > 60_000) {
        const { client, books } = await open(req);
        const people = (await Promise.all(books.map((b) => client.fetchVCards({ addressBook: b }))))
          .flat()
          .flatMap((v) => { const c = typeof v.data === "string" ? parseCard(v.data) : undefined; return c ? c.emails.map((email) => ({ name: c.name, email })) : []; });
        hit = { at: Date.now(), people };
        suggestCache.set(sid, hit);
        if (suggestCache.size > 500) suggestCache.delete(suggestCache.keys().next().value!);
      }
      const n = q.data.q.toLowerCase();
      return hit.people.filter((p) => p.name.toLowerCase().includes(n) || p.email.toLowerCase().includes(n)).slice(0, 8);
    } catch (e) {
      req.log.warn({ err: e }, "suggest failed");
      return reply.code(200).send([]);
    }
  });

  // Import a .vcf export. Contacts that already exist are skipped, never overwritten.
  app.post("/api/contacts/import", { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const b = z.object({ book: z.string().url(), vcf: z.string().min(20).max(10 * 1024 * 1024) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_input" });
    const cards = splitCards(b.data.vcf);
    if (!cards.length) return reply.code(400).send({ error: "no_contacts" });
    if (cards.length > 5000) return reply.code(400).send({ error: "too_many_contacts" });
    try {
      const { client, books } = await open(req);
      const book = pickCollection(books, b.data.book);
      if (!book) return reply.code(404).send({ error: "book_not_found" });
      let imported = 0, skipped = 0, failed = 0;
      for (let i = 0; i < cards.length; i += 5) {
        await Promise.all(cards.slice(i, i + 5).map(async (c) => {
          try {
            const r = await client.createVCard({ addressBook: book, filename: `${c.uid.replace(/[^A-Za-z0-9@._-]/g, "_").slice(0, 120)}.vcf`, vCardString: c.data });
            if (r.ok) imported++; else if (r.status === 412 || r.status === 409) skipped++; else failed++;
          } catch { failed++; }
        }));
      }
      return { imported, skipped, failed };
    } catch (e) {
      req.log.error({ err: e }, "contact import failed");
      return fail(reply, e);
    }
  });

  app.post("/api/contacts", async (req, reply) => {
    const b = Body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { client, books } = await open(req);
      const book = pickCollection(books, b.data.book);
      if (!book) return reply.code(404).send({ error: "book_not_found" });
      const uid = randomUUID();
      ensureOk(await client.createVCard({ addressBook: book, filename: `${uid}.vcf`, vCardString: buildCard(b.data, uid) }));
      return { ok: true };
    } catch (e) {
      req.log.error({ err: e }, "contact create failed");
      return fail(reply, e);
    }
  });

  app.put("/api/contacts", async (req, reply) => {
    const b = Update.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { client, books } = await open(req);
      const book = pickCollection(books, b.data.book);
      if (!book || !belongsTo([book], b.data.href)) return reply.code(404).send({ error: "not_found" });
      const [card] = await client.fetchVCards({ addressBook: book, objectUrls: [b.data.href] });
      if (!card || typeof card.data !== "string") return reply.code(404).send({ error: "not_found" });
      if (b.data.etag && card.etag && b.data.etag !== card.etag) return reply.code(409).send({ error: "conflict" });
      ensureOk(await client.updateVCard({ vCard: { url: b.data.href, data: updateCard(card.data, b.data), etag: card.etag } }));
      return { ok: true };
    } catch (e) {
      req.log.error({ err: e }, "contact update failed");
      return fail(reply, e);
    }
  });

  app.delete("/api/contacts", async (req, reply) => {
    const q = z.object({ book: z.string().url(), href: z.string().url(), etag: z.string().max(200).optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { client, books } = await open(req);
      const book = pickCollection(books, q.data.book);
      if (!book || !belongsTo([book], q.data.href)) return reply.code(404).send({ error: "not_found" });
      ensureOk(await client.deleteVCard({ vCard: { url: q.data.href, etag: q.data.etag } }));
      return { ok: true };
    } catch (e) {
      req.log.error({ err: e }, "contact delete failed");
      return fail(reply, e);
    }
  });
}
