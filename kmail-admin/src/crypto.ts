import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const N = 16384, R = 8, P = 1;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scryptAsync(pw, salt, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${h.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scryptAsync(pw, Buffer.from(salt, "base64"), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

// Burn the same time for unknown usernames so response timing does not reveal which accounts exist.
let dummy: Promise<string> | undefined;
export async function dummyVerify(pw: string) { await verifyPassword(pw, await (dummy ??= hashPassword("not-a-real-password"))); }

const derive = (label: string) => createHash("sha256").update(`${label}:${config.secret}`).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", derive("totp"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function unseal(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  const d = createDecipheriv("aes-256-gcm", derive("totp"), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export const codeHash = (code: string) => createHmac("sha256", derive("recovery")).update(code.replace(/[^A-Za-z0-9]/g, "").toUpperCase()).digest("hex");

/** 10 recovery codes like ABCDE-FGHIJ (about 50 bits each). */
export function newRecoveryCodes(n = 10): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(10);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export function randomPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(18), (x) => alphabet[x % alphabet.length]).join("");
}

const COMMON = new Set(["password1234", "123456789012", "qwertyuiopas", "administrator", "letmein123456", "changeme1234", "welcome12345"]);
/** Returns a human message if the password is not acceptable, otherwise undefined. */
export function passwordProblem(pw: string, username: string): string | undefined {
  if (pw.length < 12) return "Use at least 12 characters.";
  if (pw.length > 256) return "That password is too long.";
  if (pw.toLowerCase().includes(username.toLowerCase())) return "The password must not contain your username.";
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) return "That password is too easy to guess.";
  return undefined;
}
