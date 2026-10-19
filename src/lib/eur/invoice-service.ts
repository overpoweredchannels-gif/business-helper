/**
 * EUR invoice calculation service.
 * Uses src/lib/money/currency.ts for precise BigInt math.
 * All amounts in minor units (cents) as BigInt.
 */

import {
  parseRateToMicro,
  parseTaxRateToBps,
  pkrToEurCents,
  eurToPkrCents,
} from '@/lib/money/currency';
import type { EurInvoiceLine } from './types';

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

export interface CalculatedTotals {
  subtotalEurCents: bigint;
  taxEurCents: bigint;
  totalEurCents: bigint;
  totalPkrCents: bigint;
  taxBreakdown: Array<{
    rateBps: bigint;
    taxableEurCents: bigint;
    taxEurCents: bigint;
  }>;
}

/**
 * Calculate invoice totals from lines.
 * 
 * @param lines - Invoice lines with EUR prices
 * @param fxRateStr - FX rate as string, e.g. "312.45" (PKR per EUR)
 * @returns Totals in EUR cents (BigInt) and PKR cents (BigInt)
 */
export function calculateInvoiceTotals(
  lines: EurInvoiceLine[],
  fxRateStr: string
): CalculatedTotals {
  const rateMicro = parseRateToMicro(fxRateStr);
  
  let subtotalEurCents = ZERO;
  let taxEurCents = ZERO;
  const taxByRate = new Map<string, { taxable: bigint; tax: bigint }>();
  
  for (const line of lines) {
    const qty = BigInt(Math.round(line.quantity * 100)); // quantity in hundredths
    const unitPriceCents = BigInt(line.unit_price_eur_cents);
    
    // Line subtotal: qty * unit_price / 100 (qty was in hundredths)
    const lineSubtotal = (qty * unitPriceCents) / HUNDRED;
    
    // Discount
    const discountPct = line.discount_pct ?? 0;
    const discountCents = (lineSubtotal * BigInt(Math.round(discountPct * 100))) / BigInt(10000);
    const lineNet = lineSubtotal - discountCents;
    
    subtotalEurCents += lineNet;
    
    // Tax
    if (line.tax_rate_bps !== undefined && line.tax_rate_bps > 0) {
      const rateBps = BigInt(line.tax_rate_bps);
      // Tax = net * rate / 10000 (bps to decimal)
      const lineTax = (lineNet * rateBps) / BigInt(10000);
      taxEurCents += lineTax;
      
      // Track by rate for breakdown
      const key = rateBps.toString();
      const existing = taxByRate.get(key) ?? { taxable: ZERO, tax: ZERO };
      existing.taxable += lineNet;
      existing.tax += lineTax;
      taxByRate.set(key, existing);
    }
  }
  
  const totalEurCents = subtotalEurCents + taxEurCents;
  
  // Convert to PKR using the FX rate
  // eurToPkrCents expects (eurCents: bigint, rateMicro: bigint)
  const totalPkrCents = eurToPkrCents(totalEurCents, rateMicro);
  
  const taxBreakdown = Array.from(taxByRate.entries()).map(([rateBps, vals]) => ({
    rateBps: BigInt(rateBps),
    taxableEurCents: vals.taxable,
    taxEurCents: vals.tax,
  }));
  
  return {
    subtotalEurCents,
    taxEurCents,
    totalEurCents,
    totalPkrCents,
    taxBreakdown,
  };
}

/**
 * Validate an EUR invoice before creation.
 * Returns array of error messages (empty = valid).
 */
export function validateEurInvoice(
  lines: EurInvoiceLine[],
  fxQuoteId: string,
  customerName: string
): string[] {
  const errors: string[] = [];
  
  if (!fxQuoteId) {
    errors.push('FX quote is required');
  }
  
  if (!customerName?.trim()) {
    errors.push('Customer name is required');
  }
  
  if (!lines || lines.length === 0) {
    errors.push('At least one line item is required');
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.description?.trim()) {
      errors.push(`Line ${i + 1}: Description is required`);
    }
    if (line.quantity <= 0) {
      errors.push(`Line ${i + 1}: Quantity must be positive`);
    }
    if (line.unit_price_eur_cents < 0) {
      errors.push(`Line ${i + 1}: Unit price cannot be negative`);
    }
    if (line.discount_pct !== undefined && (line.discount_pct < 0 || line.discount_pct > 100)) {
      errors.push(`Line ${i + 1}: Discount must be between 0 and 100`);
    }
  }
  
  return errors;
}
