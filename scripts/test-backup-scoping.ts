import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  SCOPED_BACKUP_TABLES,
  backupDirFor,
  readBackupScope,
  restoreFromBackup,
  runDailyBackup,
  scopeForIdentity,
  validateBackupFile,
  writeScopedBackup,
} from "../electron/backup";
import {
  createLocalStore,
  type LocalCustomerRow,
  type LocalExpenseRow,
  type LocalPaymentRow,
  type LocalPurchaseRow,
  type LocalReturnRow,
  type LocalSaleRow,
  type LocalSupplierRow,
  type StoredIdentity,
  type SyncIssueRow,
} from "../electron/store";

// Slice 8 (HYBRID, audit M20) — backup scoping. The live database is
// shared by every identity that has signed in on this PC: every Tier-1
// data table keys its rows by `scope` (`${organizationId}:${profileId}`).
// A whole-file copy therefore exports another org's queued sales and
// mirrors, and restoring one imports them. Rules:
//  1. Every backup this module writes (daily + Export) is SCOPED to
//     the signed-in identity: only that identity's rows survive.
//  2. The file is stamped with that identity in `meta`
//     (`backup_scope`, `backup_organization_id`, `backup_profile_id`);
//     the `meta` counters survive untouched, so a restore never
//     re-issues a provisional number this device already used.
//  3. Restore verifies the stamp against the signed-in identity and
//     refuses a foreign file with `scope-mismatch` — before any
//     safety copy, so a refused restore changes nothing and never
//     restarts.
//  4. A stamp that cannot prove its own scope (`scope` ≠
//     `${organizationId}:${profileId}`) is refused the same way.
//  5. Files written before Slice 8 carry no stamp (legacy): they
//     still validate, but a restore now needs an explicit
//     confirmation (Sunday small fix) — without it the restore
//     refuses with `legacy-backup` before any side effect; with it
//     the restored database is stamped with the current scope.
//  6. With nobody signed in there is no scope, so the daily backup
//     is SKIPPED (a day nobody signs in creates no new org data).
//  7. The scoped write is a real filter, not a WAL illusion: the
//     DELETEs land in the main file (journal_mode=DELETE +
//     checkpoint), so a fresh read-only open of the exported file
//     sees no foreign rows.
//  8. A stamped backup from another scope is still refused after a
//     legacy restore (rule 3 above) — the stamp on the restored
//     database does not weaken the scope check.

const SCOPE_A = "org-a:profile-a";
const SCOPE_B = "org-b:profile-b";

const IDENTITY_A: StoredIdentity = {
  profileId: "profile-a",
  organizationId: "org-a",
  displayName: "Owner A",
  email: "a@example.com",
  role: "owner",
  booksCurrency: "EUR",
  profileRow: { id: "profile-a", organization_id: "org-a", display_name: "Owner A", role: "owner" },
  organizationRow: { id: "org-a", name: "SHOP A", books_currency: "EUR" },
  cachedAt: new Date().toISOString(),
};

const IDENTITY_B: StoredIdentity = {
  ...IDENTITY_A,
  profileId: "profile-b",
  organizationId: "org-b",
  displayName: "Owner B",
  email: "b@example.com",
  profileRow: { id: "profile-b", organization_id: "org-b", display_name: "Owner B", role: "owner" },
  organizationRow: { id: "org-b", name: "SHOP B", books_currency: "EUR" },
};

const NOW = new Date(2026, 10, 20, 9, 0, 0);
const AT = "2026-11-20T09:00:00.000Z";

function saleRow(requestId: string, provisionalNumber: string): LocalSaleRow {
  return {
    requestId,
    input: { customer: "walk-in", lines: [{ product: "Tea", qty: 1, price: 2 }] },
    provisionalNumber,
    createdAt: AT,
  };
}

function issueRow(id: string, scope: string): SyncIssueRow {
  return {
    id,
    scope,
    kind: "stock-conflict",
    requestId: `req-${id}`,
    provisionalNumber: null,
    serverInvoiceNumber: null,
    serverId: null,
    customerName: "Walk-in",
    total: 2,
    reason: "stock short",
    payloadJson: null,
    status: "open",
    syncError: null,
    createdAt: AT,
    updatedAt: AT,
    customerId: null,
    supplierId: null,
    purchaseId: null,
    returnId: null,
    paymentId: null,
    expenseId: null,
  };
}

function customerRow(id: string): LocalCustomerRow {
  return {
    id,
    kind: "create",
    data: { id, customer_name: `Customer ${id}`, credit_policy: "cash_only" },
    idempotencyKey: `key-${id}`,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function purchaseRow(id: string): LocalPurchaseRow {
  return {
    id,
    input: { supplier: "Supplier", lines: [{ product: "Tea", qty: 10, price: 1 }] },
    provisionalNumber: null,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function supplierRow(id: string): LocalSupplierRow {
  return {
    id,
    kind: "create",
    data: { id, supplier_name: `Supplier ${id}` },
    idempotencyKey: `key-${id}`,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function returnRow(id: string): LocalReturnRow {
  return {
    id,
    kind: "sales",
    input: { party: "Walk-in", reason: "damaged", lines: [] },
    provisionalNumber: null,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function paymentRow(id: string): LocalPaymentRow {
  return {
    id,
    action: "pay",
    input: { party: "Walk-in", amount: 2 },
    provisionalNumber: null,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function expenseRow(id: string): LocalExpenseRow {
  return {
    id,
    input: { type: "rent", amount: 100 },
    provisionalNumber: null,
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

/** Seed one row per scope in every scoped table. */
function seedTwoScopes(store: ReturnType<typeof createLocalStore>): void {
  store.setIdentity(IDENTITY_A);
  store.replaceSales(SCOPE_A, [saleRow("sale-a-000001", "L-000001")]);
  store.replaceSales(SCOPE_B, [saleRow("sale-b-000001", "L-000002")]);
  store.upsertIssue(issueRow("issue-a", SCOPE_A));
  store.upsertIssue(issueRow("issue-b", SCOPE_B));
  store.upsertCustomer(SCOPE_A, customerRow("cust-a"));
  store.upsertCustomer(SCOPE_B, customerRow("cust-b"));
  store.upsertPurchase(SCOPE_A, purchaseRow("pur-a"));
  store.upsertPurchase(SCOPE_B, purchaseRow("pur-b"));
  store.upsertSupplier(SCOPE_A, supplierRow("sup-a"));
  store.upsertSupplier(SCOPE_B, supplierRow("sup-b"));
  store.upsertReturn(SCOPE_A, returnRow("ret-a"));
  store.upsertReturn(SCOPE_B, returnRow("ret-b"));
  store.upsertPayment(SCOPE_A, paymentRow("pay-a"));
  store.upsertPayment(SCOPE_B, paymentRow("pay-b"));
  store.upsertExpense(SCOPE_A, expenseRow("exp-a"));
  store.upsertExpense(SCOPE_B, expenseRow("exp-b"));
  store.replaceMirror("sales_transaction", SCOPE_A, [{ id: "srv-a", data: { total: 2 } }]);
  store.replaceMirror("sales_transaction", SCOPE_B, [{ id: "srv-b", data: { total: 5 } }]);
}

/** Row counts for one scope in a database file, read through a FRESH read-only connection. */
function countScopeRows(
  filePath: string,
  scope: string,
): Record<string, { mine: number; foreign: number }> {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const counts: Record<string, { mine: number; foreign: number }> = {};
    for (const table of SCOPED_BACKUP_TABLES) {
      const mine = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scope = ?`).get(scope) as { n: number }).n;
      const foreign = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scope <> ?`).get(scope) as { n: number }).n;
      counts[table] = { mine, foreign };
    }
    return counts;
  } finally {
    db.close();
  }
}

function readMeta(filePath: string, key: string): string | null {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  // Rule 0 — the scope value itself.
  assert.deepEqual(
    scopeForIdentity("org-a", "profile-a"),
    { organizationId: "org-a", profileId: "profile-a", scope: "org-a:profile-a" },
    "a scope is org:profile",
  );

  const dir = mkdtempSync(join(tmpdir(), "aankh-slice8-test-"));
  try {
    const userData = join(dir, "userData");
    const dbPath = join(userData, "aankh.db");
    mkdirSync(userData, { recursive: true });
    const scopeA = scopeForIdentity("org-a", "profile-a");
    const scopeB = scopeForIdentity("org-b", "profile-b");

    const store = createLocalStore(dbPath);
    seedTwoScopes(store);

    // Rule 1 + 2 — the scoped export holds only A's rows, keeps the
    // identity and the counters, and is stamped A.
    const exportPath = join(dir, "usb", "aankh-export-a.db");
    mkdirSync(join(dir, "usb"), { recursive: true });
    await writeScopedBackup(store, exportPath, scopeA, NOW);
    assert.equal(existsSync(exportPath), true, "the scoped export exists");
    assert.equal(
      existsSync(`${exportPath}.scoped-tmp`),
      false,
      "no temp file is left behind after a successful scoped write",
    );
    const counts = countScopeRows(exportPath, SCOPE_A);
    for (const table of SCOPED_BACKUP_TABLES) {
      assert.equal(counts[table].mine, 1, `${table}: the export keeps the exporter's row`);
      assert.equal(counts[table].foreign, 0, `${table}: the export holds no other org's row`);
    }
    const exportedDb = new Database(exportPath, { readonly: true, fileMustExist: true });
    try {
      const identity = exportedDb.prepare("SELECT profile_id, organization_id FROM identity_cache WHERE id = 1").get() as {
        profile_id: string;
        organization_id: string;
      };
      assert.deepEqual(
        identity,
        { profile_id: "profile-a", organization_id: "org-a" },
        "the export keeps the exporter's identity",
      );
    } finally {
      exportedDb.close();
    }
    assert.equal(
      readMeta(exportPath, "last_provisional_purchase_number"),
      readMeta(dbPath, "last_provisional_purchase_number"),
      "the export keeps the provisional-number counters (a restore never re-issues a number)",
    );
    assert.ok(
      (readMeta(exportPath, "last_provisional_purchase_number") ?? "").length > 0,
      "the purchase counter is actually set in the export",
    );
    assert.deepEqual(
      readBackupScope(exportPath),
      {
        formatVersion: "1",
        scope: SCOPE_A,
        organizationId: "org-a",
        profileId: "profile-a",
        createdAt: NOW.toISOString(),
      },
      "the export is stamped with the exporter's scope",
    );

    // Rule 5 — a raw copy carries no stamp.
    const rawPath = join(dir, "usb", "aankh-raw.db");
    await store.backup(rawPath);
    assert.equal(readBackupScope(rawPath), null, "a raw copy carries no stamp (legacy)");
    assert.deepEqual(
      validateBackupFile(rawPath),
      { ok: true },
      "a raw legacy copy still validates",
    );
    assert.deepEqual(
      validateBackupFile(rawPath, scopeB),
      { ok: true },
      "a raw legacy copy passes the scope check for any identity (it predates scoping)",
    );

    // Rule 3 + 4 — the validator's scope matrix.
    assert.deepEqual(
      validateBackupFile(exportPath, scopeA),
      { ok: true },
      "a stamped file validates for its own scope",
    );
    assert.deepEqual(
      validateBackupFile(exportPath, scopeB),
      { ok: false, reason: "scope-mismatch" },
      "a stamped file is refused for another scope",
    );
    assert.deepEqual(
      validateBackupFile(exportPath, null),
      { ok: false, reason: "scope-mismatch" },
      "a stamped file is refused when nobody is signed in",
    );
    assert.deepEqual(
      validateBackupFile(exportPath),
      { ok: true },
      "without an expected scope the validator only checks structure (legacy callers)",
    );
    const tamperedPath = join(dir, "usb", "aankh-tampered.db");
    {
      // Copy the export, then break the stamp's internal consistency.
      copyFileSync(exportPath, tamperedPath);
      const tampered = new Database(tamperedPath);
      try {
        tampered.prepare("UPDATE meta SET value = ? WHERE key = 'backup_organization_id'").run("org-9");
      } finally {
        tampered.close();
      }
    }
    assert.deepEqual(
      validateBackupFile(tamperedPath, scopeA),
      { ok: false, reason: "scope-mismatch" },
      "a stamp that cannot prove its own scope is refused",
    );

    // Rule 3 — restore refuses a foreign file: nothing changes, no
    // restart, and no safety copy is taken.
    const liveUserData = join(dir, "live");
    const liveDbPath = join(liveUserData, "aankh.db");
    mkdirSync(liveUserData, { recursive: true });
    const live = createLocalStore(liveDbPath);
    live.setIdentity(IDENTITY_B);
    live.upsertCustomer(SCOPE_B, customerRow("cust-b-live"));
    let restarts = 0;
    const refused = await restoreFromBackup({
      store: live,
      dbPath: liveDbPath,
      userDataPath: liveUserData,
      sourcePath: exportPath,
      expectedScope: scopeB,
      now: NOW,
      restart: () => {
        restarts += 1;
      },
    });
    assert.deepEqual(refused, { ok: false, error: "scope-mismatch" }, "a foreign backup is refused");
    assert.equal(restarts, 0, "a refused restore never restarts");
    assert.deepEqual(
      live.listCustomers(SCOPE_B).map((row) => row.id),
      ["cust-b-live"],
      "a refused restore leaves the live database untouched",
    );
    assert.deepEqual(
      existsSync(backupDirFor(liveUserData))
        ? readdirSync(backupDirFor(liveUserData)).filter((name) => name.includes("before-restore"))
        : [],
      [],
      "a refused restore takes no safety copy",
    );

    // Rule 3 (allow arm) — the same file restores for its own scope:
    // the safety copy is taken, the app restarts, and the live
    // database becomes the exporter's (A rows only).
    const allowed = await restoreFromBackup({
      store: live,
      dbPath: liveDbPath,
      userDataPath: liveUserData,
      sourcePath: exportPath,
      expectedScope: scopeA,
      now: NOW,
      restart: () => {
        restarts += 1;
      },
    });
    assert.equal(allowed.ok, true, "a backup restores for its own scope");
    assert.equal(restarts, 1, "a successful restore restarts the app once");
    assert.ok(allowed.safetyPath, "the restore reports its safety copy");
    assert.equal(existsSync(allowed.safetyPath as string), true, "the safety copy exists on disk");
    assert.deepEqual(
      validateBackupFile(allowed.safetyPath as string),
      { ok: true },
      "the safety copy is itself a valid backup",
    );
    const afterRestore = createLocalStore(liveDbPath);
    try {
      assert.equal(afterRestore.getIdentity()?.profileId, "profile-a", "the restored database takes over");
      assert.deepEqual(
        afterRestore.listCustomers(SCOPE_A).map((row) => row.id),
        ["cust-a"],
        "the restored rows replace the live ones",
      );
      assert.deepEqual(afterRestore.listCustomers(SCOPE_B), [], "no other org's rows survive the restore");
    } finally {
      afterRestore.close();
    }

    // Rule 5 + 8 (Sunday small fix) — a legacy file refuses without
    // an explicit confirmation: nothing changes, no restart, and no
    // safety copy is taken. With the confirmation it restores, and
    // the restored database is stamped with the current scope
    // (foreign rows dropped by the stamp).
    const legacyUserData = join(dir, "legacy-live");
    const legacyDbPath = join(legacyUserData, "aankh.db");
    mkdirSync(legacyUserData, { recursive: true });
    const legacyLive = createLocalStore(legacyDbPath);
    legacyLive.setIdentity(IDENTITY_B);
    legacyLive.upsertCustomer(SCOPE_B, customerRow("cust-b-live"));
    const legacyRefused = await restoreFromBackup({
      store: legacyLive,
      dbPath: legacyDbPath,
      userDataPath: legacyUserData,
      sourcePath: rawPath,
      expectedScope: scopeB,
      now: NOW,
      restart: () => {
        restarts += 1;
      },
    });
    assert.deepEqual(
      legacyRefused,
      { ok: false, error: "legacy-backup" },
      "a legacy backup refuses without confirmation",
    );
    assert.equal(restarts, 1, "a refused legacy restore never restarts");
    assert.deepEqual(
      legacyLive.listCustomers(SCOPE_B).map((row) => row.id),
      ["cust-b-live"],
      "a refused legacy restore leaves the live database untouched",
    );
    assert.deepEqual(
      existsSync(backupDirFor(legacyUserData))
        ? readdirSync(backupDirFor(legacyUserData)).filter((name) => name.includes("before-restore"))
        : [],
      [],
      "a refused legacy restore takes no safety copy",
    );
    const legacyRestored = await restoreFromBackup({
      store: legacyLive,
      dbPath: legacyDbPath,
      userDataPath: legacyUserData,
      sourcePath: rawPath,
      expectedScope: scopeB,
      now: NOW,
      allowLegacy: true,
      restart: () => {
        restarts += 1;
      },
    });
    assert.equal(legacyRestored.ok, true, "a legacy backup restores with confirmation");
    assert.equal(restarts, 2, "the confirmed legacy restore restarts once");
    const legacyAfter = createLocalStore(legacyDbPath);
    try {
      assert.deepEqual(
        readBackupScope(legacyDbPath),
        {
          formatVersion: "1",
          scope: SCOPE_B,
          organizationId: "org-b",
          profileId: "profile-b",
          createdAt: NOW.toISOString(),
        },
        "the confirmed legacy restore stamps the restored database with the current scope",
      );
      assert.deepEqual(
        legacyAfter.listCustomers(SCOPE_B).map((row) => row.id),
        ["cust-b"],
        "the confirmed legacy restore keeps the current scope's rows",
      );
      assert.deepEqual(
        legacyAfter.listCustomers(SCOPE_A),
        [],
        "the stamp drops the other scope's rows from the restored database",
      );
    } finally {
      legacyAfter.close();
    }

    // Rule 6 + 1 — the daily backup is scoped too, and skipped with
    // nobody signed in.
    const dailyUserData = join(dir, "daily");
    mkdirSync(dailyUserData, { recursive: true });
    const dailyStore = createLocalStore(join(dailyUserData, "aankh.db"));
    seedTwoScopes(dailyStore);
    const daily = await runDailyBackup(dailyStore, dailyUserData, NOW, scopeA);
    assert.equal(daily.created, true, "the daily backup is created for the signed-in identity");
    assert.equal(daily.skipped, false, "the daily backup is not skipped when signed in");
    const dailyCounts = countScopeRows(daily.path, SCOPE_A);
    for (const table of SCOPED_BACKUP_TABLES) {
      assert.equal(dailyCounts[table].foreign, 0, `daily ${table}: no other org's row`);
    }
    assert.deepEqual(
      readBackupScope(daily.path)?.scope,
      SCOPE_A,
      "the daily backup is stamped with the signed-in identity's scope",
    );
    const dailyAgain = await runDailyBackup(dailyStore, dailyUserData, NOW, scopeA);
    assert.equal(dailyAgain.created, false, "a second daily run the same day is a no-op");
    dailyStore.close();
    const noIdentityUserData = join(dir, "no-identity");
    mkdirSync(noIdentityUserData, { recursive: true });
    const noIdentityStore = createLocalStore(join(noIdentityUserData, "aankh.db"));
    const skipped = await runDailyBackup(noIdentityStore, noIdentityUserData, NOW, null);
    assert.equal(skipped.created, false, "with nobody signed in no daily copy is created");
    assert.equal(skipped.skipped, true, "with nobody signed in the daily run reports skipped");
    assert.deepEqual(
      readdirSync(backupDirFor(noIdentityUserData)),
      [],
      "with nobody signed in no daily file appears",
    );
    noIdentityStore.close();

    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    "Slice 8 backup scoping passed: scoped export holds only the exporter's rows + stamp, foreign restore refused with no side effects, own-scope restore works, legacy files refuse without confirmation and stamp with the current scope when confirmed, daily backup scoped and skipped with no identity.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
