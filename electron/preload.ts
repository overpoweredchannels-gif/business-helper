import { contextBridge, ipcRenderer } from "electron";
import type { LocalCustomerRow, LocalExpenseRow, LocalPaymentRow, LocalPurchaseRow, LocalReturnRow, LocalSaleRow, LocalSupplierRow, MirrorKind, MirrorRow, StoredIdentity, SyncIssueRow } from "./store";

// Slice S0 — minimal, context-isolated bridge. Slice S2 adds the
// local-first store: the main process owns the SQLite database
// (electron/store.ts) and the renderer reaches it over IPC. Every method
// below is one invoke round-trip; a rejection means the store is
// unavailable and the renderer falls back to browser storage (see
// src/lib/offline/local-store.ts). Slice S3 adds the Sync issues bridge
// on the same pattern (see src/lib/offline/sync-issues.ts). Slice S4
// adds the history + inventory mirror bridge the same way (see
// src/lib/offline/history-mirror.ts). Slice S5 adds the offline
// customers bridge the same way (see src/lib/offline/local-customers.ts).
// Slice S6 adds the offline purchases + suppliers bridges the same way
// (see src/lib/offline/local-purchases.ts and local-suppliers.ts).
// Slice S7 adds the offline returns + payments + expenses bridges the
// same way (see src/lib/offline/local-returns.ts, local-payments.ts
// and local-expenses.ts).

/** IPC channels for the local store. The renderer (src/lib/offline/…)
 * uses the same literal strings — keep them in sync when renaming. */
const CHANNELS = {
  listSales: "aankh:local-sales:list",
  replaceSales: "aankh:local-sales:replace",
  removeSale: "aankh:local-sales:remove",
  getIdentity: "aankh:identity:get",
  setIdentity: "aankh:identity:set",
  clearIdentity: "aankh:identity:clear",
  listIssues: "aankh:sync-issues:list",
  upsertIssue: "aankh:sync-issues:upsert",
  setIssueStatus: "aankh:sync-issues:set-status",
  updateIssue: "aankh:sync-issues:update",
  listMirror: "aankh:mirror:list",
  replaceMirror: "aankh:mirror:replace",
  upsertMirror: "aankh:mirror:upsert",
  listCustomers: "aankh:local-customers:list",
  upsertCustomer: "aankh:local-customers:upsert",
  removeCustomer: "aankh:local-customers:remove",
  listPurchases: "aankh:local-purchases:list",
  upsertPurchase: "aankh:local-purchases:upsert",
  removePurchase: "aankh:local-purchases:remove",
  listSuppliers: "aankh:local-suppliers:list",
  upsertSupplier: "aankh:local-suppliers:upsert",
  removeSupplier: "aankh:local-suppliers:remove",
  listReturns: "aankh:local-returns:list",
  upsertReturn: "aankh:local-returns:upsert",
  removeReturn: "aankh:local-returns:remove",
  listPayments: "aankh:local-payments:list",
  upsertPayment: "aankh:local-payments:upsert",
  removePayment: "aankh:local-payments:remove",
  listExpenses: "aankh:local-expenses:list",
  upsertExpense: "aankh:local-expenses:upsert",
  removeExpense: "aankh:local-expenses:remove",
} as const;

export interface AankhLocalSalesBridge {
  /** Queued sales for a scope, oldest first. */
  list(scope: string): Promise<LocalSaleRow[]>;
  /** Replace the whole queue for a scope; returns the stored rows (with provisional numbers assigned). */
  replace(scope: string, rows: LocalSaleRow[]): Promise<LocalSaleRow[]>;
  /** Delete one queued sale. */
  remove(scope: string, requestId: string): Promise<void>;
}

export interface AankhIdentityBridge {
  /** The cached identity from SQLite, or null. */
  get(): Promise<StoredIdentity | null>;
  /** Store (or replace) the cached identity. */
  set(entry: StoredIdentity): Promise<void>;
  /** Drop the cached identity (sign-out). */
  clear(): Promise<void>;
}

export interface AankhSyncIssuesBridge {
  /** Sync issues for a scope, oldest first. */
  list(scope: string): Promise<SyncIssueRow[]>;
  /** Insert an issue, or update the already-open one for the same sale. */
  upsert(issue: SyncIssueRow): Promise<SyncIssueRow>;
  /** Set one issue's status (`open` | `resolved` | `discarded`). */
  setStatus(scope: string, id: string, status: string): Promise<void>;
  /** Update one issue's reason / sync error text. */
  update(scope: string, id: string, patch: { reason?: string; syncError?: string | null }): Promise<void>;
}

export interface AankhMirrorBridge {
  /** Mirrored server rows for a kind + scope (Slice S4). */
  list(kind: MirrorKind, scope: string): Promise<MirrorRow[]>;
  /** Replace the whole mirror snapshot for a kind + scope; returns the stored rows. */
  replace(kind: MirrorKind, scope: string, rows: Array<{ id: string; data: Record<string, unknown> }>): Promise<MirrorRow[]>;
  /** Insert or replace one mirrored row; returns the stored row. */
  upsert(kind: MirrorKind, scope: string, row: { id: string; data: Record<string, unknown> }): Promise<MirrorRow>;
}

export interface AankhLocalCustomersBridge {
  /** Offline-created / offline-edited customers for a scope, oldest first. */
  list(scope: string): Promise<LocalCustomerRow[]>;
  /** Insert or replace one local customer row; returns the stored row. */
  upsert(scope: string, row: LocalCustomerRow): Promise<LocalCustomerRow>;
  /** Delete one local customer row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

export interface AankhLocalPurchasesBridge {
  /** Offline-created purchases for a scope, oldest first. */
  list(scope: string): Promise<LocalPurchaseRow[]>;
  /** Insert or replace one local purchase row; returns the stored row (with provisional number assigned). */
  upsert(scope: string, row: LocalPurchaseRow): Promise<LocalPurchaseRow>;
  /** Delete one local purchase row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

export interface AankhLocalSuppliersBridge {
  /** Offline-created / offline-edited suppliers for a scope, oldest first. */
  list(scope: string): Promise<LocalSupplierRow[]>;
  /** Insert or replace one local supplier row; returns the stored row. */
  upsert(scope: string, row: LocalSupplierRow): Promise<LocalSupplierRow>;
  /** Delete one local supplier row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

export interface AankhLocalReturnsBridge {
  /** Offline-created returns for a scope, oldest first. */
  list(scope: string): Promise<LocalReturnRow[]>;
  /** Insert or replace one local return row; returns the stored row (with provisional number assigned). */
  upsert(scope: string, row: LocalReturnRow): Promise<LocalReturnRow>;
  /** Delete one local return row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

export interface AankhLocalPaymentsBridge {
  /** Offline-created payments / voids for a scope, oldest first. */
  list(scope: string): Promise<LocalPaymentRow[]>;
  /** Insert or replace one local payment row; returns the stored row (with provisional number assigned). */
  upsert(scope: string, row: LocalPaymentRow): Promise<LocalPaymentRow>;
  /** Delete one local payment row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

export interface AankhLocalExpensesBridge {
  /** Offline-created expenses for a scope, oldest first. */
  list(scope: string): Promise<LocalExpenseRow[]>;
  /** Insert or replace one local expense row; returns the stored row (with provisional number assigned). */
  upsert(scope: string, row: LocalExpenseRow): Promise<LocalExpenseRow>;
  /** Delete one local expense row (server confirmed it). */
  remove(scope: string, id: string): Promise<void>;
}

export interface AankhDesktopBridge {
  /** True when the app runs inside the installed desktop shell. */
  isDesktop: true;
  /** Operating system the shell runs on (win32, darwin, linux). */
  platform: NodeJS.Platform;
  /** The local-first SQLite store (S2). Absent when the store failed to open. */
  localSales?: AankhLocalSalesBridge;
  /** The SQLite-backed identity cache (S2). Absent when the store failed to open. */
  identity?: AankhIdentityBridge;
  /** The SQLite-backed Sync issues list (S3). Absent when the store failed to open. */
  syncIssues?: AankhSyncIssuesBridge;
  /** The SQLite-backed history + inventory mirrors (S4). Absent when the store failed to open. */
  mirror?: AankhMirrorBridge;
  /** The SQLite-backed offline customers (S5). Absent when the store failed to open. */
  localCustomers?: AankhLocalCustomersBridge;
  /** The SQLite-backed offline purchases (S6). Absent when the store failed to open. */
  localPurchases?: AankhLocalPurchasesBridge;
  /** The SQLite-backed offline suppliers (S6). Absent when the store failed to open. */
  localSuppliers?: AankhLocalSuppliersBridge;
  /** The SQLite-backed offline returns (S7). Absent when the store failed to open. */
  localReturns?: AankhLocalReturnsBridge;
  /** The SQLite-backed offline payments + voids (S7). Absent when the store failed to open. */
  localPayments?: AankhLocalPaymentsBridge;
  /** The SQLite-backed offline expenses (S7). Absent when the store failed to open. */
  localExpenses?: AankhLocalExpensesBridge;
}

const bridge: AankhDesktopBridge = {
  isDesktop: true,
  platform: process.platform,
  localSales: {
    list: (scope) => ipcRenderer.invoke(CHANNELS.listSales, scope),
    replace: (scope, rows) => ipcRenderer.invoke(CHANNELS.replaceSales, scope, rows),
    remove: (scope, requestId) => ipcRenderer.invoke(CHANNELS.removeSale, scope, requestId),
  },
  identity: {
    get: () => ipcRenderer.invoke(CHANNELS.getIdentity),
    set: (entry) => ipcRenderer.invoke(CHANNELS.setIdentity, entry),
    clear: () => ipcRenderer.invoke(CHANNELS.clearIdentity),
  },
  syncIssues: {
    list: (scope) => ipcRenderer.invoke(CHANNELS.listIssues, scope),
    upsert: (issue) => ipcRenderer.invoke(CHANNELS.upsertIssue, issue),
    setStatus: (scope, id, status) => ipcRenderer.invoke(CHANNELS.setIssueStatus, scope, id, status),
    update: (scope, id, patch) => ipcRenderer.invoke(CHANNELS.updateIssue, scope, id, patch),
  },
  mirror: {
    list: (kind, scope) => ipcRenderer.invoke(CHANNELS.listMirror, kind, scope),
    replace: (kind, scope, rows) => ipcRenderer.invoke(CHANNELS.replaceMirror, kind, scope, rows),
    upsert: (kind, scope, row) => ipcRenderer.invoke(CHANNELS.upsertMirror, kind, scope, row),
  },
  localCustomers: {
    list: (scope) => ipcRenderer.invoke(CHANNELS.listCustomers, scope),
    upsert: (scope, row) => ipcRenderer.invoke(CHANNELS.upsertCustomer, scope, row),
    remove: (scope, id) => ipcRenderer.invoke(CHANNELS.removeCustomer, scope, id),
  },
  localPurchases: {
    list: (scope) => ipcRenderer.invoke(CHANNELS.listPurchases, scope),
    upsert: (scope, row) => ipcRenderer.invoke(CHANNELS.upsertPurchase, scope, row),
    remove: (scope, id) => ipcRenderer.invoke(CHANNELS.removePurchase, scope, id),
  },
  localSuppliers: {
    list: (scope) => ipcRenderer.invoke(CHANNELS.listSuppliers, scope),
    upsert: (scope, row) => ipcRenderer.invoke(CHANNELS.upsertSupplier, scope, row),
    remove: (scope, id) => ipcRenderer.invoke(CHANNELS.removeSupplier, scope, id),
  },
  localReturns: {
    list: (scope) => ipcRenderer.invoke(CHANNELS.listReturns, scope),
    upsert: (scope, row) => ipcRenderer.invoke(CHANNELS.upsertReturn, scope, row),
    remove: (scope, id) => ipcRenderer.invoke(CHANNELS.removeReturn, scope, id),
  },
  localPayments: {
    list: (scope) => ipcRenderer.invoke(CHANNELS.listPayments, scope),
    upsert: (scope, row) => ipcRenderer.invoke(CHANNELS.upsertPayment, scope, row),
    remove: (scope, id) => ipcRenderer.invoke(CHANNELS.removePayment, scope, id),
  },
  localExpenses: {
    list: (scope) => ipcRenderer.invoke(CHANNELS.listExpenses, scope),
    upsert: (scope, row) => ipcRenderer.invoke(CHANNELS.upsertExpense, scope, row),
    remove: (scope, id) => ipcRenderer.invoke(CHANNELS.removeExpense, scope, id),
  },
};

contextBridge.exposeInMainWorld("aankhDesktop", bridge);

declare global {
  interface Window {
    aankhDesktop: AankhDesktopBridge;
  }
}
