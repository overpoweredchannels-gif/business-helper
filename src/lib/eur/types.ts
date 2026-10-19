/**
 * EUR Invoice types — for the Spain customer.
 * These types define the shape of EUR invoices, FX quotes, and payments.
 * Database schema (Stage 1) must be applied before these can be persisted.
 */

export type Currency = 'PKR' | 'EUR';

export interface FxQuote {
  id: string;
  organization_id: string;
  base_currency: 'PKR';
  quote_currency: 'EUR';
  /** Rate as PKR per 1 EUR, e.g. "312.45" */
  rate: string;
  rate_date: string; // ISO date
  source: 'manual' | 'api';
  provider?: string;
  override_reason?: string;
  superseded_by?: string;
  created_by_profile_id?: string;
  created_at: string;
}

export interface EurInvoiceLine {
  product_id?: string;
  description: string;
  quantity: number;
  /** Unit price in EUR cents */
  unit_price_eur_cents: number;
  /** Discount percentage (0-100) */
  discount_pct?: number;
  /** Tax rate in basis points (e.g. 2100 = 21%) */
  tax_rate_bps?: number;
}

export interface EurInvoice {
  id?: string;
  organization_id: string;
  /** Invoice number (e.g. "S000001") */
  number: string;
  currency: 'EUR';
  /** FX quote ID used for this invoice */
  fx_quote_id: string;
  /** Rate used (PKR per EUR) */
  fx_rate: string;
  customer_id?: string;
  customer_name: string;
  customer_tax_id?: string;
  lines: EurInvoiceLine[];
  /** Totals in EUR cents */
  subtotal_eur_cents: number;
  tax_eur_cents: number;
  total_eur_cents: number;
  /** Totals in PKR cents (for accounting) */
  total_pkr_cents: number;
  /** Tax breakdown by rate */
  tax_breakdown?: Array<{
    rate_bps: number;
    taxable_eur_cents: number;
    tax_eur_cents: number;
  }>;
  status: 'draft' | 'issued' | 'paid' | 'cancelled';
  issued_at?: string;
  created_at: string;
}

export interface EurPayment {
  id?: string;
  invoice_id: string;
  /** Amount in EUR cents */
  amount_eur_cents: number;
  /** Amount in PKR cents (at payment-time rate) */
  amount_pkr_cents: number;
  /** FX quote used for payment */
  fx_quote_id: string;
  payment_method: 'cash' | 'bank_transfer' | 'card';
  payment_date: string;
  /** FX difference (can be positive or negative) */
  fx_difference_pkr_cents: number;
  created_at: string;
}

/**
 * Calculate EUR invoice totals from lines.
 * Uses the currency module for precise BigInt math.
 */
export function calculateEurInvoiceTotals(
  lines: EurInvoiceLine[],
  fxRateMicro: bigint
): {
  subtotalEurCents: bigint;
  taxEurCents: bigint;
  totalEurCents: bigint;
  totalPkrCents: bigint;
} {
  // This will use src/lib/money/currency.ts functions
  // Implementation deferred until API routes are built
  throw new Error('Not implemented - requires currency module integration');
}
