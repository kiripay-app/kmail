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
export interface MsgDetail {
  uid: number; subject: string; from: Addr[]; to: Addr[]; cc: Addr[]; date: string | null;
  html: string; blockedRemoteImages: boolean; attachments: Attachment[];
}
export interface SendBody {
  to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; inReplyTo?: string;
  attachments: { filename: string; contentType?: string; base64: string }[];
}

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
  attachmentUrl: (folder: string, uid: number, index: number) => `${BASE}/mail/messages/${uid}/attachments/${index}?${q({ folder })}`,
};
