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
  attendees: { email: string; name: string; status: string }[];
}

const MAX_PER_EVENT = 750; // runaway-recurrence guard

function time(v: string, allDay: boolean): ICAL.Time {
  return allDay ? ICAL.Time.fromDateString(v.slice(0, 10)) : ICAL.Time.fromJSDate(new Date(v), true);
}

function applyInput(vevent: ICAL.Component, i: EventInput) {
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
  vevent.updatePropertyWithValue("last-modified", ICAL.Time.fromJSDate(new Date(), true));
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
}

export function buildNew(i: EventInput, uid: string): string {
  const cal = new ICAL.Component(["vcalendar", [], []]);
  cal.addPropertyWithValue("version", "2.0");
  cal.addPropertyWithValue("prodid", "-//KMail//Calendar//EN");
  const vevent = new ICAL.Component("vevent");
  vevent.addPropertyWithValue("uid", uid);
  applyInput(vevent, i);
  cal.addSubcomponent(vevent);
  return cal.toString();
}

/** Edit the series master in place so properties we do not know about (attendees, alarms we did not touch, X- props) survive. */
export function applyUpdate(data: string, i: EventInput): string {
  const cal = new ICAL.Component(ICAL.parse(data));
  const master = cal.getAllSubcomponents("vevent").find((v) => !v.hasProperty("recurrence-id"));
  if (!master) throw new Error("no_master_event");
  applyInput(master, i);
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
    const attendees = master.getAllProperties("attendee").map((a) => ({
      email: String(a.getFirstValue()).replace(/^mailto:/i, ""),
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
