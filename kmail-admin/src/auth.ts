import { config } from "./config.js";
import { codeHash, dummyVerify, newRecoveryCodes, passwordProblem, hashPassword, seal, unseal, verifyPassword } from "./crypto.js";
import { type Admin, getAdmin, getAdminByName, q } from "./db.js";
import { newSecret, verifyTotp } from "./totp.js";

export type Fail = { ok: false; reason: "invalid" | "locked" | "disabled" };

export function isLocked(a: Admin, now = Date.now()) { return a.locked_until > now; }

function registerFailure(a: Admin, now = Date.now()) {
  const failed = a.failed + 1;
  if (failed >= config.maxFailures) q().prepare("UPDATE admins SET failed = 0, locked_until = ? WHERE id = ?").run(now + config.lockMs, a.id);
  else q().prepare("UPDATE admins SET failed = ? WHERE id = ?").run(failed, a.id);
}
const clearFailures = (a: Admin) => q().prepare("UPDATE admins SET failed = 0, locked_until = 0 WHERE id = ?").run(a.id);

/** Step 1. The same "invalid" answer is given for unknown user and wrong password. */
export async function checkPassword(username: string, password: string): Promise<{ ok: true; admin: Admin } | Fail> {
  const a = getAdminByName(username);
  if (!a) { await dummyVerify(password); return { ok: false, reason: "invalid" }; }
  if (isLocked(a)) return { ok: false, reason: "locked" };
  const good = await verifyPassword(password, a.pw_hash);
  if (!good) { registerFailure(a); return { ok: false, reason: "invalid" }; }
  if (a.disabled) return { ok: false, reason: "disabled" };
  return { ok: true, admin: a };
}

/** Step 2: a 6 digit authenticator code or a recovery code. Returns which was used. */
export function checkSecondFactor(adminId: number, input: string, now = Date.now()): { ok: boolean; used?: "totp" | "recovery"; locked?: boolean } {
  const a = getAdmin(adminId);
  if (!a || a.disabled || !a.totp_enabled || !a.totp_secret_enc) return { ok: false };
  if (isLocked(a, now)) return { ok: false, locked: true };
  const t = verifyTotp(unseal(a.totp_secret_enc), input, a.totp_last_step, now);
  if (t.ok) {
    q().prepare("UPDATE admins SET totp_last_step = ?, failed = 0, locked_until = 0, last_login = ? WHERE id = ?").run(t.step, now, a.id);
    return { ok: true, used: "totp" };
  }
  const h = codeHash(input);
  const row = q().prepare("SELECT id FROM recovery_codes WHERE admin_id = ? AND code_hash = ? AND used_at IS NULL").get(a.id, h) as { id: number } | undefined;
  if (row && input.replace(/[^A-Za-z0-9]/g, "").length === 10) {
    q().prepare("UPDATE recovery_codes SET used_at = ? WHERE id = ?").run(now, row.id);
    q().prepare("UPDATE admins SET failed = 0, locked_until = 0, last_login = ? WHERE id = ?").run(now, a.id);
    return { ok: true, used: "recovery" };
  }
  registerFailure(a, now);
  return { ok: false, locked: isLocked(getAdmin(a.id)!, now) };
}

export const recoveryLeft = (adminId: number) =>
  (q().prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE admin_id = ? AND used_at IS NULL").get(adminId) as { n: number }).n;

/** Start enrolment: a fresh pending secret (not active until a code proves the phone has it). */
export function beginEnrol(adminId: number): string {
  const secret = newSecret();
  q().prepare("UPDATE admins SET totp_pending_enc = ? WHERE id = ?").run(seal(secret), adminId);
  return secret;
}
export function pendingSecret(adminId: number): string | undefined {
  const a = getAdmin(adminId);
  return a?.totp_pending_enc ? unseal(a.totp_pending_enc) : undefined;
}

export function storeRecovery(adminId: number): string[] {
  const codes = newRecoveryCodes();
  q().prepare("DELETE FROM recovery_codes WHERE admin_id = ?").run(adminId);
  const ins = q().prepare("INSERT INTO recovery_codes (admin_id, code_hash) VALUES (?, ?)");
  for (const c of codes) ins.run(adminId, codeHash(c));
  return codes;
}

/** Finish enrolment. Returns recovery codes (shown once) or undefined if the code was wrong. */
export function finishEnrol(adminId: number, code: string, now = Date.now()): string[] | undefined {
  const secret = pendingSecret(adminId);
  if (!secret) return undefined;
  const t = verifyTotp(secret, code, 0, now);
  if (!t.ok) return undefined;
  q().prepare("UPDATE admins SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_enabled = 1, totp_last_step = ?, last_login = ? WHERE id = ?").run(t.step, now, adminId);
  return storeRecovery(adminId);
}

export async function setPassword(adminId: number, username: string, pw: string, mustChange = false): Promise<string | undefined> {
  const problem = passwordProblem(pw, username);
  if (problem) return problem;
  q().prepare("UPDATE admins SET pw_hash = ?, must_change_pw = ? WHERE id = ?").run(await hashPassword(pw), mustChange ? 1 : 0, adminId);
}

export async function createAdmin(username: string, password: string): Promise<number> {
  if (!/^[a-z0-9._-]{3,32}$/i.test(username)) throw new Error("Usernames are 3-32 letters, digits, dot, dash or underscore.");
  const r = q().prepare("INSERT INTO admins (username, pw_hash, created_at) VALUES (?, ?, ?)").run(username, await hashPassword(password), Date.now());
  return Number(r.lastInsertRowid);
}

/** Lost phone and no recovery codes: an operator with shell access can reset 2FA, and the admin re-enrols at next login. */
export function resetTwoFactor(adminId: number) {
  q().prepare("UPDATE admins SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?").run(adminId);
  q().prepare("DELETE FROM recovery_codes WHERE admin_id = ?").run(adminId);
}
export const adminCount = () => (q().prepare("SELECT COUNT(*) AS n FROM admins WHERE disabled = 0").get() as { n: number }).n;
