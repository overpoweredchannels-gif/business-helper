import { centsToMoney, moneyToCents } from "./sale-amounts";
import { formatBooksAmount } from "../books/format";
import type { Currency } from "../regional/settings";

export type RetailDrawerSummary = {
  expected: number;
  received: number;
  change: number;
  returnAmount: number;
  shortfall: number;
  status: "cash-ready" | "cash-short" | "credit-sale";
  closingMessage: string;
};

export function buildRetailDrawerSummary({ total, received, paymentType = "cash", currency = "PKR", locale = "en-PK" }: { total: number; received: number | string; paymentType?: "cash" | "card" | "credit"; currency?: Currency; locale?: string }): RetailDrawerSummary {
  // The totals are books amounts, so the closing message formats them
  // in the organization's books currency (threaded in by the caller —
  // the POS resolves it at org load) via the books formatter: never
  // converted, never relabelled. The PKR default preserves the prior
  // behaviour for callers that do not thread a currency yet.
  if (paymentType !== "cash") {
    return {
      expected: total,
      received: 0,
      change: 0,
      returnAmount: 0,
      shortfall: 0,
      status: "credit-sale",
      closingMessage: "This sale is on credit, so no cash drawer close is needed yet.",
    };
  }

  const rawExpected = Number.isFinite(total) ? Math.max(0, total) : 0;
  const expectedCents = moneyToCents(rawExpected);
  const expected = centsToMoney(expectedCents);
  const entered = typeof received === "string" && received.trim() === "" ? expected : Number(received);
  const receivedCents = Number.isFinite(entered) ? moneyToCents(Math.max(0, entered)) : BigInt(0);
  const cashReceived = centsToMoney(receivedCents);
  const shortfall = centsToMoney(expectedCents > receivedCents ? expectedCents - receivedCents : BigInt(0));
  const returnAmount = centsToMoney(receivedCents > expectedCents ? receivedCents - expectedCents : BigInt(0));
  const change = returnAmount;

  return {
    expected,
    received: cashReceived,
    change,
    returnAmount,
    shortfall,
    status: receivedCents >= expectedCents ? "cash-ready" : "cash-short",
    closingMessage:
      receivedCents >= expectedCents
        ? `Cash drawer is ready. Change due is ${formatBooksAmount(returnAmount, currency, locale)}.`
        : `Cash is short by ${formatBooksAmount(shortfall, currency, locale)}.`,
  };
}
