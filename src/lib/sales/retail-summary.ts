import { centsToMoney, moneyToCents } from "./sale-amounts";

export type RetailDrawerSummary = {
  expected: number;
  received: number;
  change: number;
  returnAmount: number;
  shortfall: number;
  status: "cash-ready" | "cash-short" | "credit-sale";
  closingMessage: string;
};

export function buildRetailDrawerSummary({ total, received, paymentType = "cash" }: { total: number; received: number | string; paymentType?: "cash" | "credit" }): RetailDrawerSummary {
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
        ? `Cash drawer is ready. Change due is ${new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(returnAmount)}.`
        : `Cash is short by ${new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(shortfall)}.`,
  };
}
