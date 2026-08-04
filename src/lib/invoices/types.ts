// TradeOS ERP V2 — Sprint 1: Invoice Management Foundation
// Shared types for invoice numbering, metadata, and ledger search/filters.
// These types are additive — they do not replace or modify the AI Operating
// System, Business Brain, Identity, or Conversation Gateway types.

/**
 * The invoice families the numbering engine must support today, and be ready
 * to support tomorrow. Sales Return / Purchase Return had no CRUD module when
 * the engine was first built (Part 1's "future-proof the numbering engine");
 * Purchase Management Phase 1 adds Purchase Orders to the same engine.
 */
export type InvoiceType = "sales" | "purchase" | "sales_return" | "purchase_return" | "purchase_order" | "sales_order";

/**
 * Invoice lifecycle status. Defaults to "confirmed" for backward
 * compatibility with existing sales/purchase creation behavior (invoices are
 * finalized immediately today). The remaining values prepare for the future
 * approval workflow mentioned in Part 4 without implementing it here.
 */
export type InvoiceStatus =
  | "draft"
  | "pending_approval"
  | "confirmed"
  | "paid"
  | "partially_paid"
  | "cancelled"
  | "void";

export const INVOICE_STATUSES: InvoiceStatus[] = [
  "draft",
  "pending_approval",
  "confirmed",
  "paid",
  "partially_paid",
  "cancelled",
  "void",
];

/** Every invoice must permanently store this metadata (Part 4). */
export interface InvoiceMetadata {
  invoice_number: string;
  created_at: string;
  created_by: string | null;
  organization_id: string;
  status: InvoiceStatus;
  invoice_type: InvoiceType;
}

export interface LedgerFilters {
  organizationId: string;
  /** Full or partial invoice number, e.g. "SAL-000125" or "125". */
  search?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  status?: InvoiceStatus | string | null;
  limit?: number;
  offset?: number;
}

export interface SalesLedgerFilters extends LedgerFilters {
  customerId?: string | null;
  /** Profile id of the salesman who created the sale (created_by_profile_id). */
  salesmanProfileId?: string | null;
  paymentType?: string | null;
}

export interface PurchaseLedgerFilters extends LedgerFilters {
  supplierId?: string | null;
}

export interface SalesLedgerEntry {
  id: string;
  organization_id: string;
  customer_id: string;
  invoice_number: string;
  sale_date: string | null;
  payment_type: string | null;
  total_amount: number | null;
  status: string | null;
  invoice_type: string | null;
  created_by_profile_id: string | null;
  created_at: string;
}

export interface PurchaseLedgerEntry {
  id: string;
  organization_id: string;
  supplier_id: string;
  invoice_number: string;
  purchase_date: string | null;
  payment_type: string | null;
  total_amount: number | null;
  status: string | null;
  invoice_type: string | null;
  created_by_profile_id: string | null;
  supplier_invoice_number: string | null;
  created_at: string;
}

export interface LedgerQueryResult<T> {
  entries: T[];
  total: number;
  limit: number;
  offset: number;
}
