import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = ALPHA.indexOf(ch); if (i < 0) throw new Error("bad base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(randomBytes(20));

/** RFC 6238 / RFC 4226 with HMAC-SHA1, 6 digits, 30 second steps. */
export function codeAt(secret: string, step: number, digits = 6, algo: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac(algo, base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (ms = Date.now()) => Math.floor(ms / 30_000);

/** Accepts the current code and one step either side (clock drift). A step that was already used is refused (replay). */
export function verifyTotp(secret: string, code: string, lastUsedStep: number, now = Date.now()): { ok: boolean; step: number } {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, step: 0 };
  let hit = 0;
  for (const d of [-1, 0, 1]) {
    const step = stepAt(now) + d;
    const a = Buffer.from(codeAt(secret, step)), b = Buffer.from(clean);
    if (timingSafeEqual(a, b) && step > lastUsedStep) hit = step;
  }
  return { ok: hit > 0, step: hit };
}

export const otpauthUri = (issuer: string, account: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
