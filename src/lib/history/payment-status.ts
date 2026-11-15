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
// buy.statusPartial, buy.statusUnpaid, money.paid) — this module only
// decides the kind and
// the token-only badge classes (AGENTS.md: semantic tokens, never hex).
// The established badge pattern in page.tsx is
// `rounded px-2 py-1 text-xs font-semibold` + a tone pair.

export type PaymentStatusBadgeKind = "paid" | "partial" | "unpaid" | "overdue";

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
}

// Paid wins over everything (a fully paid invoice is never overdue, even
// when its due date passed before the last payment landed). Overdue keeps
// its existing meaning from the sales history: a credit invoice still
// owed past its due date. Partial is any invoice with something paid and
// something still owed. Unpaid is a credit invoice with nothing paid yet.
export function getPaymentStatusBadgeKind(input: PaymentStatusBadgeInput): PaymentStatusBadgeKind {
  const paid = Math.max(0, input.paid);
  const remaining = Math.max(0, input.remaining);
  if (remaining <= 0) return "paid";
  if (input.dueDate && input.today && input.dueDate < input.today) return "overdue";
  if (paid > 0) return "partial";
  return "unpaid";
}

// Tone pairs already used for badges in page.tsx (success / warning /
// destructive semantic tokens). Overdue shares the Unpaid red: it is an
// unpaid invoice, only further past its due date.
export function paymentStatusBadgeClass(kind: PaymentStatusBadgeKind): string {
  switch (kind) {
    case "paid":
      return "bg-success/10 text-success";
    case "partial":
      return "bg-warning/10 text-warning-text";
    case "unpaid":
    case "overdue":
      return "bg-destructive/10 text-destructive";
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
