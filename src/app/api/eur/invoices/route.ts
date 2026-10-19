/**
 * POST /api/eur/invoices
 * Create a new EUR invoice (draft).
 * 
 * Body: {
 *   customer_name: string,
 *   customer_tax_id?: string,
 *   fx_quote_id: string,
 *   lines: EurInvoiceLine[]
 * }
 * 
 * Requires: Authenticated user with invoice creation permission
 * 
 * NOTE: Database schema (Stage 1) must be applied before this works.
 * Returns 503 if required tables do not exist.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/identity/authorization';
import { createSupabaseService } from '@/lib/supabase/server';
import { calculateInvoiceTotals, validateEurInvoice } from '@/lib/eur/invoice-service';
import { parseRateToMicro } from '@/lib/money/currency';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, 'create_invoice');
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? 'Forbidden' },
      { status: 403 }
    );
  }

  const orgId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  try {
    const body = await request.json();
    const { customer_name, customer_tax_id, fx_quote_id, lines } = body;

    // Validate input
    const errors = validateEurInvoice(lines, fx_quote_id, customer_name);
    if (errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: errors.join('; ') },
        { status: 400 }
      );
    }

    // Get the FX quote to verify it exists and get the rate
    const { data: quote, error: quoteError } = await supabase
      .from('fx_quotes')
      .select('*')
      .eq('id', fx_quote_id)
      .eq('organization_id', orgId)
      .single();

    if (quoteError) {
      if (quoteError.code === '42P01') {
        return NextResponse.json(
          { ok: false, error: 'EUR feature not yet enabled. Database schema required.' },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { ok: false, error: 'FX quote not found' },
        { status: 404 }
      );
    }

    // Verify quote is not superseded
    if (quote.superseded_by) {
      return NextResponse.json(
        { ok: false, error: 'FX quote has been superseded. Please use the latest quote.' },
        { status: 409 }
      );
    }

    // Calculate totals
    const totals = calculateInvoiceTotals(lines, quote.rate);

    // Generate invoice number (using existing next_invoice_number function)
    const { data: numberData, error: numberError } = await supabase
      .rpc('next_invoice_number', { p_organization_id: orgId });

    if (numberError) throw numberError;
    const invoiceNumber = numberData as string;

    // Create the invoice
    // Note: This assumes sales_transactions has the EUR columns from Stage 1
    const { data: invoice, error: insertError } = await supabase
      .from('sales_transactions')
      .insert({
        organization_id: orgId,
        invoice_number: invoiceNumber,
        currency: 'EUR',
        fx_quote_id: fx_quote_id,
        customer_name,
        customer_tax_id: customer_tax_id ?? null,
        subtotal: Number(totals.subtotalEurCents) / 100,
        tax_amount: Number(totals.taxEurCents) / 100,
        total: Number(totals.totalEurCents) / 100,
        base_total: Number(totals.totalPkrCents) / 100,
        status: 'draft',
        created_by: permission.actor.profileId,
      })
      .select()
      .single();

    if (insertError) {
      // Currency column doesn't exist (Stage 1 not applied)
      if (insertError.code === '42703') {
        return NextResponse.json(
          { ok: false, error: 'EUR feature not yet enabled. Database schema required.' },
          { status: 503 }
        );
      }
      throw insertError;
    }

    return NextResponse.json(
      {
        ok: true,
        invoice: {
          ...invoice,
          totals: {
            subtotalEurCents: totals.subtotalEurCents.toString(),
            taxEurCents: totals.taxEurCents.toString(),
            totalEurCents: totals.totalEurCents.toString(),
            totalPkrCents: totals.totalPkrCents.toString(),
          },
          taxBreakdown: totals.taxBreakdown.map(b => ({
            rateBps: b.rateBps.toString(),
            taxableEurCents: b.taxableEurCents.toString(),
            taxEurCents: b.taxEurCents.toString(),
          })),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[EUR] Failed to create invoice:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to create EUR invoice' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/eur/invoices
 * List EUR invoices for the organization.
 */
export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, 'view_invoices');
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? 'Forbidden' },
      { status: 403 }
    );
  }

  const orgId = permission.actor.organizationId;
  const supabase = createSupabaseService();

  try {
    const { data, error } = await supabase
      .from('sales_transactions')
      .select('*')
      .eq('organization_id', orgId)
      .eq('currency', 'EUR')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      if (error.code === '42P01' || error.code === '42703') {
        return NextResponse.json(
          { ok: false, error: 'EUR feature not yet enabled.' },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true, invoices: data });
  } catch (err) {
    console.error('[EUR] Failed to list invoices:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to load EUR invoices' },
      { status: 500 }
    );
  }
}
