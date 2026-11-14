import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { belongsTo, caldav, davStatus, pickCollection } from "../dav.js";
import { applyUpdate, buildNew, expand } from "../ical.js";
import { credentials } from "../session.js";

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
});
const Update = EventBody.extend({ href: z.string().url(), etag: z.string().max(200).optional() });

const label = (v: unknown) => (typeof v === "string" ? v : "Calendar");

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

export async function calendarRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  const open = async (req: { session?: Parameters<typeof credentials>[0] }) => {
    const client = await caldav(credentials(req.session!));
    const calendars = (await client.fetchCalendars()).filter((c) => !c.components || c.components.includes("VEVENT"));
    return { client, calendars };
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
      const { client, calendars } = await open(req);
      const cal = pickCollection(calendars, b.data.calendar);
      if (!cal) return reply.code(404).send({ error: "calendar_not_found" });
      const uid = `${randomUUID()}@kmail`;
      ensureOk(await client.createCalendarObject({ calendar: cal, filename: `${uid}.ics`, iCalString: buildNew(b.data, uid) }));
      return { ok: true, uid };
    } catch (e) {
      req.log.error({ err: e }, "event create failed");
      return fail(reply, e);
    }
  });

  app.put("/api/calendar/events", async (req, reply) => {
    const b = Update.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { client, calendars } = await open(req);
      const cal = pickCollection(calendars, b.data.calendar);
      if (!cal || !belongsTo([cal], b.data.href)) return reply.code(404).send({ error: "not_found" });
      const [obj] = await client.fetchCalendarObjects({ calendar: cal, objectUrls: [b.data.href] });
      if (!obj || typeof obj.data !== "string") return reply.code(404).send({ error: "not_found" });
      if (b.data.etag && obj.etag && b.data.etag !== obj.etag) return reply.code(409).send({ error: "conflict" });
      ensureOk(await client.updateCalendarObject({ calendarObject: { url: b.data.href, data: applyUpdate(obj.data, b.data), etag: obj.etag } }));
      return { ok: true };
    } catch (e) {
      req.log.error({ err: e }, "event update failed");
      return fail(reply, e);
    }
  });

  app.delete("/api/calendar/events", async (req, reply) => {
    const q = z.object({ calendar: z.string().url(), href: z.string().url(), etag: z.string().max(200).optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { client, calendars } = await open(req);
      const cal = pickCollection(calendars, q.data.calendar);
      if (!cal || !belongsTo([cal], q.data.href)) return reply.code(404).send({ error: "not_found" });
      ensureOk(await client.deleteCalendarObject({ calendarObject: { url: q.data.href, etag: q.data.etag } }));
      return { ok: true };
    } catch (e) {
      req.log.error({ err: e }, "event delete failed");
      return fail(reply, e);
    }
  });
}
