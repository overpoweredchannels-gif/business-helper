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
 * - `sync_issues` — Slice S3 owner-visible sync problems: a sale the
 *   server refused (stock conflict, fingerprint mismatch, any other
 *   rejection) is PARKED here with its full payload instead of being
 *   dropped, so the owner can retry it (same idempotency key) or
 *   discard it — and a provisional number that could not yet be linked
 *   to its cloud invoice waits here as a `provisional-link` row until
 *   the link succeeds. Rows are never deleted; discard is a status.
 *   Slice S5 adds `customer_id` so a customer-conflict issue can find
 *   its local customer row for Retry. Slice S6 adds `supplier_id` the
 *   same way, for supplier-conflict issues, and `purchase_id` for
 *   purchase fingerprint-mismatch / rejected issues.
 * - `local_customers` — Slice S5 offline-created / offline-edited
 *   customers: the full customer record + a client-generated UUID as
 *   the row `id` (the same UUID becomes the server id on sync) +
 *   the sync columns. A row is deleted only after the server
 *   confirms it — never on send.
 * - `local_purchases` — Slice S6 offline-created purchases: the full
 *   purchase input JSON + the client `request_key` as the row id +
 *   a local provisional number (`LP-000123`, sequential per device)
 *   for the history until the server assigns `P-500xx` at sync.
 *   A row is deleted only after the server confirms it — never on send.
 * - `local_suppliers` — Slice S6 offline-created / offline-edited
 *   suppliers: same shape as `local_customers` (client UUID as the
 *   row `id`, last-write-wins on `updated_at`). The balance is NEVER
 *   stored here — supplier outstanding is derived on read, exactly
 *   as server-side (`payment_derived_outstanding`).
 * - `local_returns` — Slice S7 offline-created sales + purchase
 *   returns: the full return input JSON + a client `request_key` as
 *   the row id + a local provisional number (`SR-000123` for sales,
 *   `PR-000123` for purchases, sequential per device) for the
 *   history until the server assigns the return number at sync.
 *   A row is deleted only after the server confirms it — never on send.
 * - `local_payments` — Slice S7 offline-created customer / supplier
 *   payments + offline voids: the full `PaymentSubmitInput` JSON
 *   (or the void input) + a client `request_key` as the row id + a
 *   local provisional number (`PY-000123`) for the history. A void
 *   row (`action: "void"`) is a synced write of its own
 *   (`void_payment_atomic`, same request-key pattern) — a payment
 *   voided offline is never silently dropped. A row is deleted only
 *   after the server confirms it — never on send.
 * - `local_expenses` — Slice S7 offline-created expenses: the full
 *   expense insert payload JSON + a client `request_key` as the row
 *   id + a local provisional number (`EX-000123`) for the history.
 *   The payload may link a purchase by its LOCAL purchase key; the
 *   sync resolves it to the server purchase id once that purchase
 *   has synced (sync order: purchases before expenses). A row is
 *   deleted only after the server confirms it — never on send.
 * - `meta` — key/value counters; today `last_provisional_number`
 *   (sales) and `last_provisional_purchase_number` (purchases).
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
  /**
   * Slice S4 — when the sale was first queued (ISO timestamp). The
   * history shows this as the sale time; it is preserved across queue
   * rewrites, never re-stamped (a rewrite must not move a sale in time).
   * Null for rows written before this field existed.
   */
  createdAt: string | null;
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

/** One owner-visible sync problem, as the renderer sees it over IPC. */
export interface SyncIssueRow {
  /** Client-generated id (`crypto.randomUUID()` at park time). */
  id: string;
  scope: string;
  /** `stock-conflict` | `fingerprint-mismatch` | `rejected` | `provisional-link` | `customer-conflict`. */
  kind: string;
  /** The sale's idempotency key, for sale kinds; null for provisional-link rows keyed by server id. */
  requestId: string | null;
  /** Local provisional number (`L-000123`) of the parked sale, if it had one. */
  provisionalNumber: string | null;
  /** Server invoice number (`S-100xxx`) once the sale is confirmed. */
  serverInvoiceNumber: string | null;
  /** Server `sales_transactions.id` once the sale is confirmed. */
  serverId: string | null;
  customerName: string | null;
  /** Sale total in books currency, for the issue list. */
  total: number | null;
  /** Human-readable reason (the server message, or the link failure). */
  reason: string;
  /** Full `AtomicSaleInput` JSON for a parked sale (Retry re-submits it). */
  payloadJson: string | null;
  /** `open` | `resolved` | `discarded`. Never deleted. */
  status: string;
  /** Last link/sync error text; provisional-link rows stay silent in the UI while this is null. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Slice S5 — the local customer row id for a customer issue
   * (`customer-conflict` / customer `rejected`). Retry finds the row
   * by this id; null for sale issues.
   */
  customerId: string | null;
  /**
   * Slice S6 — the local supplier row id for a supplier issue
   * (`supplier-conflict` / supplier `rejected`). Retry finds the row
   * by this id; null for every other issue.
   */
  supplierId: string | null;
  /**
   * Slice S6 — the local purchase row id (= the client request key)
   * for a purchase issue (`fingerprint-mismatch` / purchase
   * `rejected`). Retry finds the row by this id; null for every
   * other issue.
   */
  purchaseId: string | null;
  /**
   * Slice S7 — the local return row id (= the client request key)
   * for a return issue (`fingerprint-mismatch` / return
   * `rejected`). Retry finds the row by this id; null for every
   * other issue.
   */
  returnId: string | null;
  /**
   * Slice S7 — the local payment row id (= the client request key)
   * for a payment issue (`fingerprint-mismatch` / payment
   * `rejected`, or a void that the server refused). Retry finds the
   * row by this id; null for every other issue.
   */
  paymentId: string | null;
  /**
   * Slice S7 — the local expense row id (= the client request key)
   * for an expense issue (`fingerprint-mismatch` / expense
   * `rejected`). Retry finds the row by this id; null for every
   * other issue.
   */
  expenseId: string | null;
}

/**
 * Slice S5 — one offline-created / offline-edited customer, as the
 * renderer sees it over IPC. The row `id` is a client-generated UUID:
 * for a create it BECOMES the server id on sync (the route accepts a
 * client-supplied id), so sales that already reference it need no
 * rewrite; for an edit it is the existing server id. `kind` is
 * "create" until the row confirms on the server — an edit of an
 * unsynced create stays a create, so the sync sends one insert, not
 * an insert plus an update. `data` is the full customer record (the
 * fields the Quick-Add dialog and the edit form write), exactly as
 * the customers list renders it. The balance is NEVER stored here:
 * it is always derived from ledger transactions (see
 * `src/lib/offline/customer-balance-offline.ts`).
 */
export type LocalCustomerKind = "create" | "edit";

export interface LocalCustomerRow {
  /** Client UUID (create) or server id (edit). */
  id: string;
  kind: LocalCustomerKind;
  /** Full customer record as plain JSON. */
  data: Record<string, unknown>;
  /** The idempotency key (`crypto.randomUUID()` at creation). */
  idempotencyKey: string;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server id once synced (same UUID as `id` for customers). */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Slice S6 — one offline-created purchase, as the renderer sees it
 * over IPC. The row `id` is the client `request_key`
 * (`crypto.randomUUID()` at creation): the server dedupes on it
 * (`purchase_transactions.request_key` unique per org), so a retry
 * with the same key replays the original purchase instead of
 * double-posting or double-stocking. `input` is the full purchase
 * input exactly as `POST /api/purchases` takes it (supplier,
 * payment terms, lines). The provisional number is local-only: the
 * server assigns `P-500xx` at sync and the history then shows the
 * server number (the provisional number is never written to the
 * cloud row — there is no provisional column on purchases).
 */
export interface LocalPurchaseRow {
  /** The client request key — also the idempotency key and the row id. */
  id: string;
  /** Full purchase input (supplier, terms, lines) as plain JSON. */
  input: Record<string, unknown>;
  /** Local provisional number (`LP-000123`), or null until allocated. */
  provisionalNumber: string | null;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server `purchase_transactions.id` once synced. */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Slice S6 — one offline-created / offline-edited supplier, as the
 * renderer sees it over IPC. Same shape as `LocalCustomerRow`: the
 * row `id` is a client-generated UUID (a create's id BECOMES the
 * server id on sync — the route accepts a client-supplied id — so
 * purchases that already reference it need no rewrite; an edit
 * carries the existing server id). `kind` is "create" until the row
 * confirms — an edit of an unsynced create stays a create. The
 * balance is NEVER stored here: supplier outstanding is derived on
 * read, exactly as server-side.
 */
export type LocalSupplierKind = "create" | "edit";

export interface LocalSupplierRow {
  /** Client UUID (create) or server id (edit). */
  id: string;
  kind: LocalSupplierKind;
  /** Full supplier record as plain JSON. */
  data: Record<string, unknown>;
  /** The idempotency key (`crypto.randomUUID()` at creation). */
  idempotencyKey: string;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server id once synced (same UUID as `id` for suppliers). */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  /** Last local write — the last-write-wins timestamp sent on sync. */
  updatedAt: string;
}

/**
 * Slice S7 — one offline-created return, as the renderer sees it
 * over IPC. The row `id` is the client `request_key`
 * (`crypto.randomUUID()` at creation): the server dedupes on it
 * (`sales_returns.request_key` / `purchase_returns.request_key`,
 * unique per org, new SQL in
 * `src/lib/migrations/returns_expenses_idempotency.sql`), so a retry
 * with the same key replays the original return instead of
 * double-posting or double-restoring stock. `kind` is "sales" or
 * "purchase"; `input` is the full return input exactly as the route
 * takes it (party, linked invoice, return date, reason, lines).
 * The provisional number is local-only (`SR-000123` for sales,
 * `PR-000123` for purchases): the server assigns the return number
 * at sync and the history then shows the server number.
 */
export type LocalReturnKind = "sales" | "purchase";

export interface LocalReturnRow {
  /** The client request key — also the idempotency key and the row id. */
  id: string;
  kind: LocalReturnKind;
  /** Full return input (party, linked invoice, date, reason, lines) as plain JSON. */
  input: Record<string, unknown>;
  /** Local provisional number (`SR-000123` / `PR-000123`), or null until allocated. */
  provisionalNumber: string | null;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server return id once synced. */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Slice S7 — one offline-created payment or offline void, as the
 * renderer sees it over IPC. The row `id` is the client request
 * key (`crypto.randomUUID()` at creation): the server dedupes on it
 * (`create_payment_atomic` / `void_payment_atomic`, phase 14), so a
 * retry with the same key replays the original payment instead of
 * double-posting. `action` is "pay" (a new payment — `input` is the
 * full `PaymentSubmitInput`) or "void" (a void of an already-synced
 * payment — `input` is `{ kind, paymentId, reason }`). A void of an
 * unsynced local payment never becomes a row: the payment simply
 * leaves the queue, because it never existed server-side. The
 * provisional number (`PY-000123`) is local-only, for the history.
 */
export type LocalPaymentAction = "pay" | "void";

export interface LocalPaymentRow {
  /** The client request key — also the idempotency key and the row id. */
  id: string;
  action: LocalPaymentAction;
  /** Full payment input (`PaymentSubmitInput`) or void input as plain JSON. */
  input: Record<string, unknown>;
  /** Local provisional number (`PY-000123`), or null until allocated. */
  provisionalNumber: string | null;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server payment id once synced. */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Slice S7 — one offline-created expense, as the renderer sees it
 * over IPC. The row `id` is the client `request_key`
 * (`crypto.randomUUID()` at creation): the server dedupes on it
 * (`expenses.request_key`, unique per org, new SQL in
 * `src/lib/migrations/returns_expenses_idempotency.sql`), so a retry
 * with the same key replays the original expense instead of a
 * duplicate. `input` is the full expense insert payload exactly as
 * the online save sends it (type, amount, notes, date, supplier /
 * customer / purchase / sale links). `purchase_transaction_id` in
 * the payload may be a LOCAL purchase key (an offline purchase has
 * no server id yet); the sync resolves it to the server purchase id
 * once that purchase has synced — expenses drain after purchases,
 * so the link is known by then. The provisional number
 * (`EX-000123`) is local-only, for the history.
 */
export interface LocalExpenseRow {
  /** The client request key — also the idempotency key and the row id. */
  id: string;
  /** Full expense insert payload as plain JSON. */
  input: Record<string, unknown>;
  /** Local provisional number (`EX-000123`), or null until allocated. */
  provisionalNumber: string | null;
  /** 0 = local only, 1 = confirmed on server. */
  synced: number;
  /** Server expense id once synced. */
  serverId: string | null;
  /** `pending` | `synced` | `rejected`. */
  syncStatus: string;
  /** Server rejection message, if any. */
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Slice S4 — one mirrored server row, as the renderer sees it over IPC.
 * Mirrors are a READ cache for the desktop history + inventory: whole
 * server rows as fetched (never merged, never edited), keyed by kind +
 * scope + server id. The mirror never carries balances — it stores the
 * rows the fetch functions already return; every figure the UI derives
 * (paid/remaining, stock) is computed from them exactly as from live
 * rows, and `outstanding_balance` is never written here (the stored
 * balance engine owns it server-side; the client derives it).
 * Slice S5 adds the customer list + the ledger inputs the offline
 * balance derivation reads (payments, allocations, returns).
 */
export type MirrorKind =
  | "sales_transaction"
  | "sales_item"
  | "product"
  | "customer"
  | "customer_payment"
  | "customer_payment_allocation"
  | "sales_return"
  | "sales_return_item"
  // Slice S6 — the purchase history + suppliers reads.
  | "purchase_transaction"
  | "purchase_item"
  | "supplier"
  // Slice S7 — the purchase-return + supplier-payment + expense reads.
  | "purchase_return"
  | "purchase_return_item"
  | "supplier_payment"
  | "supplier_payment_allocation"
  | "expense";

export interface MirrorRow {
  /** Server row id (`sales_transactions.id`, `sales_items.id`, `products.id`). */
  id: string;
  /** The whole server row as fetched, as plain JSON. */
  data: Record<string, unknown>;
  /** ISO timestamp of the fetch that wrote this snapshot. */
  savedAt: string;
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
  /** Sync issues for a scope, oldest first (open, resolved and discarded). */
  listIssues(scope: string): SyncIssueRow[];
  /**
   * Insert an issue, or update the already-open one for the same sale
   * (matched by `requestId` for sale kinds, by `serverId` for
   * provisional-link rows) so a re-park never duplicates it. The kept
   * row's `id` and `createdAt` survive; `updatedAt` refreshes.
   * Throws on an invalid entry. Returns the stored row.
   */
  upsertIssue(issue: SyncIssueRow): SyncIssueRow;
  /** Set one issue's status (`open` | `resolved` | `discarded`). */
  setIssueStatus(scope: string, id: string, status: string): void;
  /** Update one issue's reason / sync error text. */
  updateIssue(scope: string, id: string, patch: { reason?: string; syncError?: string | null }): void;
  /** Mirrored server rows for a kind + scope (Slice S4). */
  listMirror(kind: MirrorKind, scope: string): MirrorRow[];
  /**
   * Replace the whole mirror snapshot for a kind + scope (one successful
   * online fetch writes the full list). Returns the stored rows.
   */
  replaceMirror(kind: MirrorKind, scope: string, rows: Array<{ id: string; data: Record<string, unknown> }>): MirrorRow[];
  /**
   * Insert or replace one mirrored row (a confirmed sale lands here at
   * sync time, before the next fetch refreshes the snapshot). Returns
   * the stored row.
   */
  upsertMirror(kind: MirrorKind, scope: string, row: { id: string; data: Record<string, unknown> }): MirrorRow;
  /** Offline-created / offline-edited customers for a scope, oldest first (Slice S5). */
  listCustomers(scope: string): LocalCustomerRow[];
  /**
   * Insert or replace one local customer row. An edit of an unsynced
   * create stays a create (one insert on sync, not insert + update);
   * the idempotency key and first-created time survive a rewrite.
   * The caller owns the sync columns: a UI edit resets the row to
   * pending, the sync engine parks it as rejected with its reason.
   * Throws on an invalid entry. Returns the stored row.
   */
  upsertCustomer(scope: string, row: LocalCustomerRow): LocalCustomerRow;
  /** Delete one local customer row (server confirmed it). */
  removeCustomer(scope: string, id: string): void;
  /** Offline-created purchases for a scope, oldest first (Slice S6). */
  listPurchases(scope: string): LocalPurchaseRow[];
  /**
   * Insert or replace one local purchase row. The provisional number
   * is allocated here (inside the same transaction as the row write)
   * and survives a rewrite; a row that already has one keeps it.
   * Throws on an invalid entry. Returns the stored row.
   */
  upsertPurchase(scope: string, row: LocalPurchaseRow): LocalPurchaseRow;
  /** Delete one local purchase row (server confirmed it). */
  removePurchase(scope: string, id: string): void;
  /** Offline-created / offline-edited suppliers for a scope, oldest first (Slice S6). */
  listSuppliers(scope: string): LocalSupplierRow[];
  /**
   * Insert or replace one local supplier row. Same discipline as
   * upsertCustomer: an edit of an unsynced create stays a create;
   * the idempotency key and first-created time survive a rewrite.
   * Throws on an invalid entry. Returns the stored row.
   */
  upsertSupplier(scope: string, row: LocalSupplierRow): LocalSupplierRow;
  /** Delete one local supplier row (server confirmed it). */
  removeSupplier(scope: string, id: string): void;
  /** Offline-created returns for a scope, oldest first (Slice S7). */
  listReturns(scope: string): LocalReturnRow[];
  /**
   * Insert or replace one local return row. The provisional number
   * is allocated here (inside the same transaction as the row write)
   * and survives a rewrite; a row that already has one keeps it.
   * Throws on an invalid entry. Returns the stored row.
   */
  upsertReturn(scope: string, row: LocalReturnRow): LocalReturnRow;
  /** Delete one local return row (server confirmed it). */
  removeReturn(scope: string, id: string): void;
  /** Offline-created payments / voids for a scope, oldest first (Slice S7). */
  listPayments(scope: string): LocalPaymentRow[];
  /**
   * Insert or replace one local payment row. The provisional number
   * is allocated here (inside the same transaction as the row write)
   * and survives a rewrite; a row that already has one keeps it.
   * Throws on an invalid entry. Returns the stored row.
   */
  upsertPayment(scope: string, row: LocalPaymentRow): LocalPaymentRow;
  /** Delete one local payment row (server confirmed it). */
  removePayment(scope: string, id: string): void;
  /** Offline-created expenses for a scope, oldest first (Slice S7). */
  listExpenses(scope: string): LocalExpenseRow[];
  /**
   * Insert or replace one local expense row. The provisional number
   * is allocated here (inside the same transaction as the row write)
   * and survives a rewrite; a row that already has one keeps it.
   * Throws on an invalid entry. Returns the stored row.
   */
  upsertExpense(scope: string, row: LocalExpenseRow): LocalExpenseRow;
  /** Delete one local expense row (server confirmed it). */
  removeExpense(scope: string, id: string): void;
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
CREATE TABLE IF NOT EXISTS sync_issues (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  request_id TEXT,
  provisional_number TEXT,
  server_invoice_number TEXT,
  server_id TEXT,
  customer_name TEXT,
  total REAL,
  reason TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  customer_id TEXT,
  supplier_id TEXT,
  purchase_id TEXT,
  return_id TEXT,
  payment_id TEXT,
  expense_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_issues_scope ON sync_issues (scope, status, created_at);
CREATE TABLE IF NOT EXISTS local_customers (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  data_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  synced INTEGER NOT NULL DEFAULT 0,
  server_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_customers_scope ON local_customers (scope, created_at, id);
CREATE TABLE IF NOT EXISTS local_purchases (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  input_json TEXT NOT NULL,
  provisional_number TEXT UNIQUE,
  synced INTEGER NOT NULL DEFAULT 0,
  server_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_purchases_scope ON local_purchases (scope, created_at, id);
CREATE TABLE IF NOT EXISTS local_suppliers (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  data_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  synced INTEGER NOT NULL DEFAULT 0,
  server_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_suppliers_scope ON local_suppliers (scope, created_at, id);
CREATE TABLE IF NOT EXISTS local_returns (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  input_json TEXT NOT NULL,
  provisional_number TEXT UNIQUE,
  synced INTEGER NOT NULL DEFAULT 0,
  server_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_returns_scope ON local_returns (scope, created_at, id);
CREATE TABLE IF NOT EXISTS local_payments (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  action TEXT NOT NULL,
  input_json TEXT NOT NULL,
  provisional_number TEXT UNIQUE,
  synced INTEGER NOT NULL DEFAULT 0,
  server_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_payments_scope ON local_payments (scope, created_at, id);
CREATE TABLE IF NOT EXISTS local_expenses (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  input_json TEXT NOT NULL,
  provisional_number TEXT UNIQUE,
  synced INTEGER NOT NULL DEFAULT 0,
  server_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_expenses_scope ON local_expenses (scope, created_at, id);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mirrors (
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (kind, scope, id)
);
CREATE INDEX IF NOT EXISTS idx_mirrors_scope ON mirrors (kind, scope, saved_at);
`;

const PROVISIONAL_COUNTER_KEY = "last_provisional_number";
const PROVISIONAL_PURCHASE_COUNTER_KEY = "last_provisional_purchase_number";
const PROVISIONAL_SALES_RETURN_COUNTER_KEY = "last_provisional_sales_return_number";
const PROVISIONAL_PURCHASE_RETURN_COUNTER_KEY = "last_provisional_purchase_return_number";
const PROVISIONAL_PAYMENT_COUNTER_KEY = "last_provisional_payment_number";
const PROVISIONAL_EXPENSE_COUNTER_KEY = "last_provisional_expense_number";

/** `L-000123`: the `L` marks a local number; the receipt says provisional. */
export function formatProvisionalNumber(sequence: number): string {
  return `L-${String(sequence).padStart(6, "0")}`;
}

/** `LP-000123`: the `LP` marks a local purchase number; the history says provisional. */
export function formatProvisionalPurchaseNumber(sequence: number): string {
  return `LP-${String(sequence).padStart(6, "0")}`;
}

/** `SR-000123`: the `SR` marks a local sales-return number; the history says provisional. */
export function formatProvisionalSalesReturnNumber(sequence: number): string {
  return `SR-${String(sequence).padStart(6, "0")}`;
}

/** `PR-000123`: the `PR` marks a local purchase-return number; the history says provisional. */
export function formatProvisionalPurchaseReturnNumber(sequence: number): string {
  return `PR-${String(sequence).padStart(6, "0")}`;
}

/** `PY-000123`: the `PY` marks a local payment number; the history says provisional. */
export function formatProvisionalPaymentNumber(sequence: number): string {
  return `PY-${String(sequence).padStart(6, "0")}`;
}

/** `EX-000123`: the `EX` marks a local expense number; the history says provisional. */
export function formatProvisionalExpenseNumber(sequence: number): string {
  return `EX-${String(sequence).padStart(6, "0")}`;
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

const SYNC_ISSUE_KINDS = new Set(["stock-conflict", "fingerprint-mismatch", "rejected", "provisional-link", "customer-conflict", "supplier-conflict"]);
const SYNC_ISSUE_STATUSES = new Set(["open", "resolved", "discarded"]);
const LOCAL_CUSTOMER_KINDS = new Set(["create", "edit"]);
const LOCAL_CUSTOMER_SYNC_STATUSES = new Set(["pending", "synced", "rejected"]);
const LOCAL_SUPPLIER_KINDS = new Set(["create", "edit"]);
const LOCAL_SUPPLIER_SYNC_STATUSES = new Set(["pending", "synced", "rejected"]);
const LOCAL_PURCHASE_SYNC_STATUSES = new Set(["pending", "synced", "rejected"]);

function isValidCustomerRow(entry: unknown): entry is LocalCustomerRow {
  if (typeof entry !== "object" || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.kind === "string" &&
    LOCAL_CUSTOMER_KINDS.has(row.kind) &&
    typeof row.data === "object" &&
    row.data !== null &&
    !Array.isArray(row.data) &&
    typeof row.idempotencyKey === "string" &&
    row.idempotencyKey.length > 0 &&
    typeof row.createdAt === "string" &&
    row.createdAt.length > 0 &&
    typeof row.updatedAt === "string" &&
    row.updatedAt.length > 0
  );
}

function isValidPurchaseRow(entry: unknown): entry is LocalPurchaseRow {
  if (typeof entry !== "object" || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.input === "object" &&
    row.input !== null &&
    !Array.isArray(row.input) &&
    typeof row.createdAt === "string" &&
    row.createdAt.length > 0 &&
    typeof row.updatedAt === "string" &&
    row.updatedAt.length > 0
  );
}

function isValidSupplierRow(entry: unknown): entry is LocalSupplierRow {
  if (typeof entry !== "object" || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.kind === "string" &&
    LOCAL_SUPPLIER_KINDS.has(row.kind) &&
    typeof row.data === "object" &&
    row.data !== null &&
    !Array.isArray(row.data) &&
    typeof row.idempotencyKey === "string" &&
    row.idempotencyKey.length > 0 &&
    typeof row.createdAt === "string" &&
    row.createdAt.length > 0 &&
    typeof row.updatedAt === "string" &&
    row.updatedAt.length > 0
  );
}

const LOCAL_RETURN_KINDS = new Set(["sales", "purchase"]);
const LOCAL_RETURN_SYNC_STATUSES = new Set(["pending", "synced", "rejected"]);
const LOCAL_PAYMENT_ACTIONS = new Set(["pay", "void"]);
const LOCAL_PAYMENT_SYNC_STATUSES = new Set(["pending", "synced", "rejected"]);
const LOCAL_EXPENSE_SYNC_STATUSES = new Set(["pending", "synced", "rejected"]);

function isValidReturnRow(entry: unknown): entry is LocalReturnRow {
  if (typeof entry !== "object" || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.kind === "string" &&
    LOCAL_RETURN_KINDS.has(row.kind) &&
    typeof row.input === "object" &&
    row.input !== null &&
    !Array.isArray(row.input) &&
    typeof row.createdAt === "string" &&
    row.createdAt.length > 0 &&
    typeof row.updatedAt === "string" &&
    row.updatedAt.length > 0
  );
}

function isValidPaymentRow(entry: unknown): entry is LocalPaymentRow {
  if (typeof entry !== "object" || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.action === "string" &&
    LOCAL_PAYMENT_ACTIONS.has(row.action) &&
    typeof row.input === "object" &&
    row.input !== null &&
    !Array.isArray(row.input) &&
    typeof row.createdAt === "string" &&
    row.createdAt.length > 0 &&
    typeof row.updatedAt === "string" &&
    row.updatedAt.length > 0
  );
}

function isValidExpenseRow(entry: unknown): entry is LocalExpenseRow {
  if (typeof entry !== "object" || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.input === "object" &&
    row.input !== null &&
    !Array.isArray(row.input) &&
    typeof row.createdAt === "string" &&
    row.createdAt.length > 0 &&
    typeof row.updatedAt === "string" &&
    row.updatedAt.length > 0
  );
}

function isValidIssue(entry: unknown): entry is SyncIssueRow {
  if (typeof entry !== "object" || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.scope === "string" &&
    row.scope.length > 0 &&
    typeof row.kind === "string" &&
    SYNC_ISSUE_KINDS.has(row.kind) &&
    typeof row.reason === "string" &&
    row.reason.length > 0 &&
    typeof row.status === "string" &&
    SYNC_ISSUE_STATUSES.has(row.status) &&
    typeof row.createdAt === "string" &&
    row.createdAt.length > 0 &&
    typeof row.updatedAt === "string" &&
    row.updatedAt.length > 0
  );
}

export function createLocalStore(dbPath: string): LocalStore {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  // Slice S5 — the sync_issues table gained a customer_id column for
  // customer-conflict issues. CREATE TABLE IF NOT EXISTS does not add
  // a column to a database created by S3, so existing databases get it
  // here; new databases already have it from the schema above.
  const issueColumns = db.prepare("PRAGMA table_info(sync_issues)").all() as Array<{ name: string }>;
  if (!issueColumns.some((column) => column.name === "customer_id")) {
    db.exec("ALTER TABLE sync_issues ADD COLUMN customer_id TEXT");
  }
  // Slice S6 — same discipline for the supplier_id column
  // (supplier-conflict issues). Pre-S6 databases get it here.
  if (!issueColumns.some((column) => column.name === "supplier_id")) {
    db.exec("ALTER TABLE sync_issues ADD COLUMN supplier_id TEXT");
  }
  // Slice S6 — same discipline for the purchase_id column (purchase
  // fingerprint-mismatch / rejected issues). Pre-S6 databases get it
  // here.
  if (!issueColumns.some((column) => column.name === "purchase_id")) {
    db.exec("ALTER TABLE sync_issues ADD COLUMN purchase_id TEXT");
  }
  // Slice S7 — same discipline for the return_id / payment_id /
  // expense_id columns (return / payment / expense issues). Pre-S7
  // databases get them here.
  if (!issueColumns.some((column) => column.name === "return_id")) {
    db.exec("ALTER TABLE sync_issues ADD COLUMN return_id TEXT");
  }
  if (!issueColumns.some((column) => column.name === "payment_id")) {
    db.exec("ALTER TABLE sync_issues ADD COLUMN payment_id TEXT");
  }
  if (!issueColumns.some((column) => column.name === "expense_id")) {
    db.exec("ALTER TABLE sync_issues ADD COLUMN expense_id TEXT");
  }

  const selectSales = db.prepare(
    "SELECT idempotency_key, input_json, provisional_number, created_at, synced, server_id, sync_status, sync_error FROM local_sales WHERE scope = ? ORDER BY id ASC",
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
  const selectIssues = db.prepare(
    "SELECT * FROM sync_issues WHERE scope = ? ORDER BY created_at ASC, id ASC",
  );
  const selectOpenIssueByRequest = db.prepare(
    "SELECT * FROM sync_issues WHERE scope = ? AND status = 'open' AND request_id = ? LIMIT 1",
  );
  const selectOpenIssueByServer = db.prepare(
    "SELECT * FROM sync_issues WHERE scope = ? AND status = 'open' AND server_id = ? LIMIT 1",
  );
  const insertIssue = db.prepare(
    "INSERT INTO sync_issues (id, scope, kind, request_id, provisional_number, server_invoice_number, server_id, customer_name, total, reason, payload_json, status, sync_error, created_at, updated_at, customer_id, supplier_id, purchase_id, return_id, payment_id, expense_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const updateIssueRow = db.prepare(
    "UPDATE sync_issues SET kind = ?, request_id = ?, provisional_number = ?, server_invoice_number = ?, server_id = ?, customer_name = ?, total = ?, reason = ?, payload_json = ?, status = ?, sync_error = ?, updated_at = ?, customer_id = ?, supplier_id = ?, purchase_id = ?, return_id = ?, payment_id = ?, expense_id = ? WHERE scope = ? AND id = ?",
  );
  const updateIssueStatus = db.prepare(
    "UPDATE sync_issues SET status = ?, updated_at = ? WHERE scope = ? AND id = ?",
  );
  const updateIssueText = db.prepare(
    "UPDATE sync_issues SET reason = ?, sync_error = ?, updated_at = ? WHERE scope = ? AND id = ?",
  );
  const selectCounter = db.prepare("SELECT value FROM meta WHERE key = ?");
  const upsertCounter = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const selectMirror = db.prepare(
    "SELECT id, data_json, saved_at FROM mirrors WHERE kind = ? AND scope = ? ORDER BY saved_at ASC, id ASC",
  );
  const deleteMirrorScope = db.prepare("DELETE FROM mirrors WHERE kind = ? AND scope = ?");
  const upsertMirrorRow = db.prepare(
    "INSERT INTO mirrors (kind, scope, id, data_json, saved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, scope, id) DO UPDATE SET data_json = excluded.data_json, saved_at = excluded.saved_at",
  );
  const selectCustomers = db.prepare(
    "SELECT id, kind, data_json, idempotency_key, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_customers WHERE scope = ? ORDER BY created_at ASC, id ASC",
  );
  const selectCustomerById = db.prepare(
    "SELECT id, kind, data_json, idempotency_key, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_customers WHERE scope = ? AND id = ?",
  );
  const insertCustomer = db.prepare(
    "INSERT INTO local_customers (id, scope, kind, data_json, idempotency_key, synced, server_id, sync_status, sync_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const updateCustomerRow = db.prepare(
    "UPDATE local_customers SET kind = ?, data_json = ?, synced = ?, server_id = ?, sync_status = ?, sync_error = ?, updated_at = ? WHERE scope = ? AND id = ?",
  );
  const deleteCustomer = db.prepare("DELETE FROM local_customers WHERE scope = ? AND id = ?");
  const selectPurchases = db.prepare(
    "SELECT id, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_purchases WHERE scope = ? ORDER BY created_at ASC, id ASC",
  );
  const selectPurchaseById = db.prepare(
    "SELECT id, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_purchases WHERE scope = ? AND id = ?",
  );
  const insertPurchase = db.prepare(
    "INSERT INTO local_purchases (id, scope, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const updatePurchaseRow = db.prepare(
    "UPDATE local_purchases SET input_json = ?, provisional_number = ?, synced = ?, server_id = ?, sync_status = ?, sync_error = ?, updated_at = ? WHERE scope = ? AND id = ?",
  );
  const deletePurchase = db.prepare("DELETE FROM local_purchases WHERE scope = ? AND id = ?");
  const selectSuppliers = db.prepare(
    "SELECT id, kind, data_json, idempotency_key, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_suppliers WHERE scope = ? ORDER BY created_at ASC, id ASC",
  );
  const selectSupplierById = db.prepare(
    "SELECT id, kind, data_json, idempotency_key, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_suppliers WHERE scope = ? AND id = ?",
  );
  const insertSupplier = db.prepare(
    "INSERT INTO local_suppliers (id, scope, kind, data_json, idempotency_key, synced, server_id, sync_status, sync_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const updateSupplierRow = db.prepare(
    "UPDATE local_suppliers SET kind = ?, data_json = ?, synced = ?, server_id = ?, sync_status = ?, sync_error = ?, updated_at = ? WHERE scope = ? AND id = ?",
  );
  const deleteSupplier = db.prepare("DELETE FROM local_suppliers WHERE scope = ? AND id = ?");
  const selectReturns = db.prepare(
    "SELECT id, kind, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_returns WHERE scope = ? ORDER BY created_at ASC, id ASC",
  );
  const selectReturnById = db.prepare(
    "SELECT id, kind, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_returns WHERE scope = ? AND id = ?",
  );
  const insertReturn = db.prepare(
    "INSERT INTO local_returns (id, scope, kind, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const updateReturnRow = db.prepare(
    "UPDATE local_returns SET kind = ?, input_json = ?, provisional_number = ?, synced = ?, server_id = ?, sync_status = ?, sync_error = ?, updated_at = ? WHERE scope = ? AND id = ?",
  );
  const deleteReturn = db.prepare("DELETE FROM local_returns WHERE scope = ? AND id = ?");
  const selectPayments = db.prepare(
    "SELECT id, action, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_payments WHERE scope = ? ORDER BY created_at ASC, id ASC",
  );
  const selectPaymentById = db.prepare(
    "SELECT id, action, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_payments WHERE scope = ? AND id = ?",
  );
  const insertPayment = db.prepare(
    "INSERT INTO local_payments (id, scope, action, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const updatePaymentRow = db.prepare(
    "UPDATE local_payments SET action = ?, input_json = ?, provisional_number = ?, synced = ?, server_id = ?, sync_status = ?, sync_error = ?, updated_at = ? WHERE scope = ? AND id = ?",
  );
  const deletePayment = db.prepare("DELETE FROM local_payments WHERE scope = ? AND id = ?");
  const selectExpenses = db.prepare(
    "SELECT id, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_expenses WHERE scope = ? ORDER BY created_at ASC, id ASC",
  );
  const selectExpenseById = db.prepare(
    "SELECT id, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at FROM local_expenses WHERE scope = ? AND id = ?",
  );
  const insertExpense = db.prepare(
    "INSERT INTO local_expenses (id, scope, input_json, provisional_number, synced, server_id, sync_status, sync_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const updateExpenseRow = db.prepare(
    "UPDATE local_expenses SET input_json = ?, provisional_number = ?, synced = ?, server_id = ?, sync_status = ?, sync_error = ?, updated_at = ? WHERE scope = ? AND id = ?",
  );
  const deleteExpense = db.prepare("DELETE FROM local_expenses WHERE scope = ? AND id = ?");

  function nextProvisionalNumber(): string {
    const row = selectCounter.get(PROVISIONAL_COUNTER_KEY) as { value: string } | undefined;
    const next = (row ? Number.parseInt(row.value, 10) || 0 : 0) + 1;
    upsertCounter.run(PROVISIONAL_COUNTER_KEY, String(next));
    return formatProvisionalNumber(next);
  }

  // Slice S6 — purchase provisional numbers have their own counter
  // (a purchase must never take a sale's number, and vice versa).
  // Same discipline as sales: allocated inside the same transaction
  // as the row write, never reused.
  function nextProvisionalPurchaseNumber(): string {
    const row = selectCounter.get(PROVISIONAL_PURCHASE_COUNTER_KEY) as { value: string } | undefined;
    const next = (row ? Number.parseInt(row.value, 10) || 0 : 0) + 1;
    upsertCounter.run(PROVISIONAL_PURCHASE_COUNTER_KEY, String(next));
    return formatProvisionalPurchaseNumber(next);
  }

  // Slice S7 — returns, payments and expenses each have their own
  // counter (a return must never take a sale's number, and so on).
  // Same discipline: allocated inside the same transaction as the
  // row write, never reused.
  function nextProvisionalSalesReturnNumber(): string {
    const row = selectCounter.get(PROVISIONAL_SALES_RETURN_COUNTER_KEY) as { value: string } | undefined;
    const next = (row ? Number.parseInt(row.value, 10) || 0 : 0) + 1;
    upsertCounter.run(PROVISIONAL_SALES_RETURN_COUNTER_KEY, String(next));
    return formatProvisionalSalesReturnNumber(next);
  }

  function nextProvisionalPurchaseReturnNumber(): string {
    const row = selectCounter.get(PROVISIONAL_PURCHASE_RETURN_COUNTER_KEY) as { value: string } | undefined;
    const next = (row ? Number.parseInt(row.value, 10) || 0 : 0) + 1;
    upsertCounter.run(PROVISIONAL_PURCHASE_RETURN_COUNTER_KEY, String(next));
    return formatProvisionalPurchaseReturnNumber(next);
  }

  function nextProvisionalPaymentNumber(): string {
    const row = selectCounter.get(PROVISIONAL_PAYMENT_COUNTER_KEY) as { value: string } | undefined;
    const next = (row ? Number.parseInt(row.value, 10) || 0 : 0) + 1;
    upsertCounter.run(PROVISIONAL_PAYMENT_COUNTER_KEY, String(next));
    return formatProvisionalPaymentNumber(next);
  }

  function nextProvisionalExpenseNumber(): string {
    const row = selectCounter.get(PROVISIONAL_EXPENSE_COUNTER_KEY) as { value: string } | undefined;
    const next = (row ? Number.parseInt(row.value, 10) || 0 : 0) + 1;
    upsertCounter.run(PROVISIONAL_EXPENSE_COUNTER_KEY, String(next));
    return formatProvisionalExpenseNumber(next);
  }

  function rowToSale(row: {
    idempotency_key: string;
    input_json: string;
    provisional_number: string | null;
    created_at: string | null;
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
      createdAt: row.created_at,
    };
  }

  function rowToMirror(row: { id: string; data_json: string; saved_at: string }): MirrorRow | null {
    const data = parseJsonObject(row.data_json);
    if (!data) {
      // Same discipline as a corrupt queue row: skip it, keep the rest.
      console.error(`Aankh local store: skipping corrupt mirror row ${row.id}`);
      return null;
    }
    return { id: row.id, data, savedAt: row.saved_at };
  }

  function rowToIssue(row: {
    id: string;
    scope: string;
    kind: string;
    request_id: string | null;
    provisional_number: string | null;
    server_invoice_number: string | null;
    server_id: string | null;
    customer_name: string | null;
    total: number | null;
    reason: string;
    payload_json: string | null;
    status: string;
    sync_error: string | null;
    created_at: string;
    updated_at: string;
    customer_id: string | null;
    supplier_id: string | null;
    purchase_id: string | null;
    return_id: string | null;
    payment_id: string | null;
    expense_id: string | null;
  }): SyncIssueRow {
    return {
      id: row.id,
      scope: row.scope,
      kind: row.kind,
      requestId: row.request_id,
      provisionalNumber: row.provisional_number,
      serverInvoiceNumber: row.server_invoice_number,
      serverId: row.server_id,
      customerName: row.customer_name,
      total: row.total,
      reason: row.reason,
      payloadJson: row.payload_json,
      status: row.status,
      syncError: row.sync_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      customerId: row.customer_id,
      supplierId: row.supplier_id,
      purchaseId: row.purchase_id,
      returnId: row.return_id,
      paymentId: row.payment_id,
      expenseId: row.expense_id,
    };
  }

  function rowToReturn(row: {
    id: string;
    kind: string;
    input_json: string;
    provisional_number: string | null;
    synced: number;
    server_id: string | null;
    sync_status: string;
    sync_error: string | null;
    created_at: string;
    updated_at: string;
  }): LocalReturnRow | null {
    const input = parseJsonObject(row.input_json);
    if (!input) {
      // Same discipline as a corrupt queue row: skip it, keep the rest.
      console.error(`Aankh local store: skipping corrupt local_returns row ${row.id}`);
      return null;
    }
    return {
      id: row.id,
      kind: row.kind as LocalReturnKind,
      input,
      provisionalNumber: row.provisional_number,
      synced: row.synced,
      serverId: row.server_id,
      syncStatus: row.sync_status,
      syncError: row.sync_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function rowToPayment(row: {
    id: string;
    action: string;
    input_json: string;
    provisional_number: string | null;
    synced: number;
    server_id: string | null;
    sync_status: string;
    sync_error: string | null;
    created_at: string;
    updated_at: string;
  }): LocalPaymentRow | null {
    const input = parseJsonObject(row.input_json);
    if (!input) {
      // Same discipline as a corrupt queue row: skip it, keep the rest.
      console.error(`Aankh local store: skipping corrupt local_payments row ${row.id}`);
      return null;
    }
    return {
      id: row.id,
      action: row.action as LocalPaymentAction,
      input,
      provisionalNumber: row.provisional_number,
      synced: row.synced,
      serverId: row.server_id,
      syncStatus: row.sync_status,
      syncError: row.sync_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function rowToExpense(row: {
    id: string;
    input_json: string;
    provisional_number: string | null;
    synced: number;
    server_id: string | null;
    sync_status: string;
    sync_error: string | null;
    created_at: string;
    updated_at: string;
  }): LocalExpenseRow | null {
    const input = parseJsonObject(row.input_json);
    if (!input) {
      // Same discipline as a corrupt queue row: skip it, keep the rest.
      console.error(`Aankh local store: skipping corrupt local_expenses row ${row.id}`);
      return null;
    }
    return {
      id: row.id,
      input,
      provisionalNumber: row.provisional_number,
      synced: row.synced,
      serverId: row.server_id,
      syncStatus: row.sync_status,
      syncError: row.sync_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function rowToPurchase(row: {
    id: string;
    input_json: string;
    provisional_number: string | null;
    synced: number;
    server_id: string | null;
    sync_status: string;
    sync_error: string | null;
    created_at: string;
    updated_at: string;
  }): LocalPurchaseRow | null {
    const input = parseJsonObject(row.input_json);
    if (!input) {
      // Same discipline as a corrupt queue row: skip it, keep the rest.
      console.error(`Aankh local store: skipping corrupt local_purchases row ${row.id}`);
      return null;
    }
    return {
      id: row.id,
      input,
      provisionalNumber: row.provisional_number,
      synced: row.synced,
      serverId: row.server_id,
      syncStatus: row.sync_status,
      syncError: row.sync_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function rowToSupplier(row: {
    id: string;
    kind: string;
    data_json: string;
    idempotency_key: string;
    synced: number;
    server_id: string | null;
    sync_status: string;
    sync_error: string | null;
    created_at: string;
    updated_at: string;
  }): LocalSupplierRow | null {
    const data = parseJsonObject(row.data_json);
    if (!data) {
      // Same discipline as a corrupt queue row: skip it, keep the rest.
      console.error(`Aankh local store: skipping corrupt local_suppliers row ${row.id}`);
      return null;
    }
    return {
      id: row.id,
      kind: row.kind as LocalSupplierKind,
      data,
      idempotencyKey: row.idempotency_key,
      synced: row.synced,
      serverId: row.server_id,
      syncStatus: row.sync_status,
      syncError: row.sync_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function rowToCustomer(row: {
    id: string;
    kind: string;
    data_json: string;
    idempotency_key: string;
    synced: number;
    server_id: string | null;
    sync_status: string;
    sync_error: string | null;
    created_at: string;
    updated_at: string;
  }): LocalCustomerRow | null {
    const data = parseJsonObject(row.data_json);
    if (!data) {
      // Same discipline as a corrupt queue row: skip it, keep the rest.
      console.error(`Aankh local store: skipping corrupt local_customers row ${row.id}`);
      return null;
    }
    return {
      id: row.id,
      kind: row.kind as LocalCustomerKind,
      data,
      idempotencyKey: row.idempotency_key,
      synced: row.synced,
      serverId: row.server_id,
      syncStatus: row.sync_status,
      syncError: row.sync_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  const upsertIssueTx = db.transaction((issue: SyncIssueRow): SyncIssueRow => {
    // A re-park of the same sale (or a re-recorded link for the same
    // server row) updates the open row instead of duplicating it.
    // A resolved/discarded row never matches: a later problem with the
    // same sale is a new issue, not a resurrection.
    const existing =
      issue.requestId != null
        ? (selectOpenIssueByRequest.get(issue.scope, issue.requestId) as Parameters<typeof rowToIssue>[0] | undefined)
        : issue.serverId != null
          ? (selectOpenIssueByServer.get(issue.scope, issue.serverId) as Parameters<typeof rowToIssue>[0] | undefined)
          : undefined;
    const now = new Date().toISOString();
    if (existing) {
      const kept = rowToIssue(existing);
      updateIssueRow.run(
        issue.kind,
        issue.requestId,
        issue.provisionalNumber,
        issue.serverInvoiceNumber,
        issue.serverId,
        issue.customerName,
        issue.total,
        issue.reason,
        issue.payloadJson,
        issue.status,
        issue.syncError,
        now,
        issue.customerId,
        issue.supplierId ?? null,
        issue.purchaseId ?? null,
        issue.returnId ?? null,
        issue.paymentId ?? null,
        issue.expenseId ?? null,
        issue.scope,
        kept.id,
      );
      return { ...issue, id: kept.id, createdAt: kept.createdAt, updatedAt: now };
    }
    insertIssue.run(
      issue.id,
      issue.scope,
      issue.kind,
      issue.requestId,
      issue.provisionalNumber,
      issue.serverInvoiceNumber,
      issue.serverId,
      issue.customerName,
      issue.total,
      issue.reason,
      issue.payloadJson,
      issue.status,
      issue.syncError,
      issue.createdAt,
      issue.updatedAt,
      issue.customerId,
      issue.supplierId ?? null,
      issue.purchaseId ?? null,
      issue.returnId ?? null,
      issue.paymentId ?? null,
      issue.expenseId ?? null,
    );
    return issue;
  });

  const replaceSalesTx = db.transaction((scope: string, rows: LocalSaleRow[]): LocalSaleRow[] => {
    // Preserve what the queue already knows (provisional numbers, the
    // first-queued time and the sync columns S3 fills in) so a replace
    // never downgrades a row. Slice S4: created_at is preserved — a
    // rewrite on every queue mutation used to re-stamp it, moving a
    // sale's history time to the last drain instead of its save time.
    const kept = new Map<string, { provisionalNumber: string | null; createdAt: string | null; synced: number; serverId: string | null; syncStatus: string; syncError: string | null }>();
    for (const existing of selectSales.all(scope) as Array<{
      idempotency_key: string;
      provisional_number: string | null;
      created_at: string | null;
      synced: number;
      server_id: string | null;
      sync_status: string;
      sync_error: string | null;
    }>) {
      kept.set(existing.idempotency_key, {
        provisionalNumber: existing.provisional_number,
        createdAt: existing.created_at,
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
      const createdAt = previous?.createdAt ?? row.createdAt ?? now;
      insertSale.run(
        row.requestId,
        scope,
        provisionalNumber,
        JSON.stringify(row.input),
        previous?.synced ?? 0,
        previous?.serverId ?? null,
        previous?.syncStatus ?? "pending",
        previous?.syncError ?? null,
        createdAt,
        now,
      );
      stored.push({ requestId: row.requestId, input: row.input, provisionalNumber, createdAt });
    }
    return stored;
  });

  const replaceMirrorTx = db.transaction(
    (kind: MirrorKind, scope: string, rows: Array<{ id: string; data: Record<string, unknown> }>): MirrorRow[] => {
      deleteMirrorScope.run(kind, scope);
      const savedAt = new Date().toISOString();
      const stored: MirrorRow[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        upsertMirrorRow.run(kind, scope, row.id, JSON.stringify(row.data), savedAt);
        stored.push({ id: row.id, data: row.data, savedAt });
      }
      return stored;
    },
  );

  const upsertCustomerTx = db.transaction((scope: string, row: LocalCustomerRow): LocalCustomerRow => {
    // An edit of an unsynced create stays a create (one insert on sync,
    // not insert + update). The idempotency key and the first-created
    // time survive a rewrite; the caller owns the sync columns — a UI
    // edit resets the row to pending (a corrected record retries), the
    // sync engine parks it as rejected with its reason.
    const existing = selectCustomerById.get(scope, row.id) as
      | {
          id: string;
          kind: string;
          data_json: string;
          idempotency_key: string;
          synced: number;
          server_id: string | null;
          sync_status: string;
          sync_error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    const now = new Date().toISOString();
    if (!existing) {
      insertCustomer.run(
        row.id,
        scope,
        row.kind,
        JSON.stringify(row.data),
        row.idempotencyKey,
        row.synced ?? 0,
        row.serverId ?? null,
        row.syncStatus ?? "pending",
        row.syncError ?? null,
        row.createdAt,
        row.updatedAt,
      );
      return row;
    }
    const kept = rowToCustomer(existing);
    if (!kept) throw new Error("Invalid local customer entry");
    const kind: LocalCustomerKind = kept.kind === "create" ? "create" : row.kind;
    updateCustomerRow.run(
      kind,
      JSON.stringify(row.data),
      row.synced ?? kept.synced,
      row.serverId ?? kept.serverId,
      row.syncStatus ?? kept.syncStatus,
      row.syncError === undefined ? kept.syncError : row.syncError,
      now,
      scope,
      row.id,
    );
    return {
      ...row,
      kind,
      idempotencyKey: kept.idempotencyKey,
      synced: row.synced ?? kept.synced,
      serverId: row.serverId ?? kept.serverId,
      syncStatus: row.syncStatus ?? kept.syncStatus,
      syncError: row.syncError === undefined ? kept.syncError : row.syncError,
      createdAt: kept.createdAt,
      updatedAt: now,
    };
  });

  const upsertPurchaseTx = db.transaction((scope: string, row: LocalPurchaseRow): LocalPurchaseRow => {
    // The provisional number is allocated once, inside the same
    // transaction as the row write, and survives a rewrite — a retry
    // must not move a purchase's history number. Numbers are never
    // reused: a failed write leaves a gap, never a duplicate (like
    // server invoice numbers skipping on a failed save).
    const existing = selectPurchaseById.get(scope, row.id) as
      | {
          id: string;
          input_json: string;
          provisional_number: string | null;
          synced: number;
          server_id: string | null;
          sync_status: string;
          sync_error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    const now = new Date().toISOString();
    if (!existing) {
      const provisionalNumber = row.provisionalNumber ?? nextProvisionalPurchaseNumber();
      insertPurchase.run(
        row.id,
        scope,
        JSON.stringify(row.input),
        provisionalNumber,
        row.synced ?? 0,
        row.serverId ?? null,
        row.syncStatus ?? "pending",
        row.syncError ?? null,
        row.createdAt,
        row.updatedAt,
      );
      return { ...row, provisionalNumber };
    }
    const kept = rowToPurchase(existing);
    if (!kept) throw new Error("Invalid local purchase entry");
    const provisionalNumber = kept.provisionalNumber ?? row.provisionalNumber ?? nextProvisionalPurchaseNumber();
    updatePurchaseRow.run(
      JSON.stringify(row.input),
      provisionalNumber,
      row.synced ?? kept.synced,
      row.serverId ?? kept.serverId,
      row.syncStatus ?? kept.syncStatus,
      row.syncError === undefined ? kept.syncError : row.syncError,
      now,
      scope,
      row.id,
    );
    return {
      ...row,
      provisionalNumber,
      synced: row.synced ?? kept.synced,
      serverId: row.serverId ?? kept.serverId,
      syncStatus: row.syncStatus ?? kept.syncStatus,
      syncError: row.syncError === undefined ? kept.syncError : row.syncError,
      createdAt: kept.createdAt,
      updatedAt: now,
    };
  });

  const upsertSupplierTx = db.transaction((scope: string, row: LocalSupplierRow): LocalSupplierRow => {
    // Same discipline as upsertCustomerTx: an edit of an unsynced
    // create stays a create (one insert on sync, not insert + update).
    // The idempotency key and the first-created time survive a
    // rewrite; the caller owns the sync columns.
    const existing = selectSupplierById.get(scope, row.id) as
      | {
          id: string;
          kind: string;
          data_json: string;
          idempotency_key: string;
          synced: number;
          server_id: string | null;
          sync_status: string;
          sync_error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    const now = new Date().toISOString();
    if (!existing) {
      insertSupplier.run(
        row.id,
        scope,
        row.kind,
        JSON.stringify(row.data),
        row.idempotencyKey,
        row.synced ?? 0,
        row.serverId ?? null,
        row.syncStatus ?? "pending",
        row.syncError ?? null,
        row.createdAt,
        row.updatedAt,
      );
      return row;
    }
    const kept = rowToSupplier(existing);
    if (!kept) throw new Error("Invalid local supplier entry");
    const kind: LocalSupplierKind = kept.kind === "create" ? "create" : row.kind;
    updateSupplierRow.run(
      kind,
      JSON.stringify(row.data),
      row.synced ?? kept.synced,
      row.serverId ?? kept.serverId,
      row.syncStatus ?? kept.syncStatus,
      row.syncError === undefined ? kept.syncError : row.syncError,
      now,
      scope,
      row.id,
    );
    return {
      ...row,
      kind,
      idempotencyKey: kept.idempotencyKey,
      synced: row.synced ?? kept.synced,
      serverId: row.serverId ?? kept.serverId,
      syncStatus: row.syncStatus ?? kept.syncStatus,
      syncError: row.syncError === undefined ? kept.syncError : row.syncError,
      createdAt: kept.createdAt,
      updatedAt: now,
    };
  });

  // Slice S7 — the return / payment / expense upserts share one
  // discipline (the purchase one): the provisional number is
  // allocated once, inside the same transaction as the row write,
  // and survives a rewrite — a retry must not move a row's history
  // number. Numbers are never reused: a failed write leaves a gap,
  // never a duplicate (like server invoice numbers skipping on a
  // failed save).
  const upsertReturnTx = db.transaction((scope: string, row: LocalReturnRow): LocalReturnRow => {
    const existing = selectReturnById.get(scope, row.id) as
      | {
          id: string;
          kind: string;
          input_json: string;
          provisional_number: string | null;
          synced: number;
          server_id: string | null;
          sync_status: string;
          sync_error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    const now = new Date().toISOString();
    if (!existing) {
      const provisionalNumber =
        row.provisionalNumber ??
        (row.kind === "sales" ? nextProvisionalSalesReturnNumber() : nextProvisionalPurchaseReturnNumber());
      insertReturn.run(
        row.id,
        scope,
        row.kind,
        JSON.stringify(row.input),
        provisionalNumber,
        row.synced ?? 0,
        row.serverId ?? null,
        row.syncStatus ?? "pending",
        row.syncError ?? null,
        row.createdAt,
        row.updatedAt,
      );
      return { ...row, provisionalNumber };
    }
    const kept = rowToReturn(existing);
    if (!kept) throw new Error("Invalid local return entry");
    const provisionalNumber = kept.provisionalNumber ?? row.provisionalNumber ?? (row.kind === "sales" ? nextProvisionalSalesReturnNumber() : nextProvisionalPurchaseReturnNumber());
    updateReturnRow.run(
      row.kind,
      JSON.stringify(row.input),
      provisionalNumber,
      row.synced ?? kept.synced,
      row.serverId ?? kept.serverId,
      row.syncStatus ?? kept.syncStatus,
      row.syncError === undefined ? kept.syncError : row.syncError,
      now,
      scope,
      row.id,
    );
    return {
      ...row,
      provisionalNumber,
      synced: row.synced ?? kept.synced,
      serverId: row.serverId ?? kept.serverId,
      syncStatus: row.syncStatus ?? kept.syncStatus,
      syncError: row.syncError === undefined ? kept.syncError : row.syncError,
      createdAt: kept.createdAt,
      updatedAt: now,
    };
  });

  const upsertPaymentTx = db.transaction((scope: string, row: LocalPaymentRow): LocalPaymentRow => {
    const existing = selectPaymentById.get(scope, row.id) as
      | {
          id: string;
          action: string;
          input_json: string;
          provisional_number: string | null;
          synced: number;
          server_id: string | null;
          sync_status: string;
          sync_error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    const now = new Date().toISOString();
    if (!existing) {
      const provisionalNumber = row.provisionalNumber ?? nextProvisionalPaymentNumber();
      insertPayment.run(
        row.id,
        scope,
        row.action,
        JSON.stringify(row.input),
        provisionalNumber,
        row.synced ?? 0,
        row.serverId ?? null,
        row.syncStatus ?? "pending",
        row.syncError ?? null,
        row.createdAt,
        row.updatedAt,
      );
      return { ...row, provisionalNumber };
    }
    const kept = rowToPayment(existing);
    if (!kept) throw new Error("Invalid local payment entry");
    const provisionalNumber = kept.provisionalNumber ?? row.provisionalNumber ?? nextProvisionalPaymentNumber();
    updatePaymentRow.run(
      row.action,
      JSON.stringify(row.input),
      provisionalNumber,
      row.synced ?? kept.synced,
      row.serverId ?? kept.serverId,
      row.syncStatus ?? kept.syncStatus,
      row.syncError === undefined ? kept.syncError : row.syncError,
      now,
      scope,
      row.id,
    );
    return {
      ...row,
      provisionalNumber,
      synced: row.synced ?? kept.synced,
      serverId: row.serverId ?? kept.serverId,
      syncStatus: row.syncStatus ?? kept.syncStatus,
      syncError: row.syncError === undefined ? kept.syncError : row.syncError,
      createdAt: kept.createdAt,
      updatedAt: now,
    };
  });

  const upsertExpenseTx = db.transaction((scope: string, row: LocalExpenseRow): LocalExpenseRow => {
    const existing = selectExpenseById.get(scope, row.id) as
      | {
          id: string;
          input_json: string;
          provisional_number: string | null;
          synced: number;
          server_id: string | null;
          sync_status: string;
          sync_error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    const now = new Date().toISOString();
    if (!existing) {
      const provisionalNumber = row.provisionalNumber ?? nextProvisionalExpenseNumber();
      insertExpense.run(
        row.id,
        scope,
        JSON.stringify(row.input),
        provisionalNumber,
        row.synced ?? 0,
        row.serverId ?? null,
        row.syncStatus ?? "pending",
        row.syncError ?? null,
        row.createdAt,
        row.updatedAt,
      );
      return { ...row, provisionalNumber };
    }
    const kept = rowToExpense(existing);
    if (!kept) throw new Error("Invalid local expense entry");
    const provisionalNumber = kept.provisionalNumber ?? row.provisionalNumber ?? nextProvisionalExpenseNumber();
    updateExpenseRow.run(
      JSON.stringify(row.input),
      provisionalNumber,
      row.synced ?? kept.synced,
      row.serverId ?? kept.serverId,
      row.syncStatus ?? kept.syncStatus,
      row.syncError === undefined ? kept.syncError : row.syncError,
      now,
      scope,
      row.id,
    );
    return {
      ...row,
      provisionalNumber,
      synced: row.synced ?? kept.synced,
      serverId: row.serverId ?? kept.serverId,
      syncStatus: row.syncStatus ?? kept.syncStatus,
      syncError: row.syncError === undefined ? kept.syncError : row.syncError,
      createdAt: kept.createdAt,
      updatedAt: now,
    };
  });

  return {
    listSales(scope: string): LocalSaleRow[] {
      const rows = selectSales.all(scope) as Array<{
        idempotency_key: string;
        input_json: string;
        provisional_number: string | null;
        created_at: string | null;
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

    listIssues(scope: string): SyncIssueRow[] {
      const rows = selectIssues.all(scope) as Array<Parameters<typeof rowToIssue>[0]>;
      return rows.map(rowToIssue);
    },

    upsertIssue(issue: SyncIssueRow): SyncIssueRow {
      if (!isValidIssue(issue)) throw new Error("Invalid sync issue entry");
      return upsertIssueTx(issue);
    },

    setIssueStatus(scope: string, id: string, status: string): void {
      if (!SYNC_ISSUE_STATUSES.has(status)) throw new Error("Invalid sync issue status");
      updateIssueStatus.run(status, new Date().toISOString(), scope, id);
    },

    updateIssue(scope: string, id: string, patch: { reason?: string; syncError?: string | null }): void {
      const current = (selectIssues.all(scope) as Array<Parameters<typeof rowToIssue>[0]>).find(
        (row) => row.id === id,
      );
      if (!current) return;
      updateIssueText.run(
        patch.reason ?? current.reason,
        patch.syncError === undefined ? current.sync_error : patch.syncError,
        new Date().toISOString(),
        scope,
        id,
      );
    },

    listMirror(kind: MirrorKind, scope: string): MirrorRow[] {
      const rows = selectMirror.all(kind, scope) as Array<{
        id: string;
        data_json: string;
        saved_at: string;
      }>;
      const mirror: MirrorRow[] = [];
      for (const row of rows) {
        const parsed = rowToMirror(row);
        if (parsed) mirror.push(parsed);
      }
      return mirror;
    },

    replaceMirror(
      kind: MirrorKind,
      scope: string,
      rows: Array<{ id: string; data: Record<string, unknown> }>,
    ): MirrorRow[] {
      return replaceMirrorTx(kind, scope, rows);
    },

    upsertMirror(
      kind: MirrorKind,
      scope: string,
      row: { id: string; data: Record<string, unknown> },
    ): MirrorRow {
      const savedAt = new Date().toISOString();
      upsertMirrorRow.run(kind, scope, row.id, JSON.stringify(row.data), savedAt);
      return { id: row.id, data: row.data, savedAt };
    },

    listCustomers(scope: string): LocalCustomerRow[] {
      const rows = selectCustomers.all(scope) as Array<{
        id: string;
        kind: string;
        data_json: string;
        idempotency_key: string;
        synced: number;
        server_id: string | null;
        sync_status: string;
        sync_error: string | null;
        created_at: string;
        updated_at: string;
      }>;
      const customers: LocalCustomerRow[] = [];
      for (const row of rows) {
        const customer = rowToCustomer(row);
        if (customer) customers.push(customer);
      }
      return customers;
    },

    upsertCustomer(scope: string, row: LocalCustomerRow): LocalCustomerRow {
      if (!isValidCustomerRow(row)) throw new Error("Invalid local customer entry");
      if (!LOCAL_CUSTOMER_SYNC_STATUSES.has(row.syncStatus ?? "pending")) {
        throw new Error("Invalid local customer sync status");
      }
      return upsertCustomerTx(scope, row);
    },

    removeCustomer(scope: string, id: string): void {
      deleteCustomer.run(scope, id);
    },

    listPurchases(scope: string): LocalPurchaseRow[] {
      const rows = selectPurchases.all(scope) as Array<{
        id: string;
        input_json: string;
        provisional_number: string | null;
        synced: number;
        server_id: string | null;
        sync_status: string;
        sync_error: string | null;
        created_at: string;
        updated_at: string;
      }>;
      const purchases: LocalPurchaseRow[] = [];
      for (const row of rows) {
        const purchase = rowToPurchase(row);
        if (purchase) purchases.push(purchase);
      }
      return purchases;
    },

    upsertPurchase(scope: string, row: LocalPurchaseRow): LocalPurchaseRow {
      if (!isValidPurchaseRow(row)) throw new Error("Invalid local purchase entry");
      if (!LOCAL_PURCHASE_SYNC_STATUSES.has(row.syncStatus ?? "pending")) {
        throw new Error("Invalid local purchase sync status");
      }
      return upsertPurchaseTx(scope, row);
    },

    removePurchase(scope: string, id: string): void {
      deletePurchase.run(scope, id);
    },

    listSuppliers(scope: string): LocalSupplierRow[] {
      const rows = selectSuppliers.all(scope) as Array<{
        id: string;
        kind: string;
        data_json: string;
        idempotency_key: string;
        synced: number;
        server_id: string | null;
        sync_status: string;
        sync_error: string | null;
        created_at: string;
        updated_at: string;
      }>;
      const suppliers: LocalSupplierRow[] = [];
      for (const row of rows) {
        const supplier = rowToSupplier(row);
        if (supplier) suppliers.push(supplier);
      }
      return suppliers;
    },

    upsertSupplier(scope: string, row: LocalSupplierRow): LocalSupplierRow {
      if (!isValidSupplierRow(row)) throw new Error("Invalid local supplier entry");
      if (!LOCAL_SUPPLIER_SYNC_STATUSES.has(row.syncStatus ?? "pending")) {
        throw new Error("Invalid local supplier sync status");
      }
      return upsertSupplierTx(scope, row);
    },

    removeSupplier(scope: string, id: string): void {
      deleteSupplier.run(scope, id);
    },

    listReturns(scope: string): LocalReturnRow[] {
      const rows = selectReturns.all(scope) as Array<{
        id: string;
        kind: string;
        input_json: string;
        provisional_number: string | null;
        synced: number;
        server_id: string | null;
        sync_status: string;
        sync_error: string | null;
        created_at: string;
        updated_at: string;
      }>;
      const returns: LocalReturnRow[] = [];
      for (const row of rows) {
        const parsed = rowToReturn(row);
        if (parsed) returns.push(parsed);
      }
      return returns;
    },

    upsertReturn(scope: string, row: LocalReturnRow): LocalReturnRow {
      if (!isValidReturnRow(row)) throw new Error("Invalid local return entry");
      if (!LOCAL_RETURN_SYNC_STATUSES.has(row.syncStatus ?? "pending")) {
        throw new Error("Invalid local return sync status");
      }
      return upsertReturnTx(scope, row);
    },

    removeReturn(scope: string, id: string): void {
      deleteReturn.run(scope, id);
    },

    listPayments(scope: string): LocalPaymentRow[] {
      const rows = selectPayments.all(scope) as Array<{
        id: string;
        action: string;
        input_json: string;
        provisional_number: string | null;
        synced: number;
        server_id: string | null;
        sync_status: string;
        sync_error: string | null;
        created_at: string;
        updated_at: string;
      }>;
      const payments: LocalPaymentRow[] = [];
      for (const row of rows) {
        const parsed = rowToPayment(row);
        if (parsed) payments.push(parsed);
      }
      return payments;
    },

    upsertPayment(scope: string, row: LocalPaymentRow): LocalPaymentRow {
      if (!isValidPaymentRow(row)) throw new Error("Invalid local payment entry");
      if (!LOCAL_PAYMENT_SYNC_STATUSES.has(row.syncStatus ?? "pending")) {
        throw new Error("Invalid local payment sync status");
      }
      return upsertPaymentTx(scope, row);
    },

    removePayment(scope: string, id: string): void {
      deletePayment.run(scope, id);
    },

    listExpenses(scope: string): LocalExpenseRow[] {
      const rows = selectExpenses.all(scope) as Array<{
        id: string;
        input_json: string;
        provisional_number: string | null;
        synced: number;
        server_id: string | null;
        sync_status: string;
        sync_error: string | null;
        created_at: string;
        updated_at: string;
      }>;
      const expenses: LocalExpenseRow[] = [];
      for (const row of rows) {
        const parsed = rowToExpense(row);
        if (parsed) expenses.push(parsed);
      }
      return expenses;
    },

    upsertExpense(scope: string, row: LocalExpenseRow): LocalExpenseRow {
      if (!isValidExpenseRow(row)) throw new Error("Invalid local expense entry");
      if (!LOCAL_EXPENSE_SYNC_STATUSES.has(row.syncStatus ?? "pending")) {
        throw new Error("Invalid local expense sync status");
      }
      return upsertExpenseTx(scope, row);
    },

    removeExpense(scope: string, id: string): void {
      deleteExpense.run(scope, id);
    },

    close(): void {
      db.close();
    },
  };
}
