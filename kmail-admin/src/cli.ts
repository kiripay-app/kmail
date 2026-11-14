import { createAdmin, resetTwoFactor, setPassword } from "./auth.js";
import { audit } from "./audit.js";
import { randomPassword } from "./crypto.js";
import { getAdminByName, open, q, type Admin } from "./db.js";

open();
const [cmd, user] = process.argv.slice(2);
const usage = () => { console.log("usage: cli.js create-admin <user> | reset-admin <user> | list"); process.exit(1); };

if (cmd === "list") {
  for (const a of q().prepare("SELECT * FROM admins ORDER BY username").all() as unknown as Admin[])
    console.log(`${a.username}\t2fa=${a.totp_enabled ? "on" : "off"}\t${a.disabled ? "disabled" : "active"}`);
} else if (cmd === "create-admin" && user) {
  const pw = randomPassword();
  try { await createAdmin(user, pw); } catch (e: any) { console.error(/UNIQUE/.test(e.message) ? "That username already exists." : e.message); process.exit(1); }
  audit("cli", "local", "admin.create", user);
  console.log(`Created ${user}\nTemporary password: ${pw}\nSign in, choose a new password and set up the authenticator app.`);
} else if (cmd === "reset-admin" && user) {
  const a = getAdminByName(user);
  if (!a) { console.error("No such administrator."); process.exit(1); }
  const pw = randomPassword();
  await setPassword(a.id, a.username, pw, true); resetTwoFactor(a.id);
  q().prepare("UPDATE admins SET disabled = 0, failed = 0, locked_until = 0 WHERE id = ?").run(a.id);
  audit("cli", "local", "admin.reset", user);
  console.log(`Reset ${user}\nTemporary password: ${pw}\nTwo-factor was cleared; set it up again at next sign in.`);
} else usage();
