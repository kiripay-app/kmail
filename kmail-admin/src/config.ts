import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : ["1", "true", "yes", "y"].includes(v.toLowerCase()));

const dataDir = process.env.DATA_DIR ?? "/data";

/** Master key for encrypting 2FA secrets. From ADMIN_SECRET if set, otherwise generated once and kept in the data volume. */
function masterKey(): string {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET;
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "secret.key");
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return readFileSync(file, "utf8").trim();
}

export const config = {
  port: Number(process.env.PORT ?? 3100),
  dataDir,
  get secret() { return masterKey(); },
  cookieSecure: bool(process.env.COOKIE_SECURE, true),
  allowCidrs: (process.env.ADMIN_ALLOW_CIDRS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  issuer: process.env.ADMIN_ISSUER ?? "KMail Admin",
  idleMs: Number(process.env.ADMIN_IDLE_MINUTES ?? 30) * 60_000,
  absoluteMs: Number(process.env.ADMIN_SESSION_HOURS ?? 8) * 3_600_000,
  maxFailures: 5,
  rateMax: Number(process.env.ADMIN_RATE_MAX ?? 10),
  lockMs: Number(process.env.ADMIN_LOCK_MINUTES ?? 15) * 60_000,
  backend: (process.env.ADMIN_BACKEND ?? "mailcow") as "mailcow" | "memory",
  mailcow: {
    url: process.env.MAILCOW_API_URL ?? "https://nginx-mailcow/api/v1",
    key: process.env.MAILCOW_API_KEY ?? "",
    // The API is reached over the private Docker network where the certificate name does not match.
    rejectUnauthorized: bool(process.env.MAILCOW_API_TLS_VERIFY, false),
  },
};
