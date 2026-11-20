import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  BACKUP_RETENTION_DAYS,
  backupDirFor,
  backupFileName,
  listBackupFiles,
  parseBackupFileName,
  pruneOldBackups,
  readBackupScope,
  restoreFromBackup,
  runDailyBackup,
  safetyBackupFileName,
  scopeForIdentity,
  validateBackupFile,
  writeScopedBackup,
} from "../electron/backup";
import { createLocalStore, type LocalCustomerRow, type StoredIdentity } from "../electron/store";

// Slice S8 — daily auto backup + Export / Restore (Offline Tier-1).
// The daily backup is one dated SQLite snapshot per day in
// %APPDATA%\Aankh\backups\ (30-day retention); Export writes the same
// snapshot to a user-chosen file; Restore validates the file first,
// safety-copies the live database, then swaps it in and restarts.
// The store's `backup()` is SQLite's own online backup API, so the
// snapshot is consistent — WAL content included, no torn file.
//
// Slice 8 (HYBRID, audit M20) — every backup this module writes is
// SCOPED to the signed-in identity (see scripts/test-backup-scoping.ts
// for the full scoping rules): only that identity's rows survive,
// stamped in the file's `meta` table. The raw `store.backup()` copy
// is unscoped and unstamped (legacy) — the main process never writes
// one anymore, it always goes through `writeScopedBackup` /
// `runDailyBackup` with a scope.

const IDENTITY: StoredIdentity = {
  profileId: "profile-1",
  organizationId: "org-1",
  displayName: "Umair",
  email: "owner@example.com",
  role: "owner",
  booksCurrency: "EUR",
  profileRow: { id: "profile-1", organization_id: "org-1", display_name: "Umair", role: "owner" },
  organizationRow: { id: "org-1", name: "OP TRADERS", books_currency: "EUR" },
  cachedAt: new Date().toISOString(),
};

function customerRow(id: string, name: string): LocalCustomerRow {
  return {
    id,
    kind: "create",
    data: { id, customer_name: name, credit_policy: "cash_only" },
    idempotencyKey: `key-${id}`,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: "2026-11-17T02:00:00.000Z",
    updatedAt: "2026-11-17T02:00:00.000Z",
  };
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

async function main(): Promise<void> {
  // Local calendar date — NOT toISOString(): local midnight on a PKT
  // box is the previous day in UTC, so an ISO slice would be off by
  // one. The backup code itself is local-consistent throughout.
  const localDate = (date: Date | null | undefined): string | null =>
    date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      : null;

  // 1. File names: dated daily name, timestamped safety name, parsing.
  {
    assert.equal(backupFileName(new Date(2026, 10, 17)), "aankh-2026-11-17.db", "the daily name is dated");
    const safety = safetyBackupFileName(new Date(2026, 10, 17, 4, 30, 15));
    assert.equal(safety, "aankh-before-restore-2026-11-17-043015.db", "the safety name carries date + time");
    assert.equal(
      localDate(parseBackupFileName("aankh-2026-11-17.db")),
      "2026-11-17",
      "a daily name parses back to its date",
    );
    assert.equal(
      localDate(parseBackupFileName(safety)),
      "2026-11-17",
      "a safety name parses back to its date",
    );
    assert.equal(parseBackupFileName("random.db"), null, "an unrecognised file does not parse");
    assert.equal(parseBackupFileName("aankh-2026-13-40.db"), null, "an impossible date does not parse");
    assert.equal(parseBackupFileName("aankh-2026-11-17.txt"), null, "a non-db file does not parse");
  }

  const dir = mkdtempSync(join(tmpdir(), "aankh-s8-test-"));
  try {
    const userData = join(dir, "userData");
    const dbPath = join(userData, "aankh.db");
    mkdirSync(userData, { recursive: true });

    // 2. Daily backup: one dated copy per day, a second run the same
    //    day is a no-op, and the copy holds the live rows. Slice 8:
    //    the copy is scoped to the signed-in identity and stamped.
    const store = createLocalStore(dbPath);
    store.setIdentity(IDENTITY);
    store.upsertCustomer("org-1:profile-1", customerRow("cust-1", "Backup Customer"));
    const now = new Date(2026, 10, 17, 9, 0, 0);
    const scope = scopeForIdentity("org-1", "profile-1");
    const first = await runDailyBackup(store, userData, now, scope);
    assert.equal(first.created, true, "the first run of the day creates the copy");
    assert.equal(first.path, join(backupDirFor(userData), "aankh-2026-11-17.db"), "the copy lands in the backup folder");
    assert.equal(existsSync(first.path), true, "the daily copy exists on disk");
    const second = await runDailyBackup(store, userData, now, scope);
    assert.equal(second.created, false, "a second run the same day does not create another copy");
    assert.deepEqual(readBackupScope(first.path), {
      formatVersion: "1",
      scope: "org-1:profile-1",
      organizationId: "org-1",
      profileId: "profile-1",
      createdAt: now.toISOString(),
    }, "the daily copy is stamped with the signed-in identity's scope");
    assert.deepEqual(
      readdirSync(backupDirFor(userData)),
      ["aankh-2026-11-17.db"],
      "one day means one backup file",
    );
    const restored = createLocalStore(first.path);
    try {
      assert.deepEqual(restored.getIdentity()?.profileId, "profile-1", "the backup holds the identity");
      assert.deepEqual(
        restored.listCustomers("org-1:profile-1").map((row) => row.id),
        ["cust-1"],
        "the backup holds the local rows",
      );
    } finally {
      restored.close();
    }

    // 3. Retention: files older than 30 days go, newer ones stay, and
    //    files we do not recognise are never deleted.
    const backups = backupDirFor(userData);
    for (const days of [35, 31, 29, 10]) {
      writeFileSync(join(backups, backupFileName(daysAgo(now, days))), "old copy");
    }
    writeFileSync(join(backups, "notes.txt"), "not a backup");
    writeFileSync(join(backups, "aankh-junk.db"), "not one of ours");
    const pruned = pruneOldBackups(backups, now);
    assert.deepEqual(
      pruned.sort(),
      ["aankh-2026-10-13.db", "aankh-2026-10-17.db"],
      "retention deletes only backups older than 30 days",
    );
    assert.deepEqual(
      listBackupFiles(backups).map((entry) => entry.name),
      ["aankh-2026-10-19.db", "aankh-2026-11-07.db", "aankh-2026-11-17.db"],
      "newer backups survive retention",
    );
    assert.equal(existsSync(join(backups, "notes.txt")), true, "an unrecognised file is never deleted");
    assert.equal(existsSync(join(backups, "aankh-junk.db")), true, "a file that is not one of ours is never deleted");
    assert.equal(BACKUP_RETENTION_DAYS, 30, "retention is 30 days (UMAIR's decision 1)");

    // 4. Export → validate: the exported snapshot validates, and the
    //    validator refuses everything that is not an Aankh backup.
    //    Slice 8: the export goes through `writeScopedBackup` (the
    //    same call the main process uses for the native save dialog)
    //    and is stamped; a raw `store.backup()` copy is the legacy
    //    unscoped file and still validates.
    const exportPath = join(dir, "usb", "aankh-export.db");
    mkdirSync(join(dir, "usb"), { recursive: true });
    await writeScopedBackup(store, exportPath, scope, now);
    assert.deepEqual(validateBackupFile(exportPath), { ok: true }, "an exported snapshot validates");
    assert.deepEqual(readBackupScope(exportPath), {
      formatVersion: "1",
      scope: "org-1:profile-1",
      organizationId: "org-1",
      profileId: "profile-1",
      createdAt: now.toISOString(),
    }, "the exported snapshot is stamped with the exporter's scope");
    const rawPath = join(dir, "usb", "aankh-raw.db");
    await store.backup(rawPath);
    assert.deepEqual(validateBackupFile(rawPath), { ok: true }, "a raw legacy copy still validates");
    assert.equal(readBackupScope(rawPath), null, "a raw legacy copy carries no stamp");
    const textFile = join(dir, "not-a-backup.txt");
    writeFileSync(textFile, "hello, this is not a database");
    assert.deepEqual(
      validateBackupFile(textFile),
      { ok: false, reason: "not-a-database" },
      "a text file is refused",
    );
    const emptyDbPath = join(dir, "empty.db");
    new Database(emptyDbPath).close();
    const emptyValidation = validateBackupFile(emptyDbPath);
    assert.equal(emptyValidation.ok, false, "an empty database is refused");
    if (!emptyValidation.ok) {
      assert.equal(emptyValidation.reason, "missing-tables", "an empty database fails on its missing tables");
      assert.ok(
        (emptyValidation.missingTables ?? []).includes("local_sales"),
        "the refusal names the missing tables",
      );
    }
    assert.deepEqual(
      validateBackupFile(join(dir, "does-not-exist.db")),
      { ok: false, reason: "missing-file" },
      "a missing file is refused",
    );

    // 5. Restore refuses an invalid file: nothing changes, no restart.
    let restarts = 0;
    const refused = await restoreFromBackup({
      store,
      dbPath,
      userDataPath: userData,
      sourcePath: textFile,
      now,
      restart: () => {
        restarts += 1;
      },
    });
    assert.deepEqual(refused, { ok: false, error: "invalid-file" }, "an invalid file is refused");
    assert.equal(restarts, 0, "a refused restore never restarts");
    assert.deepEqual(
      store.listCustomers("org-1:profile-1").map((row) => row.id),
      ["cust-1"],
      "a refused restore leaves the live database untouched",
    );

    // 6. Restore: the live database is safety-copied first, the
    //    source takes over, and the app restarts.
    const otherDir = join(dir, "other");
    mkdirSync(otherDir, { recursive: true });
    const otherStore = createLocalStore(join(otherDir, "aankh.db"));
    otherStore.setIdentity({ ...IDENTITY, displayName: "Restored Owner" });
    otherStore.upsertCustomer("org-1:profile-1", customerRow("cust-2", "Restored Customer"));
    const sourcePath = join(dir, "restore-source.db");
    await otherStore.backup(sourcePath);
    otherStore.close();
    assert.deepEqual(validateBackupFile(sourcePath), { ok: true }, "the restore source validates");
    const restoredResult = await restoreFromBackup({
      store,
      dbPath,
      userDataPath: userData,
      sourcePath,
      expectedScope: scope,
      now,
      restart: () => {
        restarts += 1;
      },
    });
    assert.equal(restoredResult.ok, true, "a valid backup restores");
    assert.equal(restarts, 1, "a successful restore restarts the app once");
    assert.ok(restoredResult.safetyPath, "the restore reports its safety copy");
    assert.equal(existsSync(restoredResult.safetyPath as string), true, "the safety copy exists on disk");
    assert.deepEqual(
      validateBackupFile(restoredResult.safetyPath as string),
      { ok: true },
      "the safety copy is itself a valid backup",
    );
    const afterRestore = createLocalStore(dbPath);
    try {
      assert.deepEqual(
        afterRestore.getIdentity()?.displayName,
        "Restored Owner",
        "the restored database takes over",
      );
      assert.deepEqual(
        afterRestore.listCustomers("org-1:profile-1").map((row) => row.id),
        ["cust-2"],
        "the restored rows replace the live ones",
      );
    } finally {
      afterRestore.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("test-backup-restore: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
