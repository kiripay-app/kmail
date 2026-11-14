import { config } from "../config.js";
import { MailcowAdmin } from "./mailcow.js";
import { MemoryAdmin } from "./memory.js";
import type { MailAdmin } from "./types.js";

export function makeAdapter(): MailAdmin {
  if (config.backend === "memory") return new MemoryAdmin(process.env.ADMIN_DEMO_DATA === "1");
  if (!config.mailcow.key) throw new Error("MAILCOW_API_KEY is not set (or use ADMIN_BACKEND=memory for a demo)");
  return new MailcowAdmin(config.mailcow);
}
export type { MailAdmin } from "./types.js";
