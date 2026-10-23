/**
 * Drawer event persistence — append-only audit log.
 *
 * Events live in the dedicated `drawer_events` table (see
 * Drawer_Events_Migration_2026-10-23.sql): the generic audit_logs trail
 * is an entity change log (old/new values for CRUD), not a typed event
 * stream, and the owner Drawer Activity report needs typed filters —
 * no-sale counts per cashier above all (the theft-detection view).
 *
 * The table arrives with an additive migration UMAIR runs. Until it
 * exists, inserts fail: the recorder then queues the event in a
 * per-organization localStorage outbox and retries on the next recorded
 * event, so pre-migration kicks are never lost silently — and recording
 * never throws, so it can never block or fail a sale.
 */
import type { DrawerEventRecord } from "./drawer";

export type { DrawerEventRecord } from "./drawer";

export const DRAWER_EVENTS_TABLE = "drawer_events";
export const DRAWER_OUTBOX_LIMIT = 200;

export function drawerOutboxStorageKey(organizationId: string): string {
  return `tradeos-drawer-outbox-v1:${organizationId}`;
}

type OutboxStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Minimal insert seam — the browser Supabase client's `from().insert()`
 * satisfies this structurally. */
export interface DrawerEventInsert {
  insert: (record: DrawerEventRecord) => Promise<{ error: unknown }>;
}

export function parseDrawerOutbox(raw: string | null): DrawerEventRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is DrawerEventRecord =>
        Boolean(row) && typeof row === "object" && typeof (row as DrawerEventRecord).event_type === "string",
    );
  } catch {
    return [];
  }
}

export function readDrawerOutbox(
  storage: OutboxStorage,
  organizationId: string,
): DrawerEventRecord[] {
  try {
    return parseDrawerOutbox(storage.getItem(drawerOutboxStorageKey(organizationId)));
  } catch {
    return [];
  }
}

function writeDrawerOutbox(
  storage: OutboxStorage,
  organizationId: string,
  rows: DrawerEventRecord[],
): void {
  try {
    storage.setItem(
      drawerOutboxStorageKey(organizationId),
      JSON.stringify(rows.slice(-DRAWER_OUTBOX_LIMIT)),
    );
  } catch {
    // Storage full/unavailable: the event still happened at the till;
    // losing the queued copy is the last resort, never an exception.
  }
}

/**
 * Try to flush queued events for one organization. Returns how many
 * rows remain queued. Stops at the first failure (the table is most
 * likely still missing) and never throws.
 */
export async function flushDrawerOutbox(
  insert: DrawerEventInsert,
  storage: OutboxStorage,
  organizationId: string,
): Promise<number> {
  const queued = readDrawerOutbox(storage, organizationId);
  if (!queued.length) return 0;
  const remaining: DrawerEventRecord[] = [];
  let blocked = false;
  for (const row of queued) {
    if (blocked) { remaining.push(row); continue; }
    try {
      const { error } = await insert.insert(row);
      if (error) { blocked = true; remaining.push(row); }
    } catch {
      blocked = true;
      remaining.push(row);
    }
  }
  writeDrawerOutbox(storage, organizationId, remaining);
  return remaining.length;
}

/**
 * Build the production recorder: insert into drawer_events; on any
 * failure, queue the event in the outbox (after one best-effort flush
 * of older queued events). Never throws.
 */
export function createDrawerEventRecorder(deps: {
  insert: DrawerEventInsert;
  storage: OutboxStorage;
}): (record: DrawerEventRecord) => Promise<void> {
  return async (record) => {
    await flushDrawerOutbox(deps.insert, deps.storage, record.organization_id);
    try {
      const { error } = await deps.insert.insert(record);
      if (!error) return;
    } catch {
      // fall through to the outbox
    }
    const queued = readDrawerOutbox(deps.storage, record.organization_id);
    writeDrawerOutbox(deps.storage, record.organization_id, [...queued, record]);
  };
}

export interface DrawerEventRow extends DrawerEventRecord {
  id?: string;
  created_at?: string;
  /** True for rows shown from the local outbox (not yet in the DB). */
  pending?: boolean;
}

/** Filters for the owner Drawer Activity report. */
export function filterDrawerEvents(
  rows: readonly DrawerEventRow[],
  filters: { eventType?: string | null; result?: string | null },
): DrawerEventRow[] {
  return rows.filter((row) => {
    if (filters.eventType && row.event_type !== filters.eventType) return false;
    if (filters.result && row.result !== filters.result) return false;
    return true;
  });
}

/** No-sale count for the exception view — test opens are setup
 * diagnostics and never count as no-sales (spec rule D.11). */
export function countNoSaleEvents(rows: readonly DrawerEventRow[]): number {
  return rows.filter((row) => row.event_type === "no-sale").length;
}
