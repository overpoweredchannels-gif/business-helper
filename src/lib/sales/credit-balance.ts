import { roundMoney } from "./sale-amounts";

/** One credit invoice's unpaid remainder, in the order the cashier saw it. */
export type CreditBalanceEntry = {
  id: string;
  customerId: string;
  paymentType: string;
  createdAt: string;
  invoiceNumber: string;
  /** Unpaid remainder of this invoice (0 when paid in full). */
  remaining: number;
};

export type CreditBalancePoint = { previous: number; next: number };

/** Running credit balance per customer, oldest invoice first.
 * `previous` is what the customer owed before this invoice, `next` is
 * what they owe after it (previous + this invoice's unpaid remainder).
 * Only credit invoices move the balance; cash/card invoices are paid in
 * full by construction and never appear in the timeline. Invoices sort
 * by creation time, then by the numeric part of the invoice number, so
 * two invoices created in the same second still order correctly. */
export function creditBalanceTimeline(entries: CreditBalanceEntry[]): Record<string, CreditBalancePoint> {
  const byCustomer = new Map<string, CreditBalanceEntry[]>();
  for (const entry of entries) {
    if (entry.paymentType !== "credit") continue;
    const list = byCustomer.get(entry.customerId) ?? [];
    list.push(entry);
    byCustomer.set(entry.customerId, list);
  }
  const timeline: Record<string, CreditBalancePoint> = {};
  for (const list of byCustomer.values()) {
    list.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        numericInvoiceSuffix(a.invoiceNumber) - numericInvoiceSuffix(b.invoiceNumber),
    );
    let running = 0;
    for (const entry of list) {
      const previous = running;
      running = roundMoney(running + Math.max(0, entry.remaining));
      timeline[entry.id] = { previous, next: running };
    }
  }
  return timeline;
}

function numericInvoiceSuffix(invoiceNumber: string): number {
  const match = /(\d+)\s*$/.exec(invoiceNumber);
  return match ? Number(match[1]) : 0;
}
