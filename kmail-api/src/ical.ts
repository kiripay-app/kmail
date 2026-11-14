import ICAL from "ical.js";

export interface EventInput {
  title: string;
  start: string; // ISO datetime (UTC) for timed events, YYYY-MM-DD for all-day
  end: string; // all-day: exclusive end date, like iCalendar
  allDay: boolean;
  location?: string;
  description?: string;
  recurrence?: { freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"; interval?: number; count?: number; until?: string } | null;
  reminderMinutes?: number | null;
  /** Attendee emails. undefined = leave as is; [] = remove all. */
  attendees?: string[];
}

export interface Occurrence {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  recurring: boolean;
  organizer: string;
  attendees: { email: string; name: string; status: string }[];
}

const mailOf = (p: ICAL.Property) => String(p.getFirstValue()).replace(/^mailto:/i, "");
const dedupe = (a: string[]) => [...new Map(a.map((x) => [x.trim().toLowerCase(), x.trim()])).values()].filter(Boolean);
const MAX_PER_EVENT = 750; // runaway-recurrence guard

function time(v: string, allDay: boolean): ICAL.Time {
  return allDay ? ICAL.Time.fromDateString(v.slice(0, 10)) : ICAL.Time.fromJSDate(new Date(v), true);
}

function applyInput(vevent: ICAL.Component, i: EventInput, organizer?: string) {
  vevent.updatePropertyWithValue("summary", i.title);
  const dtstart = vevent.updatePropertyWithValue("dtstart", time(i.start, i.allDay));
  const dtend = vevent.updatePropertyWithValue("dtend", time(i.end, i.allDay));
  dtstart.removeParameter("tzid");
  dtend.removeParameter("tzid");
  vevent.removeProperty("duration");
  for (const [name, v] of [["location", i.location], ["description", i.description]] as const) {
    vevent.removeAllProperties(name);
    if (v) vevent.addPropertyWithValue(name, v);
  }
  // undefined = leave the existing repeat rule alone; null = stop repeating; object = set it.
  if (i.recurrence !== undefined) vevent.removeAllProperties("rrule");
  if (i.recurrence) {
    const r: Record<string, unknown> = { freq: i.recurrence.freq, interval: i.recurrence.interval ?? 1 };
    if (i.recurrence.count) r.count = i.recurrence.count;
    else if (i.recurrence.until) r.until = ICAL.Time.fromDateString(i.recurrence.until.slice(0, 10));
    vevent.addPropertyWithValue("rrule", new ICAL.Recur(r as never));
  }
  // Same convention for reminders: undefined keeps whatever alarms the event already has.
  if (i.reminderMinutes !== undefined) vevent.removeAllSubcomponents("valarm");
  if (i.reminderMinutes != null) {
    const alarm = new ICAL.Component("valarm");
    alarm.addPropertyWithValue("action", "DISPLAY");
    alarm.addPropertyWithValue("description", "Reminder");
    alarm.addPropertyWithValue("trigger", ICAL.Duration.fromSeconds(-i.reminderMinutes * 60));
    vevent.addSubcomponent(alarm);
  }
  if (i.attendees !== undefined) {
    const previous = new Map(vevent.getAllProperties("attendee").map((a) => [mailOf(a).toLowerCase(), String(a.getParameter("partstat") ?? "NEEDS-ACTION")]));
    vevent.removeAllProperties("attendee");
    for (const email of dedupe(i.attendees)) {
      const a = new ICAL.Property("attendee");
      a.setValue(`mailto:${email}`);
      a.setParameter("partstat", previous.get(email.toLowerCase()) ?? "NEEDS-ACTION");
      a.setParameter("role", "REQ-PARTICIPANT");
      a.setParameter("rsvp", "TRUE");
      vevent.addProperty(a);
    }
    if (i.attendees.length === 0) vevent.removeAllProperties("organizer");
    else if (!vevent.hasProperty("organizer") && organizer) {
      const o = new ICAL.Property("organizer");
      o.setValue(`mailto:${organizer}`);
      vevent.addProperty(o);
    }
  }
  vevent.updatePropertyWithValue("last-modified", ICAL.Time.fromJSDate(new Date(), true));
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
}

export function buildNew(i: EventInput, uid: string, organizer?: string): string {
  const cal = new ICAL.Component(["vcalendar", [], []]);
  cal.addPropertyWithValue("version", "2.0");
  cal.addPropertyWithValue("prodid", "-//KMail//Calendar//EN");
  const vevent = new ICAL.Component("vevent");
  vevent.addPropertyWithValue("uid", uid);
  applyInput(vevent, i, organizer);
  cal.addSubcomponent(vevent);
  return cal.toString();
}

/** Edit the series master in place so properties we do not know about (attendees, alarms we did not touch, X- props) survive. */
export function applyUpdate(data: string, i: EventInput, organizer?: string): string {
  const cal = new ICAL.Component(ICAL.parse(data));
  const master = cal.getAllSubcomponents("vevent").find((v) => !v.hasProperty("recurrence-id"));
  if (!master) throw new Error("no_master_event");
  applyInput(master, i, organizer);
  if (master.hasProperty("attendee")) master.updatePropertyWithValue("sequence", Number(master.getFirstPropertyValue("sequence") ?? 0) + 1);
  return cal.toString();
}

export function expand(data: string, from: Date, to: Date): Occurrence[] {
  const cal = new ICAL.Component(ICAL.parse(data));
  for (const vtz of cal.getAllSubcomponents("vtimezone")) {
    const tz = new ICAL.Timezone(vtz);
    if (!ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz);
  }
  const vevents = cal.getAllSubcomponents("vevent");
  const exceptions = vevents.filter((v) => v.hasProperty("recurrence-id"));
  const out: Occurrence[] = [];

  for (const master of vevents.filter((v) => !v.hasProperty("recurrence-id"))) {
    const ev = new ICAL.Event(master);
    for (const x of exceptions) if (x.getFirstPropertyValue("uid") === ev.uid) ev.relateException(new ICAL.Event(x));
    const allDay = ev.startDate.isDate;
    const organizer = master.getFirstProperty("organizer") ? mailOf(master.getFirstProperty("organizer")!) : "";
    const attendees = master.getAllProperties("attendee").map((a) => ({
      email: mailOf(a),
      name: String(a.getParameter("cn") ?? ""),
      status: String(a.getParameter("partstat") ?? "NEEDS-ACTION"),
    }));
    const push = (start: ICAL.Time, end: ICAL.Time, e: ICAL.Event) => {
      const s = start.toJSDate(), en = end.toJSDate();
      if (en <= from && s < from) return;
      if (s >= to) return;
      out.push({
        uid: ev.uid,
        title: e.summary || "(no title)",
        start: allDay ? start.toString().slice(0, 10) : s.toISOString(),
        end: allDay ? end.toString().slice(0, 10) : en.toISOString(),
        allDay,
        location: e.location || "",
        description: e.description || "",
        recurring: ev.isRecurring(),
        organizer,
        attendees,
      });
    };
    if (!ev.isRecurring()) {
      push(ev.startDate, ev.endDate, ev);
      continue;
    }
    const it = ev.iterator();
    for (let n = 0, next = it.next(); next && n < MAX_PER_EVENT; next = it.next(), n++) {
      if (next.toJSDate() >= to) break;
      const d = ev.getOccurrenceDetails(next);
      push(d.startDate, d.endDate, d.item);
    }
  }
  return out;
}

export function firstEventFields(data: string): Occurrence | undefined {
  const far = new Date("2100-01-01");
  return expand(data, new Date("1970-01-01"), far)[0];
}

// ---------- invitations (iTIP / iMIP) ----------

export type Method = "REQUEST" | "REPLY" | "CANCEL";
export type PartStat = "ACCEPTED" | "TENTATIVE" | "DECLINED";

export interface Invite {
  method: string;
  uid: string;
  sequence: number;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  organizer: { name: string; email: string };
  attendees: { email: string; name: string; status: string }[];
}

const firstEvent = (cal: ICAL.Component) => cal.getAllSubcomponents("vevent").find((v) => !v.hasProperty("recurrence-id")) ?? cal.getFirstSubcomponent("vevent");

export function parseInvite(ics: string): Invite | undefined {
  try {
    const cal = new ICAL.Component(ICAL.parse(ics));
    const v = firstEvent(cal);
    if (!v) return undefined;
    const ev = new ICAL.Event(v);
    const org = v.getFirstProperty("organizer");
    const allDay = ev.startDate.isDate;
    return {
      method: String(cal.getFirstPropertyValue("method") ?? "").toUpperCase(),
      uid: ev.uid,
      sequence: Number(v.getFirstPropertyValue("sequence") ?? 0),
      title: ev.summary || "(no title)",
      start: allDay ? ev.startDate.toString().slice(0, 10) : ev.startDate.toJSDate().toISOString(),
      end: allDay ? ev.endDate.toString().slice(0, 10) : ev.endDate.toJSDate().toISOString(),
      allDay,
      location: ev.location || "",
      organizer: { name: String(org?.getParameter("cn") ?? ""), email: org ? mailOf(org) : "" },
      attendees: v.getAllProperties("attendee").map((a) => ({ email: mailOf(a), name: String(a.getParameter("cn") ?? ""), status: String(a.getParameter("partstat") ?? "NEEDS-ACTION") })),
    };
  } catch {
    return undefined;
  }
}

export function withMethod(ics: string, method: Method | null): string {
  const cal = new ICAL.Component(ICAL.parse(ics));
  cal.removeAllProperties("method");
  if (method) cal.addPropertyWithValue("method", method);
  if (method === "CANCEL") {
    for (const v of cal.getAllSubcomponents("vevent")) {
      v.updatePropertyWithValue("status", "CANCELLED");
      v.updatePropertyWithValue("sequence", Number(v.getFirstPropertyValue("sequence") ?? 0) + 1);
    }
  }
  return cal.toString();
}

/** Set one attendee's reply on every VEVENT of the object (adding them if they were invited under another address). */
export function setPartstat(data: string, email: string, status: PartStat): string {
  const cal = new ICAL.Component(ICAL.parse(data));
  for (const v of cal.getAllSubcomponents("vevent")) {
    const mine = v.getAllProperties("attendee").find((a) => mailOf(a).toLowerCase() === email.toLowerCase());
    if (mine) mine.setParameter("partstat", status);
    else if (v.hasProperty("organizer")) {
      const a = new ICAL.Property("attendee");
      a.setValue(`mailto:${email}`);
      a.setParameter("partstat", status);
      v.addProperty(a);
    }
  }
  return cal.toString();
}

export function buildReply(invite: string, me: string, status: PartStat): string {
  const src = new ICAL.Component(ICAL.parse(invite));
  const v = firstEvent(src)!;
  const cal = new ICAL.Component(["vcalendar", [], []]);
  cal.addPropertyWithValue("version", "2.0");
  cal.addPropertyWithValue("prodid", "-//KMail//Calendar//EN");
  cal.addPropertyWithValue("method", "REPLY");
  const r = new ICAL.Component("vevent");
  for (const name of ["uid", "dtstart", "dtend", "summary", "organizer", "sequence", "recurrence-id"]) {
    const p = v.getFirstProperty(name);
    if (p) r.addProperty(new ICAL.Property(p.toJSON(), r));
  }
  const a = new ICAL.Property("attendee");
  a.setValue(`mailto:${me}`);
  a.setParameter("partstat", status);
  r.addProperty(a);
  r.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  cal.addSubcomponent(r);
  return cal.toString();
}

/** Split an .ics export into one VCALENDAR per UID (a series and its exceptions stay together), keeping time zone definitions. */
export function splitByUid(ics: string): { uid: string; data: string }[] {
  const cal = new ICAL.Component(ICAL.parse(ics));
  const tzs = cal.getAllSubcomponents("vtimezone");
  const groups = new Map<string, ICAL.Component[]>();
  for (const v of cal.getAllSubcomponents("vevent")) {
    const uid = String(v.getFirstPropertyValue("uid") ?? "");
    if (!uid) continue;
    groups.set(uid, [...(groups.get(uid) ?? []), v]);
  }
  return [...groups].map(([uid, vs]) => {
    const out = new ICAL.Component(["vcalendar", [], []]);
    out.addPropertyWithValue("version", "2.0");
    out.addPropertyWithValue("prodid", "-//KMail//Import//EN");
    for (const t of tzs) out.addSubcomponent(new ICAL.Component(t.toJSON()));
    for (const v of vs) out.addSubcomponent(new ICAL.Component(v.toJSON()));
    return { uid, data: out.toString() };
  });
}
