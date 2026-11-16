// Payment-status badges for the Sales & Purchase History ledgers.
//
// The badge KIND is a pure function of the numbers the existing allocation
// engines already compute — it adds no second source of truth:
//   - Sales: creditAllocationByTransaction (src/lib/sales/returns-offset.ts)
//     gives allocatedAmount (explicit allocations excluding voided payments,
//     plus the FIFO legacy unallocated-payment pool, net of sales returns)
//     and remainingUnpaidAmount (floored at 0). Cash/card sales are paid in
//     full by construction (cash_received = total), so they report
//     paid = invoice total, remaining = 0.
//   - Purchases: supplierPaymentAllocationByPurchaseTransaction
//     (src/lib/purchases/returns-offset.ts) gives paidAmount and
//     remainingPayableAmount the same way.
// The badge LABELS come from translation keys
// (sell.statusPaid, sell.statusPartial, sell.statusOverdue,
// buy.statusPartial, buy.statusUnpaid, buy.returnedLabel, money.paid) —
// this module only decides the kind and
// the token-only badge classes (AGENTS.md: semantic tokens, never hex).
// The established badge pattern in page.tsx is
// `rounded px-2 py-1 text-xs font-semibold` + a tone pair.
//
// The "returned" kind is for any invoice whose goods were 100%
// returned — purchase or sale. It shows "Returned", never "Paid"
// (its remaining is 0, which the plain paid rule would otherwise
// report as paid). Purchases pass `returned` from the purchase
// allocation engine; sales pass it from returnedValueBySalesTransaction
// (src/lib/sales/returns-offset.ts), which covers every payment type,
// not just credit — so a fully returned cash/card sale is "Returned"
// too, not "Paid".

export type PaymentStatusBadgeKind = "paid" | "partial" | "unpaid" | "overdue" | "returned";

export interface PaymentStatusBadgeInput {
  /** Invoice total (books currency). */
  total: number;
  /** Amount already paid on the invoice, from the allocation engine. */
  paid: number;
  /** Amount still owed, from the allocation engine (floored at 0). */
  remaining: number;
  /** Credit due date as "YYYY-MM-DD", or null when there is none. */
  dueDate?: string | null;
  /** Today as "YYYY-MM-DD" (compared lexicographically, as in page.tsx). */
  today?: string;
  /**
   * Amount of the invoice's goods returned. Purchases pass this from
   * the purchase allocation engine; sales pass it from
   * returnedValueBySalesTransaction (all payment types). When it
   * covers the whole invoice total, the invoice is "returned" — even
   * when something was paid before the return, and even though the
   * remaining is 0.
   */
  returned?: number;
}

// Returned wins over everything (a fully returned invoice is neither
// paid nor owed, even though its remaining is 0 and something may have
// been paid before the return). Paid wins over everything else (a fully
// paid invoice is never overdue, even when its due date passed before
// the last payment landed). Overdue keeps its existing meaning from the
// sales history: a credit invoice still owed past its due date. Partial
// is any invoice with something paid and something still owed. Unpaid is
// a credit invoice with nothing paid yet.
export function getPaymentStatusBadgeKind(input: PaymentStatusBadgeInput): PaymentStatusBadgeKind {
  const paid = Math.max(0, input.paid);
  const remaining = Math.max(0, input.remaining);
  const returned = input.returned === undefined ? 0 : Math.max(0, input.returned);
  if (input.returned !== undefined && input.total > 0 && returned >= input.total) return "returned";
  if (remaining <= 0) return "paid";
  if (input.dueDate && input.today && input.dueDate < input.today) return "overdue";
  if (paid > 0) return "partial";
  return "unpaid";
}

export interface SalesPaymentStatusInput {
  /** "cash" | "card" | "credit" (any other value behaves like credit). */
  paymentType: string | null | undefined;
  /** Invoice total (books currency). */
  total: number;
  /** Amount already paid, from the credit allocation engine (credit sales only). */
  allocatedAmount: number;
  /** Amount still owed, from the credit allocation engine (credit sales only, floored at 0). */
  remainingUnpaidAmount: number;
  /** Amount of the invoice's goods returned, from
   * returnedValueBySalesTransaction (all payment types). */
  returnedAmount: number;
  /** Credit due date as "YYYY-MM-DD", or null when there is none. */
  dueDate?: string | null;
  /** Today as "YYYY-MM-DD" (compared lexicographically, as in page.tsx). */
  today?: string;
}

// Sales payment status — the single source of truth for both the Sales
// History row badge and the payment-status filter, so the two can never
// disagree. Cash/card sales are paid in full by construction (paid =
// total, remaining = 0), but a fully returned cash/card sale is still
// "Returned": the returned amount comes from
// returnedValueBySalesTransaction, which covers every payment type —
// not from the credit-only allocation engine. The "returned" check in
// getPaymentStatusBadgeKind runs first, so a fully returned invoice is
// "Returned" even though its remaining is 0.
export function getSalesPaymentStatusKind(input: SalesPaymentStatusInput): PaymentStatusBadgeKind {
  const isCashOrCard = input.paymentType === "cash" || input.paymentType === "card";
  return getPaymentStatusBadgeKind({
    total: input.total,
    paid: isCashOrCard ? input.total : input.allocatedAmount,
    remaining: isCashOrCard ? 0 : input.remainingUnpaidAmount,
    dueDate: input.dueDate,
    today: input.today,
    returned: input.returnedAmount,
  });
}

// Tone pairs already used for badges in page.tsx (success / warning /
// destructive semantic tokens). Overdue shares the Unpaid red: it is an
// unpaid invoice, only further past its due date. Returned is neutral:
// a returned invoice is neither paid nor unpaid, so it takes the muted
// tone, never green or red.
export function paymentStatusBadgeClass(kind: PaymentStatusBadgeKind): string {
  switch (kind) {
    case "paid":
      return "bg-success/10 text-success";
    case "partial":
      return "bg-warning/10 text-warning-text";
    case "unpaid":
    case "overdue":
      return "bg-destructive/10 text-destructive";
    case "returned":
      return "bg-muted text-muted-foreground";
  }
}

export interface ProductsSummaryItem {
  name: string;
  quantity: number;
  /** Purchase rate per unit; omitted for sales summaries (rate already
   *  shows in the ledger detail's line-items table). */
  rate?: number;
}

// One-line, at-a-glance summary of the goods on an invoice, in the same
// "Name × qty" shape the app already renders elsewhere (e.g. the sales
// order lines). With a rate: "COCA COLA 1L 10 × €0.81". Rows truncate
// with CSS, so every line is joined here — no "+N more" counting and no
// new translation key needed.
export function formatProductsSummary(
  items: readonly ProductsSummaryItem[],
  formatMoney: (amount: number) => string = (amount) => String(amount)
): string {
  return items
    .filter((item) => item.name.trim() !== "")
    .map((item) =>
      item.rate === undefined
        ? `${item.name} ×${item.quantity}`
        : `${item.name} ${item.quantity} × ${formatMoney(item.rate)}`
    )
    .join(" · ");
}
