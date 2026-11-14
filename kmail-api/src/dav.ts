import { createDAVClient, type DAVCalendar, type DAVAddressBook } from "tsdav";
import { config } from "./config.js";
import type { Creds } from "./imap.js";

type Client = Awaited<ReturnType<typeof createDAVClient>>;

const make = (serverUrl: string, accountType: "caldav" | "carddav", { user, pass }: Creds) =>
  createDAVClient({ serverUrl, credentials: { username: user, password: pass }, authMethod: "Basic", defaultAccountType: accountType });

export const caldav = (c: Creds) => make(config.dav.caldavUrl, "caldav", c);
export const carddav = (c: Creds) => make(config.dav.carddavUrl, "carddav", c);

/**
 * Hrefs and calendar URLs arrive from the browser. Only ever act on a collection that the server itself
 * listed for this user, so the API cannot be pointed at arbitrary URLs (SSRF) or at someone else's data.
 */
export function pickCollection<T extends { url: string }>(owned: T[], url: string): T | undefined {
  return owned.find((c) => c.url === url);
}
export function belongsTo(collections: { url: string }[], href: string): boolean {
  return collections.some((c) => href.startsWith(c.url.endsWith("/") ? c.url : c.url + "/") && !href.includes(".."));
}

export type { Client, DAVCalendar, DAVAddressBook };

export const davStatus = (e: unknown): number | undefined => {
  const m = String((e as Error)?.message ?? "").match(/\b(401|403|404|409|412)\b/);
  return m ? Number(m[1]) : undefined;
};
