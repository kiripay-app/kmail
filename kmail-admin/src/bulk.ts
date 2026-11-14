/** Parsers for the bulk-import commands (migration from another mail server). Pure functions so they can be tested. */
const domainRe = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const localRe = /^[a-z0-9][a-z0-9._+-]{0,63}$/i;

export interface NewMailbox { address: string; localPart: string; domain: string; name: string; quotaMiB?: number }
export interface NewAlias { address: string; goto: string }

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

function splitAddress(a: string): { localPart: string; domain: string } | undefined {
  const i = a.lastIndexOf("@");
  if (i < 1) return undefined;
  const localPart = a.slice(0, i), domain = a.slice(i + 1).toLowerCase();
  return localRe.test(localPart) && domainRe.test(domain) ? { localPart: localPart.toLowerCase(), domain } : undefined;
}

/** One mailbox per line: `address[,display name[,quota in MB]]`. */
export function parseMailboxes(text: string): { ok: NewMailbox[]; errors: string[] } {
  const ok: NewMailbox[] = [], errors: string[] = [], seen = new Set<string>();
  for (const line of lines(text)) {
    const [addr, name = "", quota] = line.split(",").map((s) => s.trim());
    const p = splitAddress(addr ?? "");
    if (!p) { errors.push(`Not a valid address: ${line}`); continue; }
    const address = `${p.localPart}@${p.domain}`;
    if (seen.has(address)) continue;
    seen.add(address);
    const q = quota === undefined || quota === "" ? undefined : Number(quota);
    if (q !== undefined && !(Number.isInteger(q) && q >= 0)) { errors.push(`Bad quota for ${address}: ${quota}`); continue; }
    ok.push({ address, ...p, name, quotaMiB: q });
  }
  return { ok, errors };
}

/** One alias per line: `alias,destination[;destination...]`. */
export function parseAliases(text: string): { ok: NewAlias[]; errors: string[] } {
  const ok: NewAlias[] = [], errors: string[] = [];
  for (const line of lines(text)) {
    const [a, rest = ""] = line.split(",").map((s) => s.trim());
    const alias = splitAddress(a ?? "");
    const targets = rest.split(/[;\s]+/).filter(Boolean);
    if (!alias || !targets.length || !targets.every((t) => splitAddress(t))) { errors.push(`Not valid: ${line}`); continue; }
    ok.push({ address: `${alias.localPart}@${alias.domain}`, goto: targets.map((t) => t.toLowerCase()).join(",") });
  }
  return { ok, errors };
}
