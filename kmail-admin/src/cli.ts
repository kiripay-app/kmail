import { readFileSync } from "node:fs";
import { makeAdapter } from "./adapters/index.js";
import { AdminError } from "./adapters/types.js";
import { parseAliases, parseMailboxes } from "./bulk.js";
import { createAdmin, resetTwoFactor, setPassword } from "./auth.js";
import { audit } from "./audit.js";
import { randomPassword } from "./crypto.js";
import { getAdminByName, open, q, type Admin } from "./db.js";

open();
const [cmd, user] = process.argv.slice(2);
const usage = () => { console.log("usage: cli.js create-admin <user> | reset-admin <user> | list\n       cli.js import-mailboxes [--quota MB] [--dry] < accounts.txt > passwords.csv\n       cli.js import-aliases [--dry] < aliases.csv"); process.exit(1); };
const flag = (n: string) => process.argv.includes(n);
const opt = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const stdin = () => readFileSync(0, "utf8");
const say = (m: string) => console.error(m);

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
} else if (cmd === "import-mailboxes") {
  // Creates mailboxes with random one-time passwords. CSV `address,password` goes to stdout, progress to stderr.
  const { ok, errors } = parseMailboxes(stdin());
  errors.forEach((e) => say(`SKIP  ${e}`));
  const defQuota = Number(opt("--quota") ?? 2048);
  const mc = makeAdapter();
  const domains = new Set((await mc.listDomains()).map((d) => d.name));
  const missing = [...new Set(ok.map((m) => m.domain))].filter((d) => !domains.has(d));
  if (missing.length) { say(`Add these domains first (Domains page, or in mailcow): ${missing.join(", ")}`); process.exit(1); }
  const have = new Set((await mc.listMailboxes()).map((m) => m.address));
  let made = 0;
  for (const m of ok) {
    if (have.has(m.address)) { say(`EXISTS ${m.address} (left alone)`); continue; }
    if (flag("--dry")) { say(`WOULD CREATE ${m.address}`); continue; }
    const pw = randomPassword();
    try { await mc.addMailbox({ localPart: m.localPart, domain: m.domain, name: m.name, password: pw, quotaMiB: m.quotaMiB ?? defQuota }); }
    catch (e) { say(`FAILED ${m.address}: ${(e as AdminError).message}`); audit("cli", "local", "mailbox.add", m.address, false, (e as Error).message); continue; }
    audit("cli", "local", "mailbox.add", m.address, true, "bulk import");
    console.log(`${m.address},${pw}`); made++;
  }
  say(`${flag("--dry") ? "Dry run: " : ""}${made} created, ${ok.length - made} not created.`);
} else if (cmd === "import-aliases") {
  const { ok, errors } = parseAliases(stdin());
  errors.forEach((e) => say(`SKIP  ${e}`));
  const mc = makeAdapter();
  const have = new Set((await mc.listAliases()).map((a) => a.address));
  let made = 0;
  for (const a of ok) {
    if (have.has(a.address)) { say(`EXISTS ${a.address} (left alone)`); continue; }
    if (flag("--dry")) { say(`WOULD CREATE ${a.address} -> ${a.goto}`); continue; }
    try { await mc.addAlias(a); } catch (e) { say(`FAILED ${a.address}: ${(e as Error).message}`); audit("cli", "local", "alias.add", a.address, false, (e as Error).message); continue; }
    audit("cli", "local", "alias.add", a.address, true, "bulk import"); made++;
  }
  say(`${made} aliases created.`);
} else usage();
