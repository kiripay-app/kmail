const BASE = "/kmail/api";

export class AuthError extends Error {}
export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-kmail-csrf": "1" };
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(BASE + path, { ...init, body, headers, credentials: "same-origin" });
  if (res.status === 401 && !path.startsWith("/auth/login")) throw new AuthError();
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({ error: "error" }))).error);
  return res.json() as Promise<T>;
}

export interface Addr { name: string; address: string }
export interface Folder { path: string; name: string; specialUse: string | null; total: number; unseen: number }
export interface MsgSummary { uid: number; subject: string; from: Addr; date: string | null; seen: boolean; flagged: boolean }
export interface MsgList { total: number; page: number; pageSize: number; messages: MsgSummary[] }
export interface Attachment { index: number; filename: string; size: number; contentType: string }
export interface Invitation {
  method: string; uid: string; title: string; start: string; end: string; allDay: boolean; location: string;
  organizer: { name: string; email: string }; attendeeCount: number; attendees: { email: string; name: string; status: string }[]; myStatus: string | null;
}
export type InviteAction = "ACCEPTED" | "TENTATIVE" | "DECLINED" | "APPLY_REPLY" | "APPLY_CANCEL";
export interface MsgDetail {
  invitation: Invitation | null;
  uid: number; subject: string; from: Addr[]; to: Addr[]; cc: Addr[]; date: string | null;
  html: string; blockedRemoteImages: boolean; attachments: Attachment[];
}
export interface SendBody {
  to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; inReplyTo?: string;
  attachments: { filename: string; contentType?: string; base64: string }[];
}

export interface Cal { id: string; name: string; color: string | null }
export interface Recurrence { freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"; interval?: number; count?: number; until?: string }
export interface CalEvent {
  id: string; uid: string; title: string; start: string; end: string; allDay: boolean; location: string; description: string;
  recurring: boolean; organizer: string; attendees: { email: string; name: string; status: string }[]; calendar: string; href: string; etag: string;
}
// recurrence / reminderMinutes: undefined = leave as is (updates), null = remove, value = set.
export interface EventInput {
  calendar: string; title: string; start: string; end: string; allDay: boolean; location?: string; description?: string;
  recurrence?: Recurrence | null; reminderMinutes?: number | null; attendees?: string[]; // undefined = unchanged
}
export interface Book { id: string; name: string }
export interface ContactInput { book: string; firstName?: string; lastName?: string; emails: string[]; phones: string[]; org?: string; notes?: string }
export interface Contact { id: string; href: string; etag: string; book: string; uid: string; name: string; firstName: string; lastName: string; emails: string[]; phones: string[]; org: string; notes: string }

const q2 = (o: Record<string, string>) => new URLSearchParams(o).toString();
const q = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  me: () => call<{ email: string }>("/auth/me"),
  login: (email: string, password: string) => call<{ email: string }>("/auth/login", { method: "POST", json: { email, password } }),
  logout: () => call<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  folders: () => call<Folder[]>("/mail/folders"),
  messages: (folder: string, page: number, search?: string) => call<MsgList>(`/mail/messages?${q({ folder, page, q: search || undefined })}`),
  message: (folder: string, uid: number, images: boolean) => call<MsgDetail>(`/mail/messages/${uid}?${q({ folder, images: images ? 1 : 0 })}`),
  patch: (folder: string, uid: number, body: { seen?: boolean; flagged?: boolean; moveTo?: string }) =>
    call<{ ok: boolean }>(`/mail/messages/${uid}`, { method: "PATCH", json: { folder, ...body } }),
  remove: (folder: string, uid: number) => call<{ ok: boolean }>(`/mail/messages/${uid}?${q({ folder })}`, { method: "DELETE" }),
  send: (b: SendBody) => call<{ ok: boolean }>("/mail/send", { method: "POST", json: b }),
  calendars: () => call<Cal[]>("/calendar/calendars"),
  events: (start: string, end: string, calendars: string[]) =>
    call<{ events: CalEvent[]; failed: string[] }>(`/calendar/events?${q({ start, end, calendars: calendars.join(",") })}`),
  createEvent: (i: EventInput) => call<{ ok: boolean }>("/calendar/events", { method: "POST", json: i }),
  updateEvent: (i: EventInput & { href: string; etag: string }) => call<{ ok: boolean }>("/calendar/events", { method: "PUT", json: i }),
  deleteEvent: (calendar: string, href: string, etag: string) => call<{ ok: boolean }>(`/calendar/events?${q({ calendar, href, etag })}`, { method: "DELETE" }),
  books: () => call<Book[]>("/contacts/books"),
  contacts: (search?: string) => call<{ contacts: Contact[]; total: number }>(`/contacts?${q({ q: search || undefined })}`),
  createContact: (c: ContactInput) => call<{ ok: boolean }>("/contacts", { method: "POST", json: c }),
  updateContact: (c: ContactInput & { href: string; etag: string }) => call<{ ok: boolean }>("/contacts", { method: "PUT", json: c }),
  deleteContact: (book: string, href: string, etag: string) => call<{ ok: boolean }>(`/contacts?${q({ book, href, etag })}`, { method: "DELETE" }),
  respondInvitation: (folder: string, uid: number, action: InviteAction) =>
    call<{ ok: boolean; replied?: boolean }>(`/mail/messages/${uid}/invitation`, { method: "POST", json: { folder, action } }),
  rsvp: (i: { calendar: string; href: string; etag: string; status: "ACCEPTED" | "TENTATIVE" | "DECLINED" }) => call<{ ok: boolean }>("/calendar/events/rsvp", { method: "PUT", json: i }),
  importIcs: (calendar: string, ics: string) => call<{ imported: number; skipped: number; failed: number }>("/calendar/import", { method: "POST", json: { calendar, ics } }),
  importVcf: (book: string, vcf: string) => call<{ imported: number; skipped: number; failed: number }>("/contacts/import", { method: "POST", json: { book, vcf } }),
  suggest: (q: string) => call<{ name: string; email: string }[]>(`/contacts/suggest?${q2({ q })}`),
  attachmentUrl: (folder: string, uid: number, index: number) => `${BASE}/mail/messages/${uid}/attachments/${index}?${q({ folder })}`,
};
