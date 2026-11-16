/**
 * Slice S5 — credit balances offline (Offline Tier-1).
 *
 * The balance shown for a customer offline is ALWAYS derived from
 * ledger transactions — never a stored value, never a guess. This
 * module assembles the Single Source of Truth input
 * (`deriveCustomerOutstanding`, `src/lib/accounting/customer-balance.ts`:
 * outstanding = Credit Sales − Confirmed Returns − Non-Voided
 * Payments) from the local rows the desktop build holds:
 * - mirrored `sales_transactions` (S4 mirror; the live rows when online),
 * - pending queued credit sales (S2 queue; they owe their full total —
 *   they have no allocation row yet),
 * - mirrored `customer_payments` + `customer_payment_allocations`
 *   (voided payments and their allocations cover nothing),
 * - mirrored `sales_returns` + `sales_return_items` (confirmed only).
 *
 * The caller never writes a stored balance column anywhere: the
 * mirror stores rows as fetched, and this helper only reads them.
 * When the local ledger is incomplete (a mirror is empty because it
 * was never fetched), the derived figure is still shown — the page
 * labels it with the oldest mirror saved time (`ledgerMirrorSavedAt`,
 * recorded per mirror kind at fetch time), never as a live figure.
 */

import { deriveCustomerOutstanding, type CustomerBalanceLedgerInput } from "@/lib/accounting/customer-balance";
import { calculateSaleAmounts } from "@/lib/sales/sale-amounts";
import type { PendingSale } from "@/lib/sales/atomic-sale-client";

/**
 * One ledger row as the builder reads it. Structural (not Record):
 * the typed server rows (`SalesTransaction`, `SalesReturn`,
 * `SalesReturnItem`) and the untyped `any[]` payment states must all
 * be assignable without a cast — a typed row has no index signature,
 * so `Record<string, unknown>` rejects it. Every field is optional:
 * a mirror row or a fixture may omit any of them, and the builder
 * coerces defensively (`toNumber` / `toDateOnly` / typeof checks).
 */
export interface LedgerRow {
  id?: unknown;
  customer_id?: unknown;
  payment_type?: unknown;
  status?: unknown;
  sale_date?: unknown;
  created_at?: unknown;
  total_amount?: unknown;
  amount?: unknown;
  voided_at?: unknown;
  sales_transaction_id?: unknown;
  customer_payment_id?: unknown;
  sales_return_id?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
  discount?: unknown;
}

export type LocalLedgerRows = {
  /** Mirrored / live sales transactions (whole server rows). */
  transactions: LedgerRow[];
  /** Invoice total per transaction id (stored total, else recomputed). */
  invoiceTotals: Record<string, number>;
  /** Mirrored / live customer payments (whole server rows). */
  payments: LedgerRow[];
  /** Mirrored / live payment allocations (whole server rows). */
  allocations: LedgerRow[];
  /** Mirrored / live sales returns (whole server rows). */
  returns: LedgerRow[];
  /** Mirrored / live sales return items (whole server rows). */
  returnItems: LedgerRow[];
  /** Pending queued sales (desktop queue; web: the localStorage queue). */
  pendingSales: PendingSale[];
  /** Request ids already present as synced transactions — a pending sale with one is skipped (S4 merge dedup). */
  syncedRequestIds: ReadonlySet<string>;
};

function toNumber(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateOnly(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return text.length >= 10 ? text.slice(0, 10) : "";
}

/** Total of one queued sale, from its saved input (same maths as the save path). */
export function queuedSaleTotal(sale: PendingSale): number {
  try {
    return calculateSaleAmounts(
      sale.input.lines.map((line) => ({
        quantity: line.quantity,
        sellingPrice: line.selling_price,
        discount: line.discount,
      })),
      {
        invoiceDiscount: sale.input.invoice_discount,
        invoiceDiscountType: sale.input.invoice_discount_type,
        taxRate: sale.input.tax_rate,
      },
    ).total;
  } catch {
    return 0;
  }
}

/**
 * Build the Single Source of Truth input for one customer from local
 * rows. Pending sales become synthetic invoice rows keyed by their
 * request id (allocations never reference a pending sale — a payment
 * allocated to an unsynced invoice waits for its sync — so the
 * request id can never collide with an allocation).
 */
export function buildCustomerBalanceInput(
  customerId: string,
  rows: LocalLedgerRows,
): CustomerBalanceLedgerInput {
  const transactions = rows.transactions
    .filter((row) => String(row.customer_id ?? "") === customerId)
    .map((row) => ({
      id: String(row.id ?? ""),
      customerId,
      invoiceTotal:
        rows.invoiceTotals[String(row.id ?? "")] ?? toNumber(row.total_amount),
      paymentType: typeof row.payment_type === "string" ? row.payment_type : null,
      status: typeof row.status === "string" ? row.status : null,
      sortDate: toDateOnly(row.sale_date) || toDateOnly(row.created_at),
      createdAt: typeof row.created_at === "string" ? row.created_at : "",
    }));
  for (const sale of rows.pendingSales) {
    if (rows.syncedRequestIds.has(sale.requestId)) continue;
    if (String(sale.input.customer_id ?? "") !== customerId) continue;
    if (sale.input.payment_type !== "credit") continue;
    transactions.push({
      id: sale.requestId,
      customerId,
      invoiceTotal: queuedSaleTotal(sale),
      paymentType: "credit",
      status: "confirmed",
      sortDate: toDateOnly(sale.input.sale_date) || toDateOnly(sale.createdAt),
      createdAt: typeof sale.createdAt === "string" ? sale.createdAt : "",
    });
  }
  return {
    transactions,
    payments: rows.payments
      .filter((row) => String(row.customer_id ?? "") === customerId)
      .map((row) => ({
        id: row.id != null ? String(row.id) : null,
        customerId,
        amount: toNumber(row.amount),
        voidedAt: typeof row.voided_at === "string" ? row.voided_at : null,
      })),
    allocations: rows.allocations.map((row) => ({
      salesTransactionId: String(row.sales_transaction_id ?? ""),
      amount: toNumber(row.amount),
      customerPaymentId: row.customer_payment_id != null ? String(row.customer_payment_id) : null,
    })),
    returns: rows.returns
      .filter((row) => String(row.customer_id ?? "") === customerId)
      .map((row) => ({
        id: String(row.id ?? ""),
        sales_transaction_id:
          typeof row.sales_transaction_id === "string" || typeof row.sales_transaction_id === "number"
            ? row.sales_transaction_id
            : null,
        status: typeof row.status === "string" ? row.status : null,
      })),
    returnItems: rows.returnItems.map((row) => ({
      sales_return_id:
        typeof row.sales_return_id === "string" || typeof row.sales_return_id === "number"
          ? row.sales_return_id
          : "",
      quantity:
        typeof row.quantity === "number" || typeof row.quantity === "string" ? row.quantity : null,
      unit_price:
        typeof row.unit_price === "number" || typeof row.unit_price === "string" ? row.unit_price : null,
      discount:
        typeof row.discount === "number" || typeof row.discount === "string" ? row.discount : null,
    })),
  };
}

/**
 * One customer's outstanding balance, derived from local ledger rows.
 * Returns 0 for a missing/empty customer id. The figure is identical
 * to the live computation for identical inputs (same engine, same
 * totals) — the only addition is pending queued credit sales, which
 * the live lists do not hold yet.
 */
export function deriveOfflineCustomerBalance(
  customerId: string | null | undefined,
  rows: LocalLedgerRows,
): { outstanding: number; creditSales: number; paymentsApplied: number; returnsCredited: number } {
  if (!customerId) {
    return { outstanding: 0, creditSales: 0, paymentsApplied: 0, returnsCredited: 0 };
  }
  const summary = deriveCustomerOutstanding(buildCustomerBalanceInput(customerId, rows));
  return {
    outstanding: summary.outstanding,
    creditSales: summary.creditSales,
    paymentsApplied: summary.paymentsApplied,
    returnsCredited: summary.returnsCredited,
  };
}
