import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { belongsTo, caldav, davStatus, pickCollection, type DAVCalendar } from "../dav.js";
import { applyUpdate, buildNew, buildReply, expand, parseInvite, setPartstat, splitByUid, withMethod, type Method, type PartStat } from "../ical.js";
import { safeName } from "../lookup.js";
import { sendItip, shouldSendInvites, when } from "../scheduling.js";
import { credentials, type Session } from "../session.js";
import type { Creds } from "../imap.js";

const MAX_RANGE_MS = 100 * 86_400_000;

const Recurrence = z.object({
  freq: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  interval: z.number().int().min(1).max(99).optional(),
  count: z.number().int().min(1).max(999).optional(),
  until: z.string().max(40).optional(),
});
const EventBody = z.object({
  calendar: z.string().url(),
  title: z.string().trim().min(1).max(500),
  start: z.string().min(8).max(40),
  end: z.string().min(8).max(40),
  allDay: z.boolean(),
  location: z.string().max(500).optional(),
  description: z.string().max(20_000).optional(),
  recurrence: Recurrence.nullish(),
  reminderMinutes: z.number().int().min(0).max(40_320).nullish(),
  attendees: z.array(z.string().email().max(254)).max(100).optional(),
});
const Update = EventBody.extend({ href: z.string().url(), etag: z.string().max(200).optional() });
const Rsvp = z.object({ calendar: z.string().url(), href: z.string().url(), etag: z.string().max(200).optional(), status: z.enum(["ACCEPTED", "TENTATIVE", "DECLINED"]) });

const label = (v: unknown) => (typeof v === "string" ? v : "Calendar");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const WORD: Record<PartStat, string> = { ACCEPTED: "Accepted", TENTATIVE: "Tentative", DECLINED: "Declined" };

function ensureOk(res: Response) {
  if (!res.ok) throw new Error(`DAV ${res.status}`);
}
function fail(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) {
  const s = davStatus(e);
  if (s === 412) return reply.code(409).send({ error: "conflict" });
  if (s === 404) return reply.code(404).send({ error: "not_found" });
  if (s === 401 || s === 403) return reply.code(502).send({ error: "calendar_denied" });
  return reply.code(502).send({ error: "calendar_unavailable" });
}

/** Email an iTIP message if this server needs us to. Never fails the calendar change itself. */
async function tell(log: FastifyBaseLogger, creds: Creds, cal: DAVCalendar, method: Method, ics: string, to: string[], subject: string, text: string): Promise<number> {
  try {
    if (!to.length || !(await shouldSendInvites(cal.url, creds))) return 0;
    return await sendItip(creds, { method, ics: withMethod(ics, method), to, subject, text });
  } catch (e) {
    log.warn({ err: e }, "could not send invitation email");
    return 0;
  }
}

export async function calendarRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  const open = async (req: { session?: Session }) => {
    const creds = credentials(req.session!);
    const client = await caldav(creds);
    const calendars = (await client.fetchCalendars()).filter((c) => !c.components || c.components.includes("VEVENT"));
    return { creds, client, calendars };
  };

  app.get("/api/calendar/calendars", async (req, reply) => {
    try {
      const { calendars } = await open(req);
      return calendars.map((c) => ({ id: c.url, name: label(c.displayName), color: (c as { calendarColor?: string }).calendarColor?.slice(0, 7) ?? null }));
    } catch (e) {
      req.log.error({ err: e }, "calendar list failed");
      return fail(reply, e);
    }
  });

  app.get("/api/calendar/events", async (req, reply) => {
    const q = z.object({ start: z.string().datetime(), end: z.string().datetime(), calendars: z.string().optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_input" });
    const from = new Date(q.data.start), to = new Date(q.data.end);
    if (!(to > from) || +to - +from > MAX_RANGE_MS) return reply.code(400).send({ error: "invalid_range" });
    try {
      const { client, calendars } = await open(req);
      const wanted = q.data.calendars ? calendars.filter((c) => q.data.calendars!.split(",").includes(c.url)) : calendars;
      const failed: string[] = [];
      const events = (
        await Promise.all(
          wanted.map(async (cal) => {
            try {
              const objs = await client.fetchCalendarObjects({ calendar: cal, timeRange: { start: from.toISOString(), end: to.toISOString() } });
              return objs.flatMap((o) =>
                typeof o.data !== "string" ? [] : expand(o.data, from, to).map((x) => ({ ...x, id: `${o.url}|${x.start}`, calendar: cal.url, href: o.url, etag: o.etag ?? "" })),
              );
            } catch (e) {
              req.log.warn({ err: e, calendar: cal.url }, "calendar fetch failed");
              failed.push(cal.url);
              return [];
            }
          }),
        )
      ).flat();
      return { events, failed };
    } catch (e) {
      req.log.error({ err: e }, "events failed");
      return fail(reply, e);
    }
  });

  app.post("/api/calendar/events", async (req, reply) => {
    const b = EventBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { creds, client, calendars } = await open(req);
      const cal = pickCollection(calendars, b.data.calendar);
      if (!cal) return reply.code(404).send({ error: "calendar_not_found" });
      const uid = `${randomUUID()}@kmail`;
      const ics = buildNew(b.data, uid, creds.user);
      ensureOk(await client.createCalendarObject({ calendar: cal, filename: `${uid}.ics`, iCalString: ics }));
      const invited = await tell(req.log, creds, cal, "REQUEST", ics, b.data.attendees ?? [], `Invitation: ${b.data.title}`,
        `${creds.user} invited you to ${b.data.title}\n\nWhen: ${when(b.data.start, b.data.end, b.data.allDay)}${b.data.location ? `\nWhere: ${b.data.location}` : ""}`);
      return { ok: true, uid, invitationsSent: invited };
    } catch (e) {
      req.log.error({ err: e }, "event create failed");
      return fail(reply, e);
    }
  });

  app.put("/api/calendar/events", async (req, reply) => {
    const b = Update.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { creds, client, calendars } = await open(req);
      const cal = pickCollection(calendars, b.data.calendar);
      if (!cal || !belongsTo([cal], b.data.href)) return reply.code(404).send({ error: "not_found" });
      const [obj] = await client.fetchCalendarObjects({ calendar: cal, objectUrls: [b.data.href] });
      if (!obj || typeof obj.data !== "string") return reply.code(404).send({ error: "not_found" });
      if (b.data.etag && obj.etag && b.data.etag !== obj.etag) return reply.code(409).send({ error: "conflict" });
      const before = parseInvite(obj.data);
      const data = applyUpdate(obj.data, b.data, creds.user);
      ensureOk(await client.updateCalendarObject({ calendarObject: { url: b.data.href, data, etag: obj.etag } }));

      // Only the organiser sends updates; invitees just edit their own copy.
      const after = parseInvite(data);
      if (after && (!after.organizer.email || same(after.organizer.email, creds.user))) {
        const now = after.attendees.map((a) => a.email);
        const gone = (before?.attendees ?? []).map((a) => a.email).filter((e) => !now.some((n) => same(n, e)));
        await tell(req.log, creds, cal, "REQUEST", data, now, `Updated invitation: ${b.data.title}`,
          `${creds.user} updated ${b.data.title}\n\nWhen: ${when(after.start, after.end, after.allDay)}${after.location ? `\nWhere: ${after.location}` : ""}`);
        await tell(req.log, creds, cal, "CANCEL", obj.data, gone, `Canceled: ${b.data.title}`, `${creds.user} removed you from ${b.data.title}.`);
      }
      return { ok: true };
    } catch (e) {
      req.log.error({ err: e }, "event update failed");
      return fail(reply, e);
    }
  });

  app.put("/api/calendar/events/rsvp", async (req, reply) => {
    const b = Rsvp.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { creds, client, calendars } = await open(req);
      const cal = pickCollection(calendars, b.data.calendar);
      if (!cal || !belongsTo([cal], b.data.href)) return reply.code(404).send({ error: "not_found" });
      const [obj] = await client.fetchCalendarObjects({ calendar: cal, objectUrls: [b.data.href] });
      if (!obj || typeof obj.data !== "string") return reply.code(404).send({ error: "not_found" });
      if (b.data.etag && obj.etag && b.data.etag !== obj.etag) return reply.code(409).send({ error: "conflict" });
      const inv = parseInvite(obj.data);
      const data = setPartstat(obj.data, creds.user, b.data.status);
      ensureOk(await client.updateCalendarObject({ calendarObject: { url: b.data.href, data, etag: obj.etag } }));
      if (inv?.organizer.email && !same(inv.organizer.email, creds.user)) {
        await tell(req.log, creds, cal, "REPLY", buildReply(obj.data, creds.user, b.data.status), [inv.organizer.email], `${WORD[b.data.status]}: ${inv.title}`,
          `${creds.user} ${b.data.status === "ACCEPTED" ? "accepted" : b.data.status === "TENTATIVE" ? "tentatively accepted" : "declined"}: ${inv.title}`);
      }
      return { ok: true };
    } catch (e) {
      req.log.error({ err: e }, "rsvp failed");
      return fail(reply, e);
    }
  });

  app.delete("/api/calendar/events", async (req, reply) => {
    const q = z.object({ calendar: z.string().url(), href: z.string().url(), etag: z.string().max(200).optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { creds, client, calendars } = await open(req);
      const cal = pickCollection(calendars, q.data.calendar);
      if (!cal || !belongsTo([cal], q.data.href)) return reply.code(404).send({ error: "not_found" });
      const [obj] = await client.fetchCalendarObjects({ calendar: cal, objectUrls: [q.data.href] });
      ensureOk(await client.deleteCalendarObject({ calendarObject: { url: q.data.href, etag: q.data.etag } }));
      const inv = obj && typeof obj.data === "string" ? parseInvite(obj.data) : undefined;
      if (obj && inv && inv.attendees.length && (!inv.organizer.email || same(inv.organizer.email, creds.user))) {
        await tell(req.log, creds, cal, "CANCEL", obj.data as string, inv.attendees.map((a) => a.email), `Canceled: ${inv.title}`, `${creds.user} canceled ${inv.title}.`);
      }
      return { ok: true };
    } catch (e) {
      req.log.error({ err: e }, "event delete failed");
      return fail(reply, e);
    }
  });

  // Bring in an .ics export (for example from Carbonio). Events already present are skipped, never overwritten.
  app.post("/api/calendar/import", { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const b = z.object({ calendar: z.string().url(), ics: z.string().min(20).max(10 * 1024 * 1024) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_input" });
    let parts: { uid: string; data: string }[];
    try {
      parts = splitByUid(b.data.ics);
    } catch {
      return reply.code(400).send({ error: "invalid_ics" });
    }
    if (!parts.length) return reply.code(400).send({ error: "no_events" });
    if (parts.length > 3000) return reply.code(400).send({ error: "too_many_events" });
    try {
      const { client, calendars } = await open(req);
      const cal = pickCollection(calendars, b.data.calendar);
      if (!cal) return reply.code(404).send({ error: "calendar_not_found" });
      let imported = 0, skipped = 0, failed = 0;
      for (let i = 0; i < parts.length; i += 5) {
        await Promise.all(parts.slice(i, i + 5).map(async (p) => {
          try {
            const r = await client.createCalendarObject({ calendar: cal, filename: `${safeName(p.uid)}.ics`, iCalString: p.data });
            if (r.ok) imported++;
            else if (r.status === 412 || r.status === 409) skipped++;
            else failed++;
          } catch { failed++; }
        }));
      }
      return { imported, skipped, failed };
    } catch (e) {
      req.log.error({ err: e }, "import failed");
      return fail(reply, e);
    }
  });
}
