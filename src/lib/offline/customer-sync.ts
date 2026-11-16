/**
 * Slice S5 — customer sync (Offline Tier-1).
 *
 * Offline-created / offline-edited customers sync FIRST in the
 * engine's order (design §4: customers are parents — sales reference
 * them). The dedup key is the row `id` itself: a client-generated
 * UUID for a create (the server keeps it as the row id), the server
 * id for an edit. Retrying the same insert with the same `id`
 * returns the existing row instead of a duplicate.
 *
 * Last-write-wins (UMAIR's decision 5): the profile (name / phone /
 * address / policy / …) is decided by `updated_at` — the server
 * keeps the newer copy. The balance is NEVER part of the write: it
 * is always calculated from ledger transactions, so a profile sync
 * can never overwrite a balance.
 *
 * - Create: status-check first (does the id already exist?). If it
 *   does, the payloads are compared: identical → confirmed; the
 *   local copy newer → PUT to reconcile; the server copy newer →
 *   parked as a `customer-conflict` issue (never auto-retried, never
 *   auto-deleted). A lost POST response is the same path: the
 *   existence check finds the row and reconciles.
 * - Edit: PUT with the local `updated_at`. The route applies the
 *   guard (server `updated_at` is the tiebreak) and answers
 *   `superseded: true` when the server copy is newer — the edit is
 *   then parked as a conflict instead of silently losing.
 * - A network failure or 5xx leaves the row queued; the next trigger
 *   retries. A definitive 4xx (validation) parks the row as
 *   `rejected` with the server message.
 * - Owner Retry (from Sync issues) re-applies the parked copy with a
 *   fresh timestamp and `force: true` — the owner's explicit decision
 *   that this copy wins — and resolves the issue on success.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import {
  getLocalCustomersBackend,
  isPendingLocalCustomer,
  notifyLocalCustomersChanged,
  type LocalCustomerRow,
} from "@/lib/offline/local-customers";
import {
  getSyncIssuesBackend,
  notifySyncIssuesChanged,
  type SyncIssue,
  type SyncIssueKind,
} from "@/lib/offline/sync-issues";

/** Profile fields compared between the local row and the server row. */
const PROFILE_FIELDS = [
  "customer_name",
  "shop_name",
  "organization_name",
  "contact_person",
  "phone",
  "whatsapp",
  "city",
  "area",
  "address",
  "shipping_address",
  "customer_type",
  "notes",
  "credit_policy",
  "credit_limit",
  "credit_days",
  "allow_over_limit",
  "allow_overdue_sales",
  "preferred_payment_method",
  "assigned_salesman_id",
  "assigned_territory_id",
  "visit_frequency",
  "priority",
  "latitude",
  "longitude",
] as const;

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

/** The server side of the customer sync: one existence check. */
export interface CustomerServer {
  /** The customer row for an id, or null when there is none. */
  fetchById(id: string): Promise<Record<string, unknown> | null>;
}

const CUSTOMER_SERVER_COLUMNS =
  "id, customer_name, shop_name, organization_name, contact_person, phone, whatsapp, city, area, address, shipping_address, customer_type, notes, credit_policy, credit_limit, credit_days, allow_over_limit, allow_overdue_sales, preferred_payment_method, assigned_salesman_id, assigned_territory_id, visit_frequency, priority, latitude, longitude, updated_at";

/** The real server check: a direct select (RLS-scoped to the caller's org). */
export function createCustomerServer(supabase: SupabaseClient): CustomerServer {
  return {
    async fetchById(id: string): Promise<Record<string, unknown> | null> {
      const { data, error } = await supabase
        .from("customers")
        .select(CUSTOMER_SERVER_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data as Record<string, unknown> | null) ?? null;
    },
  };
}

function normalizeProfileValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function profileDiffers(local: Record<string, unknown>, server: Record<string, unknown>): boolean {
  return PROFILE_FIELDS.some(
    (field) => normalizeProfileValue(local[field]) !== normalizeProfileValue(server[field]),
  );
}

function customerDisplayName(row: LocalCustomerRow): string {
  const name = row.data.customer_name;
  return typeof name === "string" && name.length > 0 ? name : "Customer";
}

/** POST body for a create: the Quick-Add fields plus the client id. */
function buildCreateBody(row: LocalCustomerRow): Record<string, unknown> {
  const data = row.data;
  return {
    id: row.id,
    customer_name: data.customer_name,
    phone: data.phone ?? null,
    address: data.address ?? null,
    preferred_payment_method: data.preferred_payment_method ?? null,
    credit_policy: data.credit_policy ?? "cash_only",
    shop_name: data.shop_name ?? null,
    organization_name: data.organization_name ?? null,
    contact_person: data.contact_person ?? null,
    whatsapp: data.whatsapp ?? null,
    city: data.city ?? null,
    area: data.area ?? null,
    shipping_address: data.shipping_address ?? null,
    customer_type: data.customer_type ?? "Retailer",
    notes: data.notes ?? null,
    credit_limit: data.credit_limit ?? null,
    credit_days: data.credit_days ?? null,
    allow_over_limit: data.allow_over_limit === true,
    allow_overdue_sales: data.allow_overdue_sales === true,
  };
}

/** PUT body for an edit: the full profile plus the last-write-wins stamp. */
function buildEditBody(row: LocalCustomerRow, force: boolean): Record<string, unknown> {
  const data = row.data;
  const body: Record<string, unknown> = { updated_at: row.updatedAt };
  if (force) body.force = true;
  for (const field of PROFILE_FIELDS) {
    if (data[field] !== undefined) body[field] = data[field];
  }
  return body;
}

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Park a customer problem in Sync issues. Returns the stored issue,
 * or null when the store write failed — the caller then leaves the
 * row queued so the customer still surfaces instead of vanishing.
 */
export async function parkCustomerAsSyncIssue(
  scope: string,
  row: LocalCustomerRow,
  kind: Extract<SyncIssueKind, "customer-conflict" | "rejected">,
  reason: string,
): Promise<SyncIssue | null> {
  const now = new Date().toISOString();
  const issue: SyncIssue = {
    id: crypto.randomUUID(),
    scope,
    kind,
    requestId: row.idempotencyKey,
    provisionalNumber: null,
    serverInvoiceNumber: null,
    serverId: row.serverId,
    customerName: customerDisplayName(row),
    total: null,
    reason,
    payload: null,
    status: "open",
    syncError: null,
    createdAt: now,
    updatedAt: now,
    customerId: row.id,
    supplierId: null,
    purchaseId: null,
  };
  try {
    const stored = await getSyncIssuesBackend().upsert(scope, issue);
    notifySyncIssuesChanged();
    return stored;
  } catch {
    return null;
  }
}

export type CustomerSyncOutcome = "synced" | "parked" | "queued";

export interface CustomerSyncOptions {
  fetchImpl?: FetchImpl;
  server?: CustomerServer;
}

/**
 * Sync one pending local customer row. Never throws: a network failure
 * or 5xx leaves the row queued (`queued`), a definitive rejection
 * parks it (`parked`), a confirmed row is removed from the local
 * store (`synced`).
 */
export async function syncOneCustomer(
  supabase: SupabaseClient,
  scope: string,
  row: LocalCustomerRow,
  options: CustomerSyncOptions = {},
): Promise<CustomerSyncOutcome> {
  const fetchImpl = options.fetchImpl ?? authorizedFetch;
  const server = options.server ?? createCustomerServer(supabase);
  const backend = getLocalCustomersBackend();

  const markRejected = async (reason: string): Promise<CustomerSyncOutcome> => {
    try {
      await backend.upsert(scope, { ...row, syncStatus: "rejected", syncError: reason });
    } catch {
      /* The park below is the visible record; the row stays pending. */
    }
    return "parked";
  };

  const removeRow = async (): Promise<void> => {
    try {
      await backend.remove(scope, row.id);
    } catch {
      /* A leftover row replays harmlessly (same id → existing row). */
    }
    // A row that confirms after its issue was parked resolves the
    // issue (e.g. the owner edited the parked customer and the next
    // drain synced it) — the panel must not keep showing it.
    try {
      const issues = await getSyncIssuesBackend().list(scope);
      const open = issues.find(
        (item) =>
          item.status === "open" &&
          item.customerId === row.id,
      );
      if (open) {
        await getSyncIssuesBackend().setStatus(scope, open.id, "resolved");
        notifySyncIssuesChanged();
      }
    } catch {
      /* The row is synced; a stale issue row is healed on next refresh. */
    }
  };

  const reconcileWithServer = async (
    serverRow: Record<string, unknown>,
  ): Promise<CustomerSyncOutcome> => {
    // The server already holds this id. Same profile → confirmed.
    if (!profileDiffers(row.data, serverRow)) {
      await removeRow();
      return "synced";
    }
    const serverUpdatedAt = typeof serverRow.updated_at === "string" ? serverRow.updated_at : "";
    // The local copy is newer (or the server has no stamp) → PUT it.
    if (!serverUpdatedAt || row.updatedAt >= serverUpdatedAt) {
      const response = await fetchImpl(`/api/customers/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEditBody(row, false)),
      });
      const result = await readJsonBody(response);
      if (response.ok && result.ok) {
        if (result.superseded === true) {
          await markRejected(
            `Another device saved a newer copy of ${customerDisplayName(row)} first. Your offline copy is parked here — Retry applies your copy.`,
          );
          await parkCustomerAsSyncIssue(
            scope,
            row,
            "customer-conflict",
            `Another device saved a newer copy of ${customerDisplayName(row)} first. Your offline copy is parked here — Retry applies your copy.`,
          );
          return "parked";
        }
        await removeRow();
        return "synced";
      }
      if (response.status >= 500) return "queued";
      await markRejected(String(result.error ?? `Customer ${customerDisplayName(row)} was rejected by the server.`));
      await parkCustomerAsSyncIssue(
        scope,
        row,
        "rejected",
        String(result.error ?? `Customer ${customerDisplayName(row)} was rejected by the server.`),
      );
      return "parked";
    }
    // The server copy is newer — last-write-wins keeps it; the local
    // edit is parked for the owner, never silently dropped.
    await markRejected(
      `Another device saved a newer copy of ${customerDisplayName(row)} first. Your offline copy is parked here — Retry applies your copy.`,
    );
    await parkCustomerAsSyncIssue(
      scope,
      row,
      "customer-conflict",
      `Another device saved a newer copy of ${customerDisplayName(row)} first. Your offline copy is parked here — Retry applies your copy.`,
    );
    return "parked";
  };

  try {
    if (row.kind === "create") {
      // Status-check first: a lost POST response still leaves the row
      // on the server, and re-posting the same id returns it.
      let existing: Record<string, unknown> | null;
      try {
        existing = await server.fetchById(row.id);
      } catch {
        return "queued";
      }
      if (existing) return reconcileWithServer(existing);
      let response: Response;
      try {
        response = await fetchImpl("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildCreateBody(row)),
        });
      } catch {
        // A failed send leaves the row queued; the next trigger retries.
        return "queued";
      }
      const result = await readJsonBody(response);
      if (response.ok && result.ok) {
        await removeRow();
        return "synced";
      }
      if (response.status >= 500) return "queued";
      if (response.status === 400) {
        // A duplicate-key 400 means the row landed after all (a lost
        // response, or another counter's insert): re-check, then
        // reconcile instead of parking a row that already exists.
        let after: Record<string, unknown> | null = null;
        try {
          after = await server.fetchById(row.id);
        } catch {
          return "queued";
        }
        if (after) return reconcileWithServer(after);
      }
      if (response.status === 401 || response.status === 403) return "queued";
      await markRejected(String(result.error ?? `Customer ${customerDisplayName(row)} was rejected by the server.`));
      await parkCustomerAsSyncIssue(
        scope,
        row,
        "rejected",
        String(result.error ?? `Customer ${customerDisplayName(row)} was rejected by the server.`),
      );
      return "parked";
    }

    // Edit: PUT with the local updated_at; the route guards on it.
    let response: Response;
    try {
      response = await fetchImpl(`/api/customers/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEditBody(row, false)),
      });
    } catch {
      return "queued";
    }
    const result = await readJsonBody(response);
    if (response.ok && result.ok) {
      if (result.superseded === true) {
        await markRejected(
          `Another device saved a newer copy of ${customerDisplayName(row)} first. Your offline copy is parked here — Retry applies your copy.`,
        );
        await parkCustomerAsSyncIssue(
          scope,
          row,
          "customer-conflict",
          `Another device saved a newer copy of ${customerDisplayName(row)} first. Your offline copy is parked here — Retry applies your copy.`,
        );
        return "parked";
      }
      await removeRow();
      return "synced";
    }
    if (response.status >= 500 || response.status === 401 || response.status === 403) return "queued";
    await markRejected(String(result.error ?? `Customer ${customerDisplayName(row)} was rejected by the server.`));
    await parkCustomerAsSyncIssue(
      scope,
      row,
      "rejected",
      String(result.error ?? `Customer ${customerDisplayName(row)} was rejected by the server.`),
    );
    return "parked";
  } catch {
    // Any unexpected failure leaves the row queued; the next trigger retries.
    return "queued";
  }
}

export interface CustomerDrainResult {
  confirmedCount: number;
  parkedCount: number;
  queuedCount: number;
  /** True when a network failure stopped the loop early. */
  stoppedEarly: boolean;
}

/**
 * Drain all pending local customers for a scope, oldest first. A
 * network failure stops the loop (the rest wait for the next trigger)
 * — a sale referencing an unsynced customer must not sync ahead of
 * it. Never throws.
 */
export async function drainPendingCustomers(
  supabase: SupabaseClient,
  scope: string,
  options: CustomerSyncOptions = {},
): Promise<CustomerDrainResult> {
  const result: CustomerDrainResult = {
    confirmedCount: 0,
    parkedCount: 0,
    queuedCount: 0,
    stoppedEarly: false,
  };
  let rows: LocalCustomerRow[];
  try {
    rows = (await getLocalCustomersBackend().list(scope)).filter(isPendingLocalCustomer);
  } catch {
    return result;
  }
  let changed = false;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const outcome = await syncOneCustomer(supabase, scope, row, options);
    if (outcome === "synced") {
      result.confirmedCount += 1;
      changed = true;
    } else if (outcome === "parked") {
      result.parkedCount += 1;
      changed = true;
    } else {
      // A network failure mid-loop: this row and the rest keep their
      // order for the next trigger instead of failing one by one.
      result.queuedCount += rows.length - index;
      result.stoppedEarly = true;
      break;
    }
  }
  if (changed) notifyLocalCustomersChanged();
  return result;
}

/**
 * Owner Retry of one parked customer issue. Re-applies the parked
 * copy with a fresh timestamp and `force: true` — the owner's
 * explicit decision that this copy wins — and resolves the issue on
 * success. A row that already synced elsewhere resolves the issue
 * without a write.
 */
export async function retryCustomerSyncIssue(
  supabase: SupabaseClient,
  scope: string,
  issueId: string,
  options: CustomerSyncOptions = {},
): Promise<{ confirmed: boolean; notRetryable: boolean; reason: string | null }> {
  const backend = getLocalCustomersBackend();
  const issuesBackend = getSyncIssuesBackend();
  const issues = await issuesBackend.list(scope);
  const issue = issues.find((item) => item.id === issueId);
  if (!issue || issue.status !== "open" || !issue.customerId) {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  const rows = await backend.list(scope);
  const row = rows.find((item) => item.id === issue.customerId);
  if (!row) {
    // The row already synced (or was discarded): the issue is done.
    await issuesBackend.setStatus(scope, issue.id, "resolved");
    notifySyncIssuesChanged();
    return { confirmed: true, notRetryable: false, reason: null };
  }
  if (!isPendingLocalCustomer(row) && row.syncStatus !== "rejected") {
    return { confirmed: false, notRetryable: true, reason: null };
  }
  const fetchImpl = options.fetchImpl ?? authorizedFetch;
  const server = options.server ?? createCustomerServer(supabase);
  // Fresh timestamp + force: this copy is now the newest write by the
  // owner's explicit decision.
  const refreshed: LocalCustomerRow = {
    ...row,
    syncStatus: "pending",
    syncError: null,
    updatedAt: new Date().toISOString(),
  };
  try {
    await backend.upsert(scope, refreshed);
  } catch {
    return { confirmed: false, notRetryable: false, reason: "The customer could not be saved on this device." };
  }
  let response: Response;
  try {
    if (row.kind === "create") {
      const existing = await server.fetchById(row.id);
      if (!existing) {
        response = await fetchImpl("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildCreateBody(refreshed)),
        });
      } else {
        response = await fetchImpl(`/api/customers/${row.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildEditBody(refreshed, true)),
        });
      }
    } else {
      response = await fetchImpl(`/api/customers/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEditBody(refreshed, true)),
      });
    }
  } catch {
    return { confirmed: false, notRetryable: false, reason: null };
  }
  const result = await readJsonBody(response);
  if (response.ok && result.ok) {
    await backend.remove(scope, row.id);
    await issuesBackend.setStatus(scope, issue.id, "resolved");
    notifySyncIssuesChanged();
    notifyLocalCustomersChanged();
    return { confirmed: true, notRetryable: false, reason: null };
  }
  if (response.status >= 500 || response.status === 401 || response.status === 403) {
    return { confirmed: false, notRetryable: false, reason: null };
  }
  return {
    confirmed: false,
    notRetryable: false,
    reason: String(result.error ?? "The customer was rejected by the server."),
  };
}
