// TradeOS ERP V2 — Sprint 1: Invoice Management Foundation
//
// Sales & Purchase ledger query builders: invoice number search (full or
// partial, Part 2) plus universal filters (Part 3). Pure query-building
// helpers are exported separately from the Supabase-calling functions so
// they can be unit tested without a database.

import { SupabaseClient } from "@supabase/supabase-js";
import type {
  LedgerQueryResult,
  PurchaseLedgerEntry,
  PurchaseLedgerFilters,
  SalesLedgerEntry,
  SalesLedgerFilters,
} from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const SALES_LEDGER_COLUMNS =
  "id, organization_id, customer_id, invoice_number, sale_date, payment_type, total_amount, status, invoice_type, created_by_profile_id, created_at";

const PURCHASE_LEDGER_COLUMNS =
  "id, organization_id, supplier_id, invoice_number, purchase_date, payment_type, total_amount, status, invoice_type, created_by_profile_id, supplier_invoice_number, created_at";

/**
 * Escapes ILIKE wildcard characters in user input so a search term like
 * "50%" or "a_b" is treated literally rather than as a SQL wildcard pattern.
 */
export function escapeIlikeTerm(term: string): string {
  return term.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

/** Trims and normalizes a raw search query param; returns null if empty. */
export function normalizeInvoiceSearchTerm(term: string | null | undefined): string | null {
  if (term === null || term === undefined) return null;
  const trimmed = String(term).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Builds the ILIKE pattern used to match both full invoice numbers
 * ("SAL-000125") and partial/numeric fragments ("125") against the stored
 * invoice_number column. A simple "contains" search satisfies both cases
 * because the zero-padded sequence always contains the bare digits typed by
 * the user (e.g. "000125" contains "125").
 */
export function buildInvoiceSearchPattern(term: string): string {
  return `%${escapeIlikeTerm(term)}%`;
}

export function clampLimit(limit?: number | null): number {
  if (limit === undefined || limit === null || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.trunc(limit), MAX_LIMIT);
}

export function clampOffset(offset?: number | null): number {
  if (offset === undefined || offset === null || !Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return Math.trunc(offset);
}

export async function querySalesLedger(
  supabase: SupabaseClient,
  filters: SalesLedgerFilters
): Promise<LedgerQueryResult<SalesLedgerEntry>> {
  if (!filters.organizationId) {
    throw new Error("querySalesLedger: organizationId is required");
  }

  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  let query = supabase
    .from("sales_transactions")
    .select(SALES_LEDGER_COLUMNS, { count: "exact" })
    .eq("organization_id", filters.organizationId);

  const search = normalizeInvoiceSearchTerm(filters.search);
  if (search) {
    query = query.ilike("invoice_number", buildInvoiceSearchPattern(search));
  }
  if (filters.dateFrom) query = query.gte("sale_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("sale_date", filters.dateTo);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);
  if (filters.salesmanProfileId) query = query.eq("created_by_profile_id", filters.salesmanProfileId);
  if (filters.paymentType) query = query.eq("payment_type", filters.paymentType);
  if (filters.status) query = query.eq("status", filters.status);

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`querySalesLedger: ${error.message}`);
  }

  return {
    entries: (data ?? []) as unknown as SalesLedgerEntry[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function queryPurchaseLedger(
  supabase: SupabaseClient,
  filters: PurchaseLedgerFilters
): Promise<LedgerQueryResult<PurchaseLedgerEntry>> {
  if (!filters.organizationId) {
    throw new Error("queryPurchaseLedger: organizationId is required");
  }

  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  let query = supabase
    .from("purchase_transactions")
    .select(PURCHASE_LEDGER_COLUMNS, { count: "exact" })
    .eq("organization_id", filters.organizationId);

  const search = normalizeInvoiceSearchTerm(filters.search);
  if (search) {
    query = query.ilike("invoice_number", buildInvoiceSearchPattern(search));
  }
  if (filters.dateFrom) query = query.gte("purchase_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("purchase_date", filters.dateTo);
  if (filters.supplierId) query = query.eq("supplier_id", filters.supplierId);
  if (filters.status) query = query.eq("status", filters.status);

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`queryPurchaseLedger: ${error.message}`);
  }

  return {
    entries: (data ?? []) as unknown as PurchaseLedgerEntry[],
    total: count ?? 0,
    limit,
    offset,
  };
}
