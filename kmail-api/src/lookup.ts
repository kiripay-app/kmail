import type { DAVCalendar, Client } from "./dav.js";

export interface Found { calendar: DAVCalendar; url: string; etag: string; data: string }

/** Find the calendar object holding an event UID. `near` narrows the search window (the invite's own start). */
export async function findByUid(client: Client, calendars: DAVCalendar[], uid: string, near: Date): Promise<Found | undefined> {
  const start = new Date(+near - 2 * 86_400_000).toISOString();
  const end = new Date(+near + 2 * 86_400_000).toISOString();
  for (const calendar of calendars) {
    const objs = await client.fetchCalendarObjects({ calendar, timeRange: { start, end } }).catch(() => []);
    const hit = objs.find((o) => typeof o.data === "string" && o.data.includes(uid) && new RegExp(`^UID:${uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(o.data));
    if (hit) return { calendar, url: hit.url, etag: hit.etag ?? "", data: hit.data as string };
  }
  return undefined;
}

export const safeName = (uid: string) => uid.replace(/[^A-Za-z0-9@._-]/g, "_").slice(0, 120) || "event";
