import { isCurrency, type Currency } from "@/lib/regional/settings";

/**
 * Convert a PKR-based rate table (1 PKR = X units of the target) into the
 * app's display-rate convention: PKR per 1 unit of the target currency.
 * PKR itself is the identity (1). Unknown, zero, or negative entries yield
 * null — callers must never invent a conversion from a bad rate.
 */
export function pkrPerUnitFromBaseRates(
  rates: Record<string, unknown> | null | undefined,
  currency: Currency,
): number | null {
  if (!isCurrency(currency)) return null;
  if (currency === "PKR") return 1;
  if (!rates || typeof rates !== "object") return null;
  const perPkr = rates[currency];
  const parsed = typeof perPkr === "number" ? perPkr : Number.parseFloat(String(perPkr ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return 1 / parsed;
}
