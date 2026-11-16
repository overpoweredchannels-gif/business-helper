/**
 * Slice S2 — local store seam (Offline Tier-1).
 *
 * One queue implementation, two backends. The sale queue (`createAtomicSale`
 * / `drainPendingSalesQueue` in `src/lib/sales/atomic-sale-client.ts`) reads
 * and writes through a `SaleQueueBackend`:
 *
 * - Web build: `LocalStorageSaleQueueBackend` — the historical
 *   `tradeos:pending-sales-queue:v1:${scope}` key, unchanged behaviour
 *   (including the one-time migration from the old single slot).
 * - Desktop build (`NEXT_PUBLIC_DESKTOP=1` or the `window.aankhDesktop`
 *   bridge): `DesktopSaleQueueBackend` — the same queue in SQLite, owned
 *   by the Electron main process (`electron/store.ts`) and reached over
 *   IPC. A sale saved offline lands on the hard drive, survives a
 *   browser-cache clear, a restart and an app update.
 *
 * Fallback discipline: if an IPC call fails (store not open, bridge
 * absent), the desktop backend falls back to localStorage for that call
 * so the sale is never lost. A sale can then briefly exist in both
 * stores — that is safe, because the server dedupes by `request_id`
 * (same key + same payload replays the original invoice, never a
 * duplicate). The queue-changed event fires after every mutation in
 * either backend, so the pending-count UI stays correct.
 */

import { isDesktopApp } from "@/lib/offline/identity-cache";
import type { PendingSale } from "@/lib/sales/atomic-sale-client";

/** Ordered queue, oldest first. Scope is `${organizationId}:${profileId}`. */
export const QUEUE_CHANGED_EVENT = "tradeos:pending-sales-changed";

export function notifyQueueChanged(): void {
  try {
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
  } catch {
    /* Non-browser or closed window: the next read still sees the queue. */
  }
}

export interface SaleQueueBackend {
  /** Queued sales for a scope, oldest first. */
  list(scope: string): Promise<PendingSale[]>;
  /**
   * Replace the whole queue for a scope. Returns the stored rows — on
   * desktop with `provisionalNumber` allocated (`L-000123`).
   */
  replace(scope: string, queue: PendingSale[]): Promise<PendingSale[]>;
  /** Delete one queued sale. */
  remove(scope: string, requestId: string): Promise<void>;
}

const queueStorageKey = (scope: string) => `tradeos:pending-sales-queue:v1:${scope}`;
const legacyStorageKey = (scope: string) => `tradeos:pending-sale:v1:${scope}`;

function parseQueue(raw: string | null): PendingSale[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PendingSale =>
        !!item &&
        typeof (item as PendingSale).requestId === "string" &&
        !!(item as PendingSale).input &&
        typeof (item as PendingSale).input === "object",
    );
  } catch {
    return [];
  }
}

/** Web build: the historical localStorage queue, behaviour unchanged. */
export class LocalStorageSaleQueueBackend implements SaleQueueBackend {
  async list(scope: string): Promise<PendingSale[]> {
    if (typeof window === "undefined") return [];
    let queue = parseQueue(window.localStorage.getItem(queueStorageKey(scope)));
    // One-time migration from the old single slot: it is the oldest sale.
    const legacy = window.localStorage.getItem(legacyStorageKey(scope));
    if (legacy) {
      try {
        const old = JSON.parse(legacy) as PendingSale;
        if (old?.requestId && old.input && !queue.some((item) => item.requestId === old.requestId)) {
          queue = [old, ...queue];
        }
      } catch {
        /* A corrupt legacy slot is dropped with the key below. */
      }
      window.localStorage.removeItem(legacyStorageKey(scope));
      this.writeRaw(scope, queue);
    }
    return queue;
  }

  async replace(scope: string, queue: PendingSale[]): Promise<PendingSale[]> {
    this.writeRaw(scope, queue);
    return queue;
  }

  async remove(scope: string, requestId: string): Promise<void> {
    const queue = await this.list(scope);
    this.writeRaw(
      scope,
      queue.filter((item) => item.requestId !== requestId),
    );
  }

  private writeRaw(scope: string, queue: PendingSale[]): void {
    try {
      if (queue.length === 0) window.localStorage.removeItem(queueStorageKey(scope));
      else window.localStorage.setItem(queueStorageKey(scope), JSON.stringify(queue));
    } catch {
      /* Storage full or blocked: the caller's in-memory copy still holds the attempt. */
    }
  }
}

/** One queued sale as it crosses the IPC bridge (plain JSON). */
export interface LocalSaleIpcRow {
  requestId: string;
  input: Record<string, unknown>;
  provisionalNumber: string | null;
  /** Slice S4: when the sale was first queued (ISO timestamp), or null. */
  createdAt: string | null;
}

type DesktopLocalSalesBridge = {
  list(scope: string): Promise<LocalSaleIpcRow[]>;
  replace(scope: string, rows: LocalSaleIpcRow[]): Promise<LocalSaleIpcRow[]>;
  remove(scope: string, requestId: string): Promise<void>;
};

/** The preload bridge's local-sales methods, or null outside the desktop shell. */
export function desktopLocalSalesBridge(): DesktopLocalSalesBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { aankhDesktop?: { localSales?: DesktopLocalSalesBridge } })
    .aankhDesktop;
  return bridge?.localSales ?? null;
}

function toIpcRow(sale: PendingSale): LocalSaleIpcRow {
  return {
    requestId: sale.requestId,
    input: sale.input as unknown as Record<string, unknown>,
    provisionalNumber: sale.provisionalNumber ?? null,
    createdAt: sale.createdAt ?? null,
  };
}

function fromIpcRow(row: LocalSaleIpcRow): PendingSale {
  return {
    requestId: row.requestId,
    input: row.input as unknown as PendingSale["input"],
    provisionalNumber: row.provisionalNumber ?? undefined,
    createdAt: row.createdAt ?? undefined,
  };
}

/**
 * Desktop build: the SQLite queue over IPC, with a localStorage fallback
 * per call so a store failure never loses a sale (see the module header
 * for why a sale briefly living in both stores is safe).
 */
export class DesktopSaleQueueBackend implements SaleQueueBackend {
  private readonly fallback = new LocalStorageSaleQueueBackend();

  async list(scope: string): Promise<PendingSale[]> {
    const bridge = desktopLocalSalesBridge();
    if (!bridge) return this.fallback.list(scope);
    try {
      return (await bridge.list(scope)).map(fromIpcRow);
    } catch {
      return this.fallback.list(scope);
    }
  }

  async replace(scope: string, queue: PendingSale[]): Promise<PendingSale[]> {
    const bridge = desktopLocalSalesBridge();
    if (!bridge) return this.fallback.replace(scope, queue);
    try {
      return (await bridge.replace(scope, queue.map(toIpcRow))).map(fromIpcRow);
    } catch {
      return this.fallback.replace(scope, queue);
    }
  }

  async remove(scope: string, requestId: string): Promise<void> {
    const bridge = desktopLocalSalesBridge();
    if (!bridge) return this.fallback.remove(scope, requestId);
    try {
      await bridge.remove(scope, requestId);
    } catch {
      await this.fallback.remove(scope, requestId);
    }
  }
}

/** The queue backend for this build: SQLite on desktop, localStorage on web. */
export function getSaleQueueBackend(): SaleQueueBackend {
  if (isDesktopApp() && desktopLocalSalesBridge()) return new DesktopSaleQueueBackend();
  return new LocalStorageSaleQueueBackend();
}
