import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export interface Admin {
  id: number; username: string; pw_hash: string; totp_secret_enc: string | null; totp_pending_enc: string | null; totp_enabled: number;
  totp_last_step: number; must_change_pw: number; disabled: number; failed: number; locked_until: number; created_at: number; last_login: number | null;
}

let db: DatabaseSync | undefined;
export function open(file = join(config.dataDir, "admin.db")): DatabaseSync {
  if (db) return db;
  if (file !== ":memory:") mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pw_hash TEXT NOT NULL,
      totp_secret_enc TEXT, totp_pending_enc TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_last_step INTEGER NOT NULL DEFAULT 0,
      must_change_pw INTEGER NOT NULL DEFAULT 1, disabled INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login INTEGER);
    CREATE TABLE IF NOT EXISTS recovery_codes (
      id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, used_at INTEGER);
    CREATE INDEX IF NOT EXISTS recovery_admin ON recovery_codes(admin_id);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '', ok INTEGER NOT NULL DEFAULT 1, detail TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  `);
  return db;
}
export const q = () => open();
export function resetForTests() { db = undefined; }

export const getAdminByName = (u: string) => q().prepare("SELECT * FROM admins WHERE username = ?").get(u) as unknown as Admin | undefined;
export const getAdmin = (id: number) => q().prepare("SELECT * FROM admins WHERE id = ?").get(id) as unknown as Admin | undefined;
