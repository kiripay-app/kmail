import { isIP } from "node:net";

const v4 = (ip: string) => ip.split(".").reduce((a, o) => (a << 8n) + BigInt(Number(o)), 0n);

/** True when `ip` is inside one of the CIDR blocks (IPv4 ranges; IPv6 must match exactly). An empty list allows everyone. */
export function allowed(ip: string, cidrs: string[]): boolean {
  if (!cidrs.length) return true;
  const addr = ip.replace(/^::ffff:/, "");
  return cidrs.some((c) => {
    const [base, bitsStr] = c.split("/");
    if (isIP(addr) === 4 && isIP(base) === 4) {
      const bits = bitsStr === undefined ? 32 : Number(bitsStr);
      if (!(bits >= 0 && bits <= 32)) return false;
      const shift = BigInt(32 - bits);
      return (v4(addr) >> shift) === (v4(base) >> shift);
    }
    return addr === base;
  });
}
