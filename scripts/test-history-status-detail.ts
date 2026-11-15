import assert from "node:assert/strict";
import {
  formatProductsSummary,
  getPaymentStatusBadgeKind,
  paymentStatusBadgeClass,
} from "../src/lib/history/payment-status";
import { formatBooksAmount } from "../src/lib/books/format";
import { messages } from "../src/lib/regional/messages";

// Badge kind is a pure function of the numbers the allocation engines
// already compute (src/lib/sales/returns-offset.ts,
// src/lib/purchases/returns-offset.ts): Paid = allocated, Remaining =
// total − paid − returned (floored at 0). These scenarios mirror the
// ledger's live QA cases: a credit sale paid in full, paid in part, and
// not paid at all; a cash/card sale is paid by construction.

const TODAY = "2026-11-15";

// Cash/card sale: paid = total, remaining = 0 → Paid.
{
  assert.equal(
    getPaymentStatusBadgeKind({ total: 1.13, paid: 1.13, remaining: 0 }),
    "paid"
  );
}

// Credit sale, nothing paid yet → Unpaid.
{
  assert.equal(
    getPaymentStatusBadgeKind({ total: 1.13, paid: 0, remaining: 1.13 }),
    "unpaid"
  );
}

// Credit sale, part paid → Partial, with Paid and Remaining carried.
{
  assert.equal(
    getPaymentStatusBadgeKind({ total: 1.13, paid: 0.5, remaining: 0.63 }),
    "partial"
  );
}

// Credit sale, fully allocated → Paid (even with a past due date: a paid
// invoice is never overdue).
{
  assert.equal(
    getPaymentStatusBadgeKind({
      total: 1.13,
      paid: 1.13,
      remaining: 0,
      dueDate: "2026-11-01",
      today: TODAY,
    }),
    "paid"
  );
}

// Credit sale, unpaid and past its due date → Overdue (the existing
// sales-history status, kept as a red badge).
{
  assert.equal(
    getPaymentStatusBadgeKind({
      total: 1.13,
      paid: 0,
      remaining: 1.13,
      dueDate: "2026-11-01",
      today: TODAY,
    }),
    "overdue"
  );
}

// Credit sale, part paid but past its due date → Overdue (the existing
// sales-history rule: overdue outranks partial, as before).
{
  assert.equal(
    getPaymentStatusBadgeKind({
      total: 1.13,
      paid: 0.5,
      remaining: 0.63,
      dueDate: "2026-11-01",
      today: TODAY,
    }),
    "overdue"
  );
}

// Due date today or in the future is not overdue.
{
  assert.equal(
    getPaymentStatusBadgeKind({
      total: 1.13,
      paid: 0,
      remaining: 1.13,
      dueDate: "2026-11-15",
      today: TODAY,
    }),
    "unpaid"
  );
  assert.equal(
    getPaymentStatusBadgeKind({
      total: 1.13,
      paid: 0,
      remaining: 1.13,
      dueDate: "2026-11-20",
      today: TODAY,
    }),
    "unpaid"
  );
}

// Over-allocation / over-payment can never show a negative remaining:
// remaining is floored at 0 by the engine, so the badge is Paid.
{
  assert.equal(
    getPaymentStatusBadgeKind({ total: 1.0, paid: 1.2, remaining: 0 }),
    "paid"
  );
}

// Badge colours follow the spec: Paid green, Partial amber,
// Unpaid/Overdue red — semantic tokens only, no hex (AGENTS.md).
{
  assert.equal(paymentStatusBadgeClass("paid"), "bg-success/10 text-success");
  assert.equal(
    paymentStatusBadgeClass("partial"),
    "bg-warning/10 text-warning-text"
  );
  assert.equal(
    paymentStatusBadgeClass("unpaid"),
    "bg-destructive/10 text-destructive"
  );
  assert.equal(
    paymentStatusBadgeClass("overdue"),
    "bg-destructive/10 text-destructive"
  );
}

// Products summary — sales: which items were taken, no rate.
{
  assert.equal(
    formatProductsSummary([
      { name: "COCA COLA 1L", quantity: 2 },
      { name: "DAIRY MILK", quantity: 1 },
    ]),
    "COCA COLA 1L ×2 · DAIRY MILK ×1"
  );
}

// Products summary — purchases: which goods at what rate.
{
  const eur = (amount: number) => `€${amount.toFixed(2)}`;
  assert.equal(
    formatProductsSummary(
      [
        { name: "COCA COLA 1L", quantity: 10, rate: 0.81 },
        { name: "DAIRY MILK", quantity: 5, rate: 0.09 },
      ],
      eur
    ),
    "COCA COLA 1L 10 × €0.81 · DAIRY MILK 5 × €0.09"
  );
}

// Empty invoice / unknown product names are skipped, never rendered blank.
{
  assert.equal(formatProductsSummary([]), "");
  assert.equal(
    formatProductsSummary([
      { name: "   ", quantity: 1 },
      { name: "COCA COLA 1L", quantity: 1 },
    ]),
    "COCA COLA 1L ×1"
  );
}

// Badge label is "Partial" (spec), not "Partially Paid": the keys exist
// in all four locales (typecheck enforces the keys; assert the values
// here so a label regression fails the slice test, not live QA).
{
  assert.equal(messages.en["sell.statusPartial"], "Partial");
  assert.equal(messages.en["buy.statusPartial"], "Partial");
  for (const language of Object.keys(messages) as Array<keyof typeof messages>) {
    assert.equal(typeof messages[language]["sell.statusPartial"], "string");
    assert.ok(messages[language]["sell.statusPartial"].length > 0);
    assert.equal(typeof messages[language]["buy.statusPartial"], "string");
    assert.ok(messages[language]["buy.statusPartial"].length > 0);
  }
}

// The remaining-balance amount renders with a single currency symbol:
// the books formatter never prefixes a "$" (live QA caught a stray "$"
// literal in the sales-row JSX, not in the formatter — this guards the
// formatter half, and the JSX is covered by the live re-QA).
{
  assert.equal(formatBooksAmount(0.41, "EUR", "en-PK"), "€0.41");
  assert.equal(formatBooksAmount(0.81, "EUR", "en-PK"), "€0.81");
  assert.ok(!formatBooksAmount(0.41, "EUR", "en-PK").includes("$"));
}

console.log(
  "History status/detail tests passed: Paid/Partial/Unpaid/Overdue badge kinds from allocations (incl. paid-beats-overdue, overdue outranks partial, due-today not overdue), token-only badge classes, and sales/purchase products summaries."
);
