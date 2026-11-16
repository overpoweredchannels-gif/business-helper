/**
 * Slice S4 — Sales History + Inventory mirrors (Offline Tier-1).
 *
 * The desktop history + inventory read from SQLite mirrors
 * (`electron/store.ts`, table `mirrors`): whole server rows as fetched,
 * one snapshot per kind + scope. The web build has no mirror at all —
 * its fetches stay live-only, exactly as today — so every function here
 * is a no-op (false / empty) outside the desktop shell.
 *
 * Safety rules (same discipline as the sale queue):
 * - A mirror is a READ cache, never a source of truth for balances.
 *   It stores the rows the fetch functions already return; every figure
 *   the UI derives (paid/remaining, stock) is computed from them exactly
 *   as from live rows. `outstanding_balance` is never written here — the
 *   stored-balance engine owns it server-side and the client derives it.
 * - Rows are stored whole, as fetched. No merging: the newest
 *   successful fetch replaces the whole snapshot for that kind + scope,
 *   so a row deleted server-side does not linger offline.
 * - A failed mirror call never breaks the fetch: saves are
 *   fire-and-forget, loads return empty, and the caller falls back to
 *   the live fetch or an empty list.
 * - The bridge is absent when the store failed to open (or on web) —
 *   the fetch functions then behave exactly as they did before S4.
 */

import { isDesktopApp } from "@/lib/offline/identity-cache";
import type { AtomicSaleResult, PendingSale } from "@/lib/sales/atomic-sale-client";

/** Mirror kinds: the two history reads + the product catalogue snapshot. Slice S5 adds the customer list + the ledger inputs the offline balance derivation reads. */
export type MirrorKind =
  | "sales_transaction"
  | "sales_item"
  | "product"
  | "customer"
  | "customer_payment"
  | "customer_payment_allocation"
  | "sales_return"
  | "sales_return_item";

/** One mirrored server row, as it crosses the IPC bridge (plain JSON). */
export interface MirrorRow {
  /** Server row id (`sales_transactions.id`, `sales_items.id`, `products.id`). */
  id: string;
  /** The whole server row as fetched. */
  data: Record<string, unknown>;
  /** ISO timestamp of the fetch that wrote this snapshot. */
  savedAt: string;
}

export interface HistoryMirrorBackend {
  /** Mirrored rows for a kind + scope. */
  list(kind: MirrorKind, scope: string): Promise<MirrorRow[]>;
  /** Replace the whole snapshot for a kind + scope; returns the stored rows. */
  replace(
    kind: MirrorKind,
    scope: string,
    rows: Array<{ id: string; data: Record<string, unknown> }>,
  ): Promise<MirrorRow[]>;
  /** Insert or replace one mirrored row; returns the stored row. */
  upsert(
    kind: MirrorKind,
    scope: string,
    row: { id: string; data: Record<string, unknown> },
  ): Promise<MirrorRow>;
}

type DesktopMirrorBridge = HistoryMirrorBackend;

/** The preload bridge's mirror methods, or null outside the desktop shell. */
export function desktopMirrorBridge(): DesktopMirrorBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { aankhDesktop?: { mirror?: DesktopMirrorBridge } })
    .aankhDesktop;
  return bridge?.mirror ?? null;
}

/** The mirror backend for this build: SQLite on desktop, none on web. */
export function getHistoryMirrorBackend(): HistoryMirrorBackend | null {
  if (!isDesktopApp()) return null;
  return desktopMirrorBridge();
}

function isMirrorRow(value: unknown): value is MirrorRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<MirrorRow>;
  return (
    typeof row.id === "string" &&
    typeof row.data === "object" &&
    row.data !== null &&
    !Array.isArray(row.data) &&
    typeof row.savedAt === "string"
  );
}

/** Replace a whole mirror snapshot. False when there is no backend (web) or the write failed. */
export async function saveHistoryMirror<T extends { id: string | number }>(
  kind: MirrorKind,
  scope: string,
  rows: T[],
): Promise<boolean> {
  const backend = getHistoryMirrorBackend();
  if (!backend) return false;
  try {
    await backend.replace(
      kind,
      scope,
      rows.map((row) => ({ id: String(row.id), data: row as unknown as Record<string, unknown> })),
    );
    return true;
  } catch {
    return false;
  }
}

export type LoadedMirrorRows<T> = {
  rows: T[];
  /** ISO timestamp of the snapshot, or null when the mirror is empty. */
  savedAt: string | null;
};

/** Load a mirror snapshot. Empty (with null savedAt) when there is no backend, no rows, or a read fails. */
export async function loadHistoryMirror<T>(kind: MirrorKind, scope: string): Promise<LoadedMirrorRows<T>> {
  const empty: LoadedMirrorRows<T> = { rows: [], savedAt: null };
  const backend = getHistoryMirrorBackend();
  if (!backend) return empty;
  try {
    const rows = (await backend.list(kind, scope)).filter(isMirrorRow);
    if (rows.length === 0) return empty;
    const savedAt = rows.reduce<string | null>(
      (latest, row) => (latest === null || row.savedAt > latest ? row.savedAt : latest),
      null,
    );
    return { rows: rows.map((row) => row.data as unknown as T), savedAt };
  } catch {
    return empty;
  }
}

/** Insert or replace one mirrored row. False when there is no backend or the write failed. */
export async function upsertHistoryMirrorRow(
  kind: MirrorKind,
  scope: string,
  row: { id: string; data: Record<string, unknown> },
): Promise<boolean> {
  const backend = getHistoryMirrorBackend();
  if (!backend) return false;
  try {
    await backend.upsert(kind, scope, row);
    return true;
  } catch {
    return false;
  }
}

/**
 * Land one confirmed sale in the history mirror immediately (Slice S3's
 * `afterSaleConfirmed` path). The confirmed row + its items come from
 * the RPC result — the full server rows (`sales_atomic_result` returns
 * `to_jsonb` of both) — so the desktop history stays correct even if
 * the app quits before the refetch runs. The provisional number rides
 * along on the stored copy (the server link writes the same value to
 * the cloud row); the next live fetch replaces the snapshot with the
 * authoritative rows. Never throws: a failed upsert is healed by the
 * next fetch.
 */
export async function upsertConfirmedSaleMirror(
  scope: string,
  attempt: PendingSale,
  result: AtomicSaleResult,
): Promise<void> {
  const backend = getHistoryMirrorBackend();
  if (!backend) return;
  try {
    const transaction = result.transaction as Record<string, unknown>;
    const serverId = typeof transaction.id === "string" ? transaction.id : "";
    if (!serverId) return;
    const row: Record<string, unknown> = { ...transaction };
    if (attempt.provisionalNumber) {
      row.provisional_receipt_number = attempt.provisionalNumber;
    }
    await backend.upsert("sales_transaction", scope, { id: serverId, data: row });
    const items = Array.isArray(result.items) ? result.items : [];
    for (const item of items) {
      const record = item as Record<string, unknown>;
      const itemId = typeof record.id === "string" ? record.id : String(record.id ?? "");
      if (!itemId) continue;
      await backend.upsert("sales_item", scope, { id: itemId, data: record });
    }
  } catch {
    /* Mirror is a cache; the next fetch heals it. */
  }
}
