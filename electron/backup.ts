/**
 * Slice S8 — daily auto backup + Export / Restore (Offline Tier-1).
 *
 * The shop's SQLite database lives on the PC's hard drive
 * (`%APPDATA%\Aankh\aankh.db` on Windows); this module owns the file
 * copies around it. It deliberately imports nothing from `electron`,
 * so the slice test can drive it under plain Node with a temp-file
 * store (see `scripts/test-backup-restore.ts`).
 *
 * - Daily auto backup: one dated copy per day in
 *   `%APPDATA%\Aankh\backups\` (`aankh-YYYY-MM-DD.db`), 30-day
 *   retention (UMAIR's decision 1, 2026-11-17). The copy goes through
 *   SQLite's own online backup API (`LocalStore.backup`), so the
 *   snapshot is consistent — WAL content included, no torn file —
 *   and no explicit WAL checkpoint is needed.
 * - Export: the same snapshot written to a user-chosen path (USB
 *   stick, folder) via the native save dialog (main process).
 * - Restore: the chosen file is validated first (it must open as a
 *   SQLite database and hold every Tier-1 table); the current
 *   database is safety-copied to the backup folder BEFORE it is
 *   replaced, so a restore can never silently destroy data; the app
 *   then restarts so the restored database takes effect.
 *
 * Nothing here knows about the sync engine or the server: a backup
 * is a file copy, and a restored database re-syncs on the next
 * engine run exactly like any other local database.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";

/** Backup folder name under Electron `userData` (`%APPDATA%\Aankh\`). */
export const BACKUP_DIR_NAME = "backups";
/** Daily copies kept (UMAIR's decision 1, 2026-11-17). */
export const BACKUP_RETENTION_DAYS = 30;
/** File prefix for every backup this module writes. */
export const BACKUP_FILE_PREFIX = "aankh-";

/** `%APPDATA%\Aankh\backups\` — the default backup folder. */
export function backupDirFor(userDataPath: string): string {
  return path.join(userDataPath, BACKUP_DIR_NAME);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** `aankh-2026-11-17.db` — the daily backup file for a date. */
export function backupFileName(date: Date): string {
  return `${BACKUP_FILE_PREFIX}${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.db`;
}

/**
 * `aankh-before-restore-2026-11-17-043015.db` — the safety copy of
 * the live database taken immediately before a restore replaces it.
 * The time stamp keeps it distinct from the daily copy.
 */
export function safetyBackupFileName(date: Date): string {
  return `${BACKUP_FILE_PREFIX}before-restore-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.db`;
}

const BACKUP_FILE_PATTERN =
  /^aankh-(?:before-restore-)?(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2})(\d{2}))?\.db$/;

/** The date a backup file name carries, or null when it is not one of ours. */
export function parseBackupFileName(name: string): Date | null {
  const match = BACKUP_FILE_PATTERN.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const second = match[6] ? Number(match[6]) : 0;
  const date = new Date(year, month - 1, day, hour, minute, second);
  // The Date constructor rolls impossible dates over (month 13
  // becomes next January) — reject anything that did not survive.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export interface BackupFileEntry {
  name: string;
  path: string;
  date: Date | null;
}

/** Our backup files in a folder, oldest name first. Unrecognised files are ignored. */
export function listBackupFiles(dir: string): BackupFileEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => BACKUP_FILE_PATTERN.test(name))
    .map((name) => ({ name, path: path.join(dir, name), date: parseBackupFileName(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete backup files older than `retentionDays` (default 30).
 * Returns the deleted file names. Files we cannot date are never
 * deleted — a backup we do not recognise is not ours to remove.
 */
export function pruneOldBackups(
  dir: string,
  now: Date = new Date(),
  retentionDays: number = BACKUP_RETENTION_DAYS,
): string[] {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const deleted: string[] = [];
  for (const entry of listBackupFiles(dir)) {
    if (entry.date && entry.date.getTime() < cutoff) {
      try {
        fs.unlinkSync(entry.path);
        deleted.push(entry.name);
      } catch {
        // One undeletable file must not stop the rest.
      }
    }
  }
  return deleted;
}

export interface DailyBackupStore {
  /** Consistent snapshot of the live database to `destinationPath`. */
  backup(destinationPath: string): Promise<void>;
}

/**
 * Run the daily backup: one dated copy per day in the backup folder.
 * A second run on the same day is a no-op (the copy already exists);
 * retention runs on every pass. Never deletes anything except our
 * own dated backups older than the retention window.
 */
export async function runDailyBackup(
  store: DailyBackupStore,
  userDataPath: string,
  now: Date = new Date(),
): Promise<{ created: boolean; path: string; pruned: string[] }> {
  const dir = backupDirFor(userDataPath);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, backupFileName(now));
  let created = false;
  if (!fs.existsSync(target)) {
    await store.backup(target);
    created = true;
  }
  const pruned = pruneOldBackups(dir, now);
  return { created, path: target, pruned };
}

/**
 * Every table a Tier-1 database must hold. A file missing any of
 * these is not an Aankh backup — the restore refuses it.
 */
export const REQUIRED_BACKUP_TABLES = [
  "local_sales",
  "identity_cache",
  "sync_issues",
  "mirrors",
  "meta",
  "local_customers",
  "local_purchases",
  "local_suppliers",
  "local_returns",
  "local_payments",
  "local_expenses",
] as const;

export type BackupValidation =
  | { ok: true }
  | {
      ok: false;
      reason: "missing-file" | "not-a-database" | "missing-tables";
      missingTables?: string[];
    };

/**
 * Check a file is an Aankh backup: it exists, it opens as SQLite,
 * and it holds every Tier-1 table. Read-only — validation never
 * writes to the candidate file (it may live on a USB stick).
 */
export function validateBackupFile(filePath: string): BackupValidation {
  if (!fs.existsSync(filePath)) return { ok: false, reason: "missing-file" };
  let db: Database.Database;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch {
    return { ok: false, reason: "not-a-database" };
  }
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    const missing = REQUIRED_BACKUP_TABLES.filter((table) => !names.has(table));
    if (missing.length > 0) return { ok: false, reason: "missing-tables", missingTables: missing };
    return { ok: true };
  } catch {
    // A file that opens but cannot be queried is not a database.
    return { ok: false, reason: "not-a-database" };
  } finally {
    db.close();
  }
}

export interface RestoreDeps {
  /** The live store: safety-copied first, then closed before the swap. */
  store: DailyBackupStore & { close(): void };
  /** Live database file (`%APPDATA%\Aankh\aankh.db`). */
  dbPath: string;
  /** Electron `userData` (`%APPDATA%\Aankh\`). */
  userDataPath: string;
  /** The validated backup file to restore from. */
  sourcePath: string;
  now?: Date;
  /**
   * Called after the swap, so the app restarts on the restored
   * database. The caller owns it (main: `app.relaunch()` +
   * `app.quit()`); the test passes a spy instead.
   */
  restart?: () => void;
}

/**
 * Restore a backup over the live database. Order matters:
 * 1. validate the source (an invalid file changes nothing),
 * 2. safety-copy the live database to the backup folder,
 * 3. close the live store,
 * 4. copy the source to a temp file, then rename it over the live
 *    database (the rename is the atomic step — a failed copy leaves
 *    the live database untouched),
 * 5. restart via `deps.restart`.
 */
export async function restoreFromBackup(
  deps: RestoreDeps,
): Promise<{ ok: boolean; error?: string; safetyPath?: string }> {
  const now = deps.now ?? new Date();
  const validation = validateBackupFile(deps.sourcePath);
  if (!validation.ok) return { ok: false, error: "invalid-file" };
  const dir = backupDirFor(deps.userDataPath);
  fs.mkdirSync(dir, { recursive: true });
  const safetyPath = path.join(dir, safetyBackupFileName(now));
  try {
    await deps.store.backup(safetyPath);
  } catch {
    return { ok: false, error: "safety-backup-failed" };
  }
  pruneOldBackups(dir, now);
  deps.store.close();
  for (const suffix of ["-wal", "-shm"]) {
    try {
      fs.rmSync(`${deps.dbPath}${suffix}`, { force: true });
    } catch {
      // Best effort: a clean close already removed them.
    }
  }
  const tempPath = `${deps.dbPath}.restore-tmp`;
  try {
    fs.copyFileSync(deps.sourcePath, tempPath);
    fs.renameSync(tempPath, deps.dbPath);
  } catch {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best effort.
    }
    return { ok: false, error: "replace-failed" };
  }
  deps.restart?.();
  return { ok: true, safetyPath };
}
