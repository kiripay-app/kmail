/**
 * The only seam between KMail Admin and a mail server. Everything the panel does to mail goes through this interface,
 * so supporting another backend means writing one more file here. Quotas are always MiB at this boundary (0 = unlimited).
 */
export interface Domain { name: string; description: string; active: boolean; mailboxes: number; maxMailboxes: number; quotaMiB: number; usedMiB: number }
export interface Mailbox { address: string; name: string; domain: string; active: boolean; quotaMiB: number; usedMiB: number; messages: number; lastLogin: number | null }
export interface Alias { id: string; address: string; goto: string; active: boolean }
export interface DkimInfo { domain: string; selector: string; txt: string; length: number }
export interface QueueItem { id: string; sender: string; recipients: string[]; size: number; arrival: number; reason: string }
export interface HealthItem { name: string; ok: boolean; detail: string }

export interface MailAdmin {
  readonly kind: string;
  health(): Promise<HealthItem[]>;
  listDomains(): Promise<Domain[]>;
  addDomain(d: { name: string; description?: string; quotaMiB?: number; maxMailboxes?: number }): Promise<void>;
  setDomainActive(name: string, active: boolean): Promise<void>;
  deleteDomain(name: string): Promise<void>;
  listMailboxes(domain?: string): Promise<Mailbox[]>;
  addMailbox(m: { localPart: string; domain: string; name?: string; password: string; quotaMiB: number }): Promise<void>;
  updateMailbox(address: string, p: { name?: string; quotaMiB?: number; active?: boolean; password?: string }): Promise<void>;
  deleteMailbox(address: string): Promise<void>;
  listAliases(domain?: string): Promise<Alias[]>;
  addAlias(a: { address: string; goto: string }): Promise<void>;
  setAliasActive(id: string, active: boolean): Promise<void>;
  deleteAlias(id: string): Promise<void>;
  getDkim(domain: string): Promise<DkimInfo | null>;
  createDkim(domain: string, selector: string, bits: 1024 | 2048 | 4096): Promise<void>;
  deleteDkim(domain: string): Promise<void>;
  queue(): Promise<QueueItem[]>;
  flushQueue(): Promise<void>;
  clearQueue(): Promise<void>;
  logs(kind: "postfix" | "dovecot" | "auth", count: number): Promise<string[]>;
}

export class AdminError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
