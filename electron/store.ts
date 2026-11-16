/**
 * Slice S2 — local-first store (Offline Tier-1).
 *
 * The desktop app saves offline sales to a SQLite database on the PC's
 * hard drive (Electron `userData`, `%APPDATA%\Aankh\aankh.db` on Windows),
 * never to browser storage — a browser-cache clear must never wipe a
 * shop's sales. This module owns the database: it runs in the Electron
 * MAIN process (better-sqlite3, synchronous API, WAL mode) and the
 * renderer reaches it over IPC (see `electron/main.ts` for the handlers
 * and `electron/preload.ts` for the bridge). It deliberately imports
 * nothing from `electron`, so the slice test can open a temp-file DB
 * under plain Node.
 *
 * Tables:
 * - `local_sales` — the offline sale queue: one row per sale, the full
 *   `AtomicSaleInput` as JSON plus the sync columns from the design
 *   (`idempotency_key` unique, `synced`, `server_id`, `sync_status`,
 *   `sync_error`) and a `provisional_number` (`L-000123`, sequential per
 *   device) for the receipt until the server assigns `S-100xxx` at sync.
 *   A queue row is deleted only after the server confirms it (S3's sync
 *   engine) — never on send.
 * - `identity_cache` — the S1 cached identity, one row (id = 1). The
 *   renderer keeps its localStorage copy as a synchronous read cache;
 *   this table is the durable record behind it (see
 *   `src/lib/offline/identity-cache.ts`).
 * - `meta` — key/value counters; today only `last_provisional_number`.
 *
 * Provisional numbers are allocated inside the same transaction as the
 * queue write, so a number is never handed out without its sale row.
 * Numbers are never reused: a failed write leaves a gap, never a
 * duplicate (like server invoice numbers skipping on a failed save).
 */

import Database from "better-sqlite3";

/** One queued sale, as the renderer sees it over IPC. */
export interface LocalSaleRow {
  /** The idempotency key: `crypto.randomUUID()` at creation, the server key. */
  requestId: string;
  /** Full `AtomicSaleInput` (customer, lines, money) as plain JSON. */
  input: Record<string, unknown>;
  /** Local provisional number (`L-000123`), or null until allocated. */
  provisionalNumber: string | null;
}

/** The cached identity row, same JSON shape as `CachedIdentity`. */
export interface StoredIdentity {
  profileId: string;
  organizationId: string;
  displayName: string | null;
  email: string | null;
  role: string | null;
  booksCurrency: string | null;
  profileRow: Record<string, unknown> | null;
  organizationRow: Record<string, unknown> | null;
  cachedAt: string;
}

export interface LocalStore {
  /** Queued sales for a scope (`${organizationId}:${profileId}`), oldest first. */
  listSales(scope: string): LocalSaleRow[];
  /**
   * Replace the whole queue for a scope with `rows` (the queue is small;
   * the caller always holds the full list). Provisional numbers are
   * preserved for rows that already have one; new rows are allocated the
   * next numbers, in order. Returns the stored rows.
   */
  replaceSales(scope: string, rows: LocalSaleRow[]): LocalSaleRow[];
  /** Delete one queued sale (server confirmed it, or it was rejected). */
  removeSale(scope: string, requestId: string): void;
  /** The cached identity, or null when there is none. */
  getIdentity(): StoredIdentity | null;
  /** Store (or replace) the cached identity. Throws on an invalid entry. */
  setIdentity(entry: StoredIdentity): void;
  /** Drop the cached identity (sign-out). */
  clearIdentity(): void;
  /** Close the database handle (app quit). */
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS local_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  provisional_number TEXT UNIQUE,
  input_json TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  server_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_sales_scope ON local_sales (scope, id);
CREATE TABLE IF NOT EXISTS identity_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  profile_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  role TEXT,
  books_currency TEXT,
  profile_row_json TEXT,
  organization_row_json TEXT,
  cached_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const PROVISIONAL_COUNTER_KEY = "last_provisional_number";

/** `L-000123`: the `L` marks a local number; the receipt says provisional. */
export function formatProvisionalNumber(sequence: number): string {
  return `L-${String(sequence).padStart(6, "0")}`;
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isValidIdentity(entry: unknown): entry is StoredIdentity {
  if (typeof entry !== "object" || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return (
    typeof row.profileId === "string" &&
    row.profileId.length > 0 &&
    typeof row.organizationId === "string" &&
    row.organizationId.length > 0 &&
    typeof row.cachedAt === "string" &&
    row.cachedAt.length > 0
  );
}

export function createLocalStore(dbPath: string): LocalStore {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  const selectSales = db.prepare(
    "SELECT idempotency_key, input_json, provisional_number, synced, server_id, sync_status, sync_error FROM local_sales WHERE scope = ? ORDER BY id ASC",
  );
  const deleteScopeSales = db.prepare("DELETE FROM local_sales WHERE scope = ?");
  const insertSale = db.prepare(
    "INSERT INTO local_sales (idempotency_key, scope, provisional_number, input_json, synced, server_id, sync_status, sync_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const deleteSale = db.prepare("DELETE FROM local_sales WHERE scope = ? AND idempotency_key = ?");
  const selectIdentity = db.prepare("SELECT * FROM identity_cache WHERE id = 1");
  const upsertIdentity = db.prepare(
    "INSERT INTO identity_cache (id, profile_id, organization_id, display_name, email, role, books_currency, profile_row_json, organization_row_json, cached_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET profile_id = excluded.profile_id, organization_id = excluded.organization_id, display_name = excluded.display_name, email = excluded.email, role = excluded.role, books_currency = excluded.books_currency, profile_row_json = excluded.profile_row_json, organization_row_json = excluded.organization_row_json, cached_at = excluded.cached_at",
  );
  const deleteIdentity = db.prepare("DELETE FROM identity_cache WHERE id = 1");
  const selectCounter = db.prepare("SELECT value FROM meta WHERE key = ?");
  const upsertCounter = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  function nextProvisionalNumber(): string {
    const row = selectCounter.get(PROVISIONAL_COUNTER_KEY) as { value: string } | undefined;
    const next = (row ? Number.parseInt(row.value, 10) || 0 : 0) + 1;
    upsertCounter.run(PROVISIONAL_COUNTER_KEY, String(next));
    return formatProvisionalNumber(next);
  }

  function rowToSale(row: {
    idempotency_key: string;
    input_json: string;
    provisional_number: string | null;
  }): LocalSaleRow | null {
    const input = parseJsonObject(row.input_json);
    if (!input) {
      // A corrupt queue row cannot be rebuilt — skip it rather than
      // breaking the whole queue read. (Rows are written by this store
      // only, so corruption means disk damage, not a code path.)
      console.error(`Aankh local store: skipping corrupt local_sales row ${row.idempotency_key}`);
      return null;
    }
    return {
      requestId: row.idempotency_key,
      input,
      provisionalNumber: row.provisional_number,
    };
  }

  const replaceSalesTx = db.transaction((scope: string, rows: LocalSaleRow[]): LocalSaleRow[] => {
    // Preserve what the queue already knows (provisional numbers and the
    // sync columns S3 fills in) so a replace never downgrades a row.
    const kept = new Map<string, { provisionalNumber: string | null; synced: number; serverId: string | null; syncStatus: string; syncError: string | null }>();
    for (const existing of selectSales.all(scope) as Array<{
      idempotency_key: string;
      provisional_number: string | null;
      synced: number;
      server_id: string | null;
      sync_status: string;
      sync_error: string | null;
    }>) {
      kept.set(existing.idempotency_key, {
        provisionalNumber: existing.provisional_number,
        synced: existing.synced,
        serverId: existing.server_id,
        syncStatus: existing.sync_status,
        syncError: existing.sync_error,
      });
    }
    deleteScopeSales.run(scope);
    const now = new Date().toISOString();
    const stored: LocalSaleRow[] = [];
    // A queue never holds two rows with one request_id (the client guards
    // it), but a duplicate here must not blow up the UNIQUE constraint —
    // keep the first occurrence.
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.requestId)) continue;
      seen.add(row.requestId);
      const previous = kept.get(row.requestId);
      const provisionalNumber =
        previous?.provisionalNumber ?? row.provisionalNumber ?? nextProvisionalNumber();
      insertSale.run(
        row.requestId,
        scope,
        provisionalNumber,
        JSON.stringify(row.input),
        previous?.synced ?? 0,
        previous?.serverId ?? null,
        previous?.syncStatus ?? "pending",
        previous?.syncError ?? null,
        now,
        now,
      );
      stored.push({ requestId: row.requestId, input: row.input, provisionalNumber });
    }
    return stored;
  });

  return {
    listSales(scope: string): LocalSaleRow[] {
      const rows = selectSales.all(scope) as Array<{
        idempotency_key: string;
        input_json: string;
        provisional_number: string | null;
      }>;
      const sales: LocalSaleRow[] = [];
      for (const row of rows) {
        const sale = rowToSale(row);
        if (sale) sales.push(sale);
      }
      return sales;
    },

    replaceSales(scope: string, rows: LocalSaleRow[]): LocalSaleRow[] {
      return replaceSalesTx(scope, rows);
    },

    removeSale(scope: string, requestId: string): void {
      deleteSale.run(scope, requestId);
    },

    getIdentity(): StoredIdentity | null {
      const row = selectIdentity.get() as
        | {
            profile_id: string;
            organization_id: string;
            display_name: string | null;
            email: string | null;
            role: string | null;
            books_currency: string | null;
            profile_row_json: string | null;
            organization_row_json: string | null;
            cached_at: string;
          }
        | undefined;
      if (!row) return null;
      const identity: StoredIdentity = {
        profileId: row.profile_id,
        organizationId: row.organization_id,
        displayName: row.display_name,
        email: row.email,
        role: row.role,
        booksCurrency: row.books_currency,
        profileRow: parseJsonObject(row.profile_row_json),
        organizationRow: parseJsonObject(row.organization_row_json),
        cachedAt: row.cached_at,
      };
      return isValidIdentity(identity) ? identity : null;
    },

    setIdentity(entry: StoredIdentity): void {
      if (!isValidIdentity(entry)) throw new Error("Invalid identity entry");
      upsertIdentity.run(
        entry.profileId,
        entry.organizationId,
        entry.displayName,
        entry.email,
        entry.role,
        entry.booksCurrency,
        entry.profileRow ? JSON.stringify(entry.profileRow) : null,
        entry.organizationRow ? JSON.stringify(entry.organizationRow) : null,
        entry.cachedAt,
      );
    },

    clearIdentity(): void {
      deleteIdentity.run();
    },

    close(): void {
      db.close();
    },
  };
}
