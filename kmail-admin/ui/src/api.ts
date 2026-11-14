const BASE = "/kmail-admin/api";

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method, credentials: "same-origin",
    headers: { "x-kmail-csrf": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data.error ?? `Error ${r.status}`, r.status);
  return data as T;
}
export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>("POST", p, b);
export const patch = <T = any>(p: string, b: unknown) => api<T>("PATCH", p, b);
export const del = <T = any>(p: string, b?: unknown) => api<T>("DELETE", p, b);
