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
 * Slice 8 (HYBRID, audit M20) — per-org scoping. The live database
 * is shared by every identity that has signed in on this PC: every
 * Tier-1 data table carries a `scope` column
 * (`${organizationId}:${profileId}`). A whole-file copy therefore
 * exports another org's queued sales/mirrors, and restoring one
 * imports them. Every backup this module writes (daily + Export) is
 * now a SCOPED copy: only the current identity's rows survive, and
 * the file is stamped with that identity in the `meta` table
 * (`backup_scope`, `backup_organization_id`, `backup_profile_id`).
 * Restore verifies the stamp against the signed-in identity and
 * refuses a foreign file with `scope-mismatch` — before any
 * safety copy, so a refused restore changes nothing. Files written
 * before Slice 8 carry no stamp (legacy): they still validate and
 * restore, because they predate scoping and the user picks them
 * explicitly from their own PC.
 *
 * The one deliberate exception is the pre-restore SAFETY copy: it is
 * a whole-file rescue copy of the live database, taken so a restore
 * can never destroy data. It stays on this PC, is never exported,
 * and restores the device to its pre-restore state.
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

/**
 * Slice 8 (HYBRID, audit M20) — one identity's scope. Every Tier-1
 * data table keys its rows by `scope`
 * (`${organizationId}:${profileId}`); a backup is stamped with the
 * scope it was written for, and restore refuses any other scope.
 */
export interface BackupScope {
  organizationId: string;
  profileId: string;
  /** `${organizationId}:${profileId}` — the value in every row's `scope` column. */
  scope: string;
}

/** Build a scope from the signed-in identity's ids. */
export function scopeForIdentity(organizationId: string, profileId: string): BackupScope {
  return { organizationId, profileId, scope: `${organizationId}:${profileId}` };
}

/**
 * Every table that carries a `scope` column — the tables a scoped
 * backup filters. `identity_cache` is a single row (the current
 * identity itself) and `meta` holds counters + the stamp, so neither
 * is filtered.
 */
export const SCOPED_BACKUP_TABLES = [
  "local_sales",
  "sync_issues",
  "local_customers",
  "local_purchases",
  "local_suppliers",
  "local_returns",
  "local_payments",
  "local_expenses",
  "mirrors",
] as const;

/** `meta` keys carrying the scope stamp in a Slice 8 backup file. */
export const BACKUP_META_FORMAT_VERSION = "backup_format_version";
export const BACKUP_META_SCOPE = "backup_scope";
export const BACKUP_META_ORGANIZATION_ID = "backup_organization_id";
export const BACKUP_META_PROFILE_ID = "backup_profile_id";
export const BACKUP_META_CREATED_AT = "backup_created_at";
/** The only stamp format this code writes (and trusts). */
export const BACKUP_FORMAT_VERSION = "1";

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
 *
 * Slice 8 — the copy is SCOPED to `scope`: only that identity's
 * rows survive, stamped in the file. With `scope: null` (nobody
 * signed in — no identity to scope to) the backup is SKIPPED: a
 * day nobody signs in creates no new org data, so skipping loses
 * nothing, and an unscoped copy would be a cross-org file. The
 * caller (main) passes the signed-in identity's scope, or null.
 */
export async function runDailyBackup(
  store: DailyBackupStore,
  userDataPath: string,
  now: Date = new Date(),
  scope: BackupScope | null = null,
): Promise<{ created: boolean; path: string; pruned: string[]; skipped?: boolean }> {
  const dir = backupDirFor(userDataPath);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, backupFileName(now));
  let created = false;
  if (scope === null) {
    // No signed-in identity: nothing to scope the copy to.
  } else if (!fs.existsSync(target)) {
    await writeScopedBackup(store, target, scope, now);
    created = true;
  }
  const pruned = pruneOldBackups(dir, now);
  return { created, path: target, pruned, skipped: scope === null };
}

/** The scope stamp a backup file carries, or null when it carries none (pre-Slice 8). */
export interface BackupScopeStamp {
  formatVersion: string;
  scope: string;
  organizationId: string;
  profileId: string;
  createdAt: string | null;
}

/**
 * Read a backup file's scope stamp from its `meta` table. Returns
 * null when the file carries no stamp keys at all — a backup written
 * before Slice 8 (legacy). A partially-stamped file returns the
 * stamp with the missing fields empty, so validation refuses it
 * (fail closed): a stamp that cannot prove its own scope is not
 * trusted. Read-only — never writes to the candidate file.
 */
export function readBackupScope(filePath: string): BackupScopeStamp | null {
  if (!fs.existsSync(filePath)) return null;
  let db: Database.Database;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
  try {
    const rows = db
      .prepare("SELECT key, value FROM meta WHERE key LIKE 'backup_%'")
      .all() as Array<{ key: string; value: string }>;
    if (rows.length === 0) return null;
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    return {
      formatVersion: byKey.get(BACKUP_META_FORMAT_VERSION) ?? "",
      scope: byKey.get(BACKUP_META_SCOPE) ?? "",
      organizationId: byKey.get(BACKUP_META_ORGANIZATION_ID) ?? "",
      profileId: byKey.get(BACKUP_META_PROFILE_ID) ?? "",
      createdAt: byKey.get(BACKUP_META_CREATED_AT) ?? null,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Scope a database file in place: delete every row whose `scope`
 * is not `scope.scope` from every scoped table, then stamp the
 * identity into `meta`. The `meta` counters survive untouched — a
 * scoped export keeps the provisional-number counters so a restore
 * never re-issues a number this device already used.
 *
 * WAL trap (the live database runs in WAL mode, and the online
 * backup API hands us a WAL file): a plain close can leave the
 * DELETEs stranded in the `-wal` sidecar, and renaming only the
 * main file would silently un-delete the other org's rows. So the
 * file is switched to `journal_mode=DELETE` first (which
 * checkpoints the WAL into the main file) and checkpointed again
 * after the transaction — every change is in the main file before
 * this returns.
 */
export function scopeBackupFile(filePath: string, scope: BackupScope, now: Date = new Date()): void {
  const db = new Database(filePath);
  try {
    db.pragma("journal_mode=DELETE");
    const stamp = db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    const scopeTx = db.transaction(() => {
      for (const table of SCOPED_BACKUP_TABLES) {
        db.prepare(`DELETE FROM ${table} WHERE scope <> ?`).run(scope.scope);
      }
      stamp.run(BACKUP_META_FORMAT_VERSION, BACKUP_FORMAT_VERSION);
      stamp.run(BACKUP_META_SCOPE, scope.scope);
      stamp.run(BACKUP_META_ORGANIZATION_ID, scope.organizationId);
      stamp.run(BACKUP_META_PROFILE_ID, scope.profileId);
      stamp.run(BACKUP_META_CREATED_AT, now.toISOString());
    });
    scopeTx();
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

/**
 * Write a scoped backup: a consistent snapshot of the live database
 * (`store.backup`, the online backup API) filtered to `scope` and
 * stamped, written to `destinationPath`. The snapshot goes to a temp
 * file in the destination directory first and is renamed into
 * place, so a failed write never leaves a half-scoped file at the
 * destination. Throws on failure; the temp file is removed.
 */
export async function writeScopedBackup(
  store: DailyBackupStore,
  destinationPath: string,
  scope: BackupScope,
  now: Date = new Date(),
): Promise<void> {
  const dir = path.dirname(destinationPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${destinationPath}.scoped-tmp`;
  try {
    await store.backup(tmpPath);
    scopeBackupFile(tmpPath, scope, now);
    fs.renameSync(tmpPath, destinationPath);
  } catch (error) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${tmpPath}${suffix}`, { force: true });
      } catch {
        // Best effort: the rename already failed, do not mask it.
      }
    }
    throw error;
  }
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
      reason: "missing-file" | "not-a-database" | "missing-tables" | "scope-mismatch";
      missingTables?: string[];
    };

/**
 * Check a file is an Aankh backup: it exists, it opens as SQLite,
 * and it holds every Tier-1 table. Read-only — validation never
 * writes to the candidate file (it may live on a USB stick).
 *
 * Slice 8 — when `expectedScope` is given, a stamped file must
 * belong to that scope: a stamp that is inconsistent with itself
 * (`scope` ≠ `${organizationId}:${profileId}`) or that names
 * another scope is refused with `scope-mismatch`. `expectedScope:
 * null` means "there is no signed-in identity" — a stamped file
 * can never match, so it is refused the same way. `expectedScope:
 * undefined` skips the scope check (legacy callers that only ask
 * "is this an Aankh backup"). An UNSTAMPED file (pre-Slice 8)
 * passes the scope check either way: it predates scoping.
 */
export function validateBackupFile(
  filePath: string,
  expectedScope?: BackupScope | null,
): BackupValidation {
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
  } catch {
    // A file that opens but cannot be queried is not a database.
    return { ok: false, reason: "not-a-database" };
  } finally {
    db.close();
  }
  if (expectedScope !== undefined) {
    const stamp = readBackupScope(filePath);
    if (stamp !== null) {
      const consistent =
        stamp.scope.length > 0 &&
        stamp.scope === `${stamp.organizationId}:${stamp.profileId}`;
      if (!consistent || expectedScope === null || stamp.scope !== expectedScope.scope) {
        return { ok: false, reason: "scope-mismatch" };
      }
    }
  }
  return { ok: true };
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
   * Slice 8 — the signed-in identity's scope. A stamped backup from
   * another scope is refused with `scope-mismatch` before anything
   * is copied, so a refused restore is a no-op. `null` means no
   * identity is signed in (a stamped file can never match);
   * `undefined` skips the scope check (legacy callers only — the
   * main process always passes the identity's scope or null).
   */
  expectedScope?: BackupScope | null;
  /**
   * Sunday small fix — a restore from an UNSTAMPED (pre-Slice-8)
   * backup needs explicit confirmation: without `allowLegacy` the
   * restore refuses with `legacy-backup` before any side effect,
   * so the renderer can show the warning and ask first.
   */
  allowLegacy?: boolean;
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
 *
 * Slice 8 — step 1 includes the scope check: a stamped file from
 * another identity is refused with `scope-mismatch` and the live
 * database is untouched (no safety copy is even taken).
 */
export async function restoreFromBackup(
  deps: RestoreDeps,
): Promise<{ ok: boolean; error?: string; safetyPath?: string }> {
  const now = deps.now ?? new Date();
  const validation = validateBackupFile(deps.sourcePath, deps.expectedScope);
  if (!validation.ok) {
    return { ok: false, error: validation.reason === "scope-mismatch" ? "scope-mismatch" : "invalid-file" };
  }
  // Sunday small fix — an unstamped (pre-Slice-8) backup is only
  // restored with explicit confirmation. Refusing here, before the
  // safety copy, means a refused restore changes nothing.
  if (readBackupScope(deps.sourcePath) === null && !deps.allowLegacy) {
    return { ok: false, error: "legacy-backup" };
  }
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
    // Sunday small fix — stamp the restored copy with the current
    // scope BEFORE it becomes the live database, so a legacy restore
    // never leaves an unstamped database behind. Stamping the temp
    // copy keeps the failure boundary clean: a stamp failure aborts
    // here, before the live database is touched. When a scope is
    // known the stamp also drops any other scope's rows (a stamped
    // same-scope file is already clean, so this is a no-op for it).
    if (deps.expectedScope) {
      scopeBackupFile(tempPath, deps.expectedScope, now);
    }
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
