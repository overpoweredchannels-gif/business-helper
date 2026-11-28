import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryWriterRawData } from "@/lib/brain/contracts/memory";
import { allPages } from "@/lib/supabase/all-pages";
import type { PurchaseTransaction, SalesOrder, SalesReturn, SalesReturnItem, SalesTransaction } from "@/lib/tradeos/types";

export function salesCreatorFilter(actor: { id?: string; role?: string | null } | null, fallbackId?: string): string | null {
  if (actor?.role === "owner" || actor?.role === "admin") return null;
  return actor?.id ?? fallbackId ?? "00000000-0000-0000-0000-000000000000";
}

export function salesTransactionsQuery(db: SupabaseClient, org: string, creator: string | null) {
  const query = db.from("sales_transactions")
    .select("id, customer_id, invoice_number, created_at, sale_date, payment_type, credit_due_date, credit_limit_snapshot, credit_days_snapshot, total_amount, status, invoice_type, created_by_profile_id, discount_amount, tax_rate, tax_amount, cash_received, change_due, notes, request_id, provisional_receipt_number")
    .eq("organization_id", org)
    .order("created_at", { ascending: false });
  return creator === null ? query : query.eq("created_by_profile_id", creator);
}

export function salesItemsQuery(db: SupabaseClient, org: string, creator: string | null) {
  const query = db.from("sales_items")
    .select("id, sales_transaction_id, product_id, quantity, selling_price, purchase_price_snapshot, discount, unit_mode, sales_transactions!inner(created_by_profile_id)")
    .eq("organization_id", org)
    .order("id", { ascending: true });
  return creator === null ? query : query.eq("sales_transactions.created_by_profile_id", creator);
}

export function salesOrdersQuery(db: SupabaseClient, org: string, creator: string | null) {
  const query = db.from("sales_orders")
    .select("id, organization_id, so_number, customer_id, order_date, expected_date, notes, status, payment_type, credit_days, invoice_discount, invoice_discount_type, tax_rate, cash_received, created_by_profile_id, created_at, updated_at")
    .eq("organization_id", org)
    .order("created_at", { ascending: false });
  return creator === null ? query : query.eq("created_by_profile_id", creator);
}

const returnFields = "id, organization_id, return_number, customer_id, sales_transaction_id, return_date, reason, status, created_by_profile_id, created_at, updated_at, request_key";
const ownReturnFields = `${returnFields}, sales_transactions!inner(created_by_profile_id, organization_id)` as const;

export function salesReturnsQuery(db: SupabaseClient, org: string, creator: string | null) {
  if (creator === null) {
    return db.from("sales_returns").select(returnFields).eq("organization_id", org).order("created_at", { ascending: false });
  }
  return db.from("sales_returns").select(ownReturnFields)
    .eq("organization_id", org).eq("created_by_profile_id", creator)
    .eq("sales_transactions.created_by_profile_id", creator).eq("sales_transactions.organization_id", org)
    .order("created_at", { ascending: false });
}

async function readPages<T>(query: () => {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}): Promise<T[]> {
  const { data, error } = await allPages((from, to) => query().range(from, to));
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type DashboardSalesData = {
  salesTransactions: SalesTransaction[];
  salesItems: MemoryWriterRawData["salesItems"];
  salesOrders: SalesOrder[];
  salesReturns: SalesReturn[];
  salesReturnItems: SalesReturnItem[];
  customerPayments: NonNullable<MemoryWriterRawData["customerPayments"]>;
  customerPaymentAllocations: NonNullable<MemoryWriterRawData["customerPaymentAllocations"]>;
  purchaseTransactions: PurchaseTransaction[];
};

// Called only by the dashboard after the per-person grant is resolved.
// Keep these rows out of the shared history, accounting and AI state.
export async function readGrantedDashboardSales(db: SupabaseClient, org: string, signal: AbortSignal): Promise<DashboardSalesData> {
  const [salesTransactions, salesItems, salesOrders, salesReturns, salesReturnItems, customerPayments, customerPaymentAllocations, purchaseTransactions] = await Promise.all([
    readPages(() => salesTransactionsQuery(db, org, null).order("id").abortSignal(signal)),
    readPages(() => salesItemsQuery(db, org, null).abortSignal(signal)),
    readPages(() => salesOrdersQuery(db, org, null).order("id").abortSignal(signal)),
    readPages(() => salesReturnsQuery(db, org, null).order("id").abortSignal(signal)),
    readPages(() => db.from("sales_return_items")
      .select("id, sales_return_id, product_id, quantity, unit_price, discount, unit_mode, batch_number, expiry_date, created_at, sales_returns!inner(organization_id)")
      .eq("sales_returns.organization_id", org).order("id").abortSignal(signal)),
    readPages(() => db.from("customer_payments").select("id, customer_id, amount, created_at, payment_date, payment_method, voided_at")
      .eq("organization_id", org).order("id").abortSignal(signal)),
    readPages(() => db.from("customer_payment_allocations").select("customer_payment_id, sales_transaction_id, amount")
      .eq("organization_id", org).order("id").abortSignal(signal)),
    readPages(() => db.from("purchase_transactions")
      .select("id, organization_id, supplier_id, invoice_number, created_at, purchase_date, payment_type, total_amount, expense_review_status, expense_reviewed_at")
      .eq("organization_id", org).order("id").abortSignal(signal)),
  ]);
  return { salesTransactions, salesItems, salesOrders, salesReturns, salesReturnItems, customerPayments, customerPaymentAllocations, purchaseTransactions };
}
