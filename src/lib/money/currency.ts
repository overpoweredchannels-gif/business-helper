/**
 * Canonical currency helpers — the ONLY place for FX conversion math.
 * Do not duplicate these in exchange.ts, sale-amounts.ts, or components.
 *
 * All amounts are integer minor units (cents) as BigInt. Rates are PKR per
 * 1 EUR as integer micro-units (rate * 1e6) to keep every operation in
 * integers. Rounding is half-away-from-zero, applied once at the final step.
 * (BigInt() constructor style — the repo targets ES2017, no `1n` literals.)
 */

export type Currency = 'PKR' | 'EUR';

const MICRO = BigInt(1_000_000);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

/**
 * Parse a decimal rate STRING exactly (no floating point).
 * Rejects: non-numeric, >6 decimal places, zero/negative, > 999999.999999.
 * This is the ONLY rate entry point. There is no float-based parser —
 * floating-point rate parsing is implementation-dependent and was removed.
 */
export function parseRateToMicro(rateStr: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rateStr.trim());
  if (!m) throw new Error('currency.invalidRateFormat');
  const intPart = BigInt(m[1]);
  const fracPart = m[2] ?? '';
  if (intPart === BigInt(0) && (fracPart === '' || /^0+$/.test(fracPart))) {
    throw new Error('currency.invalidRate');
  }
  if (intPart > BigInt(999999)) throw new Error('currency.rateOutOfRange');
  const fracMicro = BigInt((fracPart + '000000').slice(0, 6));
  return intPart * BigInt(1_000_000) + fracMicro;
}

/** Parse a decimal tax rate string (e.g. "21", "4.5") to basis points. Rejects >2dp. */
export function parseTaxRateToBps(rateStr: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(rateStr.trim());
  if (!m) throw new Error('currency.invalidTaxRate');
  const frac = (m[2] ?? '').padEnd(2, '0');
  const bps = BigInt(m[1]) * BigInt(100) + BigInt(frac);
  if (bps > BigInt(10000)) throw new Error('currency.invalidTaxRate');
  return bps;
}

/** Half-away-from-zero division for BigInt: round(num / den). */
function divRound(num: bigint, den: bigint): bigint {
  if (den <= ZERO) throw new Error('currency.invalidRate');
  const neg = num < ZERO;
  const abs = neg ? -num : num;
  const q = abs / den;
  const r = abs % den;
  // half-away-from-zero: round up when remainder >= half (ties away from zero)
  const rounded = r * TWO >= den ? q + ONE : q;
  return neg ? -rounded : rounded;
}

/**
 * Convert PKR cents → EUR cents at the given rate.
 * eur_cents = round_half_away(pkr_cents * 1e6 / rate_micro)
 * Rate must be positive — validated here, not just at parse time.
 */
export function pkrToEurCents(pkrCents: bigint, rateMicro: bigint): bigint {
  if (rateMicro <= ZERO) throw new Error('currency.invalidRate');
  return divRound(pkrCents * MICRO, rateMicro);
}

/**
 * Convert EUR cents → PKR cents (base equivalent) at the given rate.
 * pkr_cents = round_half_away(eur_cents * rate_micro / 1e6)
 * Rate must be positive — validated here, not just at parse time.
 */
export function eurToPkrCents(eurCents: bigint, rateMicro: bigint): bigint {
  if (rateMicro <= ZERO) throw new Error('currency.invalidRate');
  return divRound(eurCents * rateMicro, MICRO);
}

/**
 * Format integer cents for display. Locale/currency chosen by the caller.
 * Precision-safe: the amount travels as a decimal string and the integer part
 * is grouped manually, so huge BigInt values never pass through Number().
 */
export function formatCents(cents: bigint, locale: string, currency: Currency): string {
  const neg = cents < ZERO;
  const abs = neg ? -cents : cents;
  const intPart = abs / BigInt(100);
  const fracPart = (abs % BigInt(100)).toString().padStart(2, '0');
  const groupSep = getGroupSep(locale);
  const decSep = getDecSep(locale);
  const grouped = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
  const localizedNumber = `${neg ? '-' : ''}${grouped}${decSep}${fracPart}`;
  // Place the currency symbol per locale convention (before/after the number).
  const sample = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(0);
  const firstDigit = sample.search(/\d/);
  const symbol = sample.slice(0, firstDigit).trim() || sample.slice(firstDigit).replace(/[\d.,\s]/g, '').trim();
  const symbolFirst = firstDigit > 0 && sample.slice(0, firstDigit).includes(symbol);
  return symbolFirst ? `${symbol} ${localizedNumber}`.trim() : `${localizedNumber} ${symbol}`.trim();
}

/** Locale's thousands separator (best-effort; defaults to ','). */
function getGroupSep(locale: string): string {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567);
  return parts.find(p => p.type === 'group')?.value ?? ',';
}

/** Locale's decimal separator (best-effort; defaults to '.'). */
function getDecSep(locale: string): string {
  const parts = new Intl.NumberFormat(locale).formatToParts(1.5);
  return parts.find(p => p.type === 'decimal')?.value ?? '.';
}

export interface Allocation {
  invoiceId: string;
  allocatedCents: bigint;
}

/**
 * Allocate a payment across invoices (in order given).
 * Returns per-invoice allocations and any leftover (overpayment) residual.
 * All amounts in the SAME currency (caller enforces).
 */
export function allocatePayment(
  paymentCents: bigint,
  invoices: Array<{ id: string; remainingCents: bigint }>
): { allocations: Allocation[]; residualCents: bigint } {
  if (paymentCents < ZERO) throw new Error('currency.negativePayment');
  const allocations: Allocation[] = [];
  let left = paymentCents;
  for (const inv of invoices) {
    if (left <= ZERO) break;
    if (inv.remainingCents <= ZERO) continue;
    const take = left < inv.remainingCents ? left : inv.remainingCents;
    allocations.push({ invoiceId: inv.id, allocatedCents: take });
    left -= take;
  }
  return { allocations, residualCents: left };
}

export interface ExchangeDifference {
  /** Base-currency equivalent at the invoice's rate. */
  invoiceBaseCents: bigint;
  /** Base-currency equivalent at the payment's rate. */
  paymentBaseCents: bigint;
  /** paymentBase - invoiceBase. Positive = more base currency received. */
  differenceCents: bigint;
}

/**
 * Exchange difference for a (partial) payment.
 * allocatedEurCents: the EUR amount of this payment applied to the invoice.
 * Both conversions use half-away-from-zero; the difference is exact.
 */
export function exchangeDifference(
  allocatedEurCents: bigint,
  invoiceRateMicro: bigint,
  paymentRateMicro: bigint
): ExchangeDifference {
  const invoiceBaseCents = eurToPkrCents(allocatedEurCents, invoiceRateMicro);
  const paymentBaseCents = eurToPkrCents(allocatedEurCents, paymentRateMicro);
  return { invoiceBaseCents, paymentBaseCents, differenceCents: paymentBaseCents - invoiceBaseCents };
}

/**
 * Assert two amounts share a currency before any aggregation.
 * Never silently sum across currencies.
 */
export function assertSameCurrency(a: Currency | null | undefined, b: Currency | null | undefined): void {
  if (!a || !b) throw new Error('currency.missing');
  if (a !== b) throw new Error(`currency.mismatch:${a}:${b}`);
}

// ---------------------------------------------------------------------------
// Tax helpers (integer cents, BigInt). Tax rates as basis points (1/100 of 1%):
// 21% -> 2100n, 10% -> 1000n, 4% -> 400n, 0% -> 0n.
// ---------------------------------------------------------------------------
// NOTE: no float-based tax-rate parser. Use parseTaxRateToBps(string).

export interface TaxLine {
  /** Net amount in cents (tax-exclusive base). */
  netCents: bigint;
  /** Tax amount in cents. */
  taxCents: bigint;
  /** Gross amount in cents (net + tax). */
  grossCents: bigint;
}

/** Validate basis points are in [0, 10000] (0%–100%). */
function assertValidBps(rateBps: bigint): void {
  if (rateBps < ZERO || rateBps > BigInt(10000)) throw new Error('currency.invalidTaxRate');
}

/**
 * Tax-exclusive pricing: shelf price is net, tax added on top.
 * (Existing TradeOS behavior — v_tax = round(taxable * rate / 100, 2).)
 */
export function taxExclusive(netCents: bigint, rateBps: bigint): TaxLine {
  assertValidBps(rateBps);
  const taxCents = divRound(netCents * rateBps, BigInt(10000));
  return { netCents, taxCents, grossCents: netCents + taxCents };
}

/**
 * Tax-inclusive pricing: shelf price includes tax, extract the tax portion.
 * net = round(gross * 10000 / (10000 + bps)); tax = gross - net.
 * (Spanish supermarket shelf prices are typically IVA-inclusive.)
 */
export function taxInclusive(grossCents: bigint, rateBps: bigint): TaxLine {
  assertValidBps(rateBps);
  const netCents = divRound(grossCents * BigInt(10000), BigInt(10000) + rateBps);
  return { netCents, taxCents: grossCents - netCents, grossCents };
}

export interface MixedRateLine extends TaxLine {
  rateBps: bigint;
}

export interface MixedRateBreakdown {
  lines: MixedRateLine[];
  totalNetCents: bigint;
  totalTaxCents: bigint;
  totalGrossCents: bigint;
  /** Per-rate subtotals for the receipt breakdown: [{rateBps, net, tax, gross}]. */
  byRate: Array<{ rateBps: bigint; netCents: bigint; taxCents: bigint; grossCents: bigint }>;
}

/**
 * Mixed-rate breakdown for a supermarket receipt.
 * Each item carries its own rate (from the product's tax default).
 * - exclusive: amountCents is the NET (tax added on top).
 * - inclusive:  amountCents is the GROSS shelf price (tax extracted).
 * Line discounts must already be reflected in amountCents (discounts
 * apply to the net/gross before tax is computed).
 */
export function mixedRateBreakdown(
  items: Array<{ amountCents: bigint; rateBps: bigint; inclusive: boolean }>
): MixedRateBreakdown {
  const lines: MixedRateLine[] = items.map(it =>
    it.inclusive
      ? { ...taxInclusive(it.amountCents, it.rateBps), rateBps: it.rateBps }
      : { ...taxExclusive(it.amountCents, it.rateBps), rateBps: it.rateBps }
  );
  const byRate = new Map<bigint, { netCents: bigint; taxCents: bigint; grossCents: bigint }>();
  let totalNetCents = ZERO, totalTaxCents = ZERO, totalGrossCents = ZERO;
  for (const l of lines) {
    totalNetCents += l.netCents;
    totalTaxCents += l.taxCents;
    totalGrossCents += l.grossCents;
    const g = byRate.get(l.rateBps) ?? { netCents: ZERO, taxCents: ZERO, grossCents: ZERO };
    g.netCents += l.netCents;
    g.taxCents += l.taxCents;
    g.grossCents += l.grossCents;
    byRate.set(l.rateBps, g);
  }
  return {
    lines,
    totalNetCents,
    totalTaxCents,
    totalGrossCents,
    byRate: [...byRate.entries()]
      .map(([rateBps, g]) => ({ rateBps, ...g }))
      .sort((a, b) => (a.rateBps < b.rateBps ? -1 : 1)),
  };
}

// ---------------------------------------------------------------------------
// Settlement reconciliation: base-amount rounding across allocations.
//
// Each allocation carries THREE distinct amounts:
//   carryingReleasedCents: invoice's booked base released by this allocation
//                          (at the INVOICE rate; settles the invoice).
//   paymentBaseCents:      actual base value of this allocation
//                          (at the PAYMENT rate; what was received).
//   fxDifferenceCents:     paymentBaseCents - carryingReleasedCents.
//
// Rounding reconciliation:
//   - Invoice side: the allocation completing an invoice takes
//     (invoiceBaseTotal - prior carrying released), absorbing rounding so a
//     fully-paid invoice settles its booked base exactly.
//   - Payment side: the payment's LAST allocation takes
//     (paymentBaseTotal - prior payment base), so allocations reconcile to
//     the payment's own base total.
// Never replace the payment's actual base equivalent with the invoice basis.
// ---------------------------------------------------------------------------

export interface ReconciledAllocation {
  invoiceId: string;
  allocatedCents: bigint;       // transaction-currency amount
  carryingReleasedCents: bigint; // invoice booked base released (invoice rate)
  paymentBaseCents: bigint;     // actual base value (payment rate)
  fxDifferenceCents: bigint;    // paymentBaseCents - carryingReleasedCents
}

/**
 * Largest-remainder distribution: split a base total across allocations so the
 * sum is exact and every share is non-negative.
 *
 * Each share i gets floor(exact_i); the leftover (target - sum(floors)) cents
 * go to the shares with the largest fractional remainders. Deterministic
 * (ties broken by index). Never negative: floor(exact_i) >= 0 for positive inputs.
 */
function largestRemainder(
  allocatedCents: bigint[],
  rateMicro: bigint,
  targetBaseCents: bigint
): bigint[] {
  const n = allocatedCents.length;
  const floors: bigint[] = [];
  const remainders: Array<{ idx: number; rem: bigint }> = [];
  let floorSum = ZERO;
  for (let i = 0; i < n; i++) {
    const exact = allocatedCents[i] * rateMicro;
    const f = exact / MICRO;
    floors.push(f);
    floorSum += f;
    remainders.push({ idx: i, rem: exact % MICRO });
  }
  let leftover = targetBaseCents - floorSum;
  // leftover is in [0, n) for correct targets; clamp defensively (never negative shares).
  if (leftover < ZERO) leftover = ZERO;
  if (leftover > BigInt(n)) leftover = BigInt(n);
  remainders.sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    return a.idx - b.idx;
  });
  const result = [...floors];
  for (let k = BigInt(0); k < leftover; k++) {
    result[remainders[Number(k)].idx] += ONE;
  }
  return result;
}

export interface ReconciledPayment {
  allocations: ReconciledAllocation[];
  /** EUR not allocated to any invoice (overpayment). Customer credit — never in an FX difference. */
  residualCents: bigint;
  /** Base value of the residual at the payment rate. */
  residualBaseCents: bigint;
  /**
   * Invariant: sum(allocation.paymentBaseCents) + residualBaseCents
   *   = paymentBaseTotalCents. Verified by allocateWithReconciliation.
   */
  paymentBaseTotalCents: bigint;
}

export function allocateWithReconciliation(
  paymentCents: bigint,
  paymentRateMicro: bigint,
  invoices: Array<{
    id: string;
    remainingCents: bigint;
    invoiceRateMicro: bigint;
    invoiceBaseTotalCents: bigint;
    priorCarryingReleasedCents: bigint;
    /** EUR cents already allocated to this invoice by prior payments. */
    priorAllocatedEurCents: bigint;
  }>
): ReconciledPayment {
  if (paymentRateMicro <= ZERO) throw new Error('currency.invalidRate');
  // Reject duplicate invoice IDs and inconsistent prior balances upfront.
  const seen = new Set<string>();
  for (const inv of invoices) {
    if (seen.has(inv.id)) throw new Error(`currency.duplicateInvoice:${inv.id}`);
    seen.add(inv.id);
    if (inv.invoiceRateMicro <= ZERO) throw new Error('currency.invalidRate');
    if (inv.priorCarryingReleasedCents < ZERO || inv.priorCarryingReleasedCents > inv.invoiceBaseTotalCents) {
      throw new Error(`currency.inconsistentPrior:${inv.id}`);
    }
    if (inv.remainingCents < ZERO) throw new Error(`currency.negativeRemaining:${inv.id}`);
  }

  const { allocations, residualCents } = allocatePayment(paymentCents, invoices);
  const paymentBaseTotalCents = eurToPkrCents(paymentCents, paymentRateMicro);

  // Base of the ALLOCATED portion only (single rounding of the allocated sum).
  const allocatedTotalCents = allocations.reduce((s, a) => s + a.allocatedCents, ZERO);
  const allocatedBaseTotalCents = eurToPkrCents(allocatedTotalCents, paymentRateMicro);
  // Residual base: the payment's base total minus the allocated base.
  // The residual is customer credit/change — it never enters an invoice's FX difference.
  const residualBaseCents = paymentBaseTotalCents - allocatedBaseTotalCents;

  // Payment side: largest-remainder distribution across allocations.
  // Guarantees exact sum and non-negative shares (no "last gets negative" bug).
  const paymentBases = largestRemainder(
    allocations.map(a => a.allocatedCents),
    paymentRateMicro,
    allocatedBaseTotalCents
  );

  const reconciled: ReconciledAllocation[] = allocations.map((a, idx) => {
    const inv = invoices.find(i => i.id === a.invoiceId)!;
    // Invoice (carrying) side: cumulative rounding.
    // carrying = round((priorAllocatedEur + thisEur) * rate) - priorCarryingReleased.
    // Deterministic, non-negative, and exact when the invoice is fully paid
    // (because round(invoiceTotal * rate) = invoiceBaseTotal by construction).
    const cumulativeEur = inv.priorAllocatedEurCents + a.allocatedCents;
    const carryingReleasedCents =
      divRound(cumulativeEur * inv.invoiceRateMicro, MICRO) - inv.priorCarryingReleasedCents;
    if (carryingReleasedCents < ZERO) throw new Error(`currency.negativeCarrying:${inv.id}`);
    const paymentBaseCents = paymentBases[idx];
    return {
      invoiceId: a.invoiceId,
      allocatedCents: a.allocatedCents,
      carryingReleasedCents,
      paymentBaseCents,
      fxDifferenceCents: paymentBaseCents - carryingReleasedCents,
    };
  });

  // Verify the invariant before returning.
  const sumPaymentBase = reconciled.reduce((s, a) => s + a.paymentBaseCents, ZERO);
  if (sumPaymentBase + residualBaseCents !== paymentBaseTotalCents) {
    throw new Error('currency.reconciliationBroken');
  }

  return { allocations: reconciled, residualCents, residualBaseCents, paymentBaseTotalCents };
}
