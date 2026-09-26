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
  const expected = Math.round((rawExpected + Number.EPSILON) * 100) / 100;
  const entered = typeof received === "string" && received.trim() === "" ? expected : Number(received);
  const cashReceived = Number.isFinite(entered) ? Math.max(0, entered) : 0;
  const shortfall = Math.max(0, expected - cashReceived);
  const returnAmount = Math.max(0, cashReceived - expected);
  const change = returnAmount;

  return {
    expected,
    received: cashReceived,
    change,
    returnAmount,
    shortfall,
    status: cashReceived >= expected ? "cash-ready" : "cash-short",
    closingMessage:
      cashReceived >= expected
        ? `Cash drawer is ready. Change due is ${new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(returnAmount)}.`
        : `Cash is short by ${new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(shortfall)}.`,
  };
}
