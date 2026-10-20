/**
 * GET /api/eur/quotes
 * List FX quotes for the organization.
 * 
 * Query params:
 * - currency: Filter by quote currency (default: EUR)
 * - active_only: Only return non-superseded quotes (default: true)
 * 
 * Requires: Owner or admin access
 * 
 * NOTE: Database schema (Stage 1) must be applied before this works.
 * Returns 503 if fx_quotes table does not exist.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/identity/authorization';
import { createSupabaseService } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, 'reports_view');
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? 'Forbidden' },
      { status: 403 }
    );
  }

  const orgId = permission.actor.organizationId;
  const supabase = createSupabaseService();
  
  const { searchParams } = new URL(request.url);
  const currency = searchParams.get('currency') ?? 'EUR';
  const activeOnly = searchParams.get('active_only') !== 'false';

  try {
    let query = supabase
      .from('fx_quotes')
      .select('*')
      .eq('organization_id', orgId)
      .eq('quote_currency', currency)
      .order('rate_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (activeOnly) {
      query = query.is('superseded_by', null);
    }

    const { data, error } = await query;

    if (error) {
      // Table doesn't exist yet (Stage 1 not applied)
      if (error.code === '42P01') {
        return NextResponse.json(
          { ok: false, error: 'EUR feature not yet enabled. Database schema required.' },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true, quotes: data });
  } catch (err) {
    console.error('[EUR] Failed to list quotes:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to load FX quotes' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/eur/quotes
 * Create a new FX quote (manual entry).
 * 
 * Body: { rate: string, rate_date: string, provider?: string, override_reason?: string }
 * 
 * Requires: Owner access
 * The new quote supersedes the previous active quote for the same currency.
 */
export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, 'administration');
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? 'Forbidden' },
      { status: 403 }
    );
  }

  if (!permission.actor.isOwner) {
    return NextResponse.json(
      { ok: false, error: 'Owner access required' },
      { status: 403 }
    );
  }

  const orgId = permission.actor.organizationId;
  const profileId = permission.actor.profileId;
  const supabase = createSupabaseService();

  try {
    const body = await request.json();
    const { rate, rate_date, provider, override_reason } = body;

    if (!rate || !rate_date) {
      return NextResponse.json(
        { ok: false, error: 'Rate and rate_date are required' },
        { status: 400 }
      );
    }

    // Validate rate format using the currency module
    const { parseRateToMicro } = await import('@/lib/money/currency');
    try {
      parseRateToMicro(String(rate));
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid rate format. Use decimal like "312.45"' },
        { status: 400 }
      );
    }

    // Start transaction: supersede old quote, insert new one
    // Note: Supabase JS doesn't support transactions directly;
    // this uses two sequential operations. For production, use a stored procedure.
    
    // 1. Find current active quote
    const { data: activeQuotes } = await supabase
      .from('fx_quotes')
      .select('id')
      .eq('organization_id', orgId)
      .eq('quote_currency', 'EUR')
      .is('superseded_by', null)
      .order('rate_date', { ascending: false })
      .limit(1);

    // 2. Insert new quote
    const { data: newQuote, error: insertError } = await supabase
      .from('fx_quotes')
      .insert({
        organization_id: orgId,
        base_currency: 'PKR',
        quote_currency: 'EUR',
        rate: String(rate),
        rate_date,
        source: 'manual',
        provider: provider ?? null,
        override_reason: override_reason ?? null,
        created_by_profile_id: profileId,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '42P01') {
        return NextResponse.json(
          { ok: false, error: 'EUR feature not yet enabled. Database schema required.' },
          { status: 503 }
        );
      }
      throw insertError;
    }

    // 3. Supersede old quote (if any)
    if (activeQuotes && activeQuotes.length > 0) {
      await supabase
        .from('fx_quotes')
        .update({ superseded_by: newQuote.id })
        .eq('id', activeQuotes[0].id);
    }

    return NextResponse.json({ ok: true, quote: newQuote }, { status: 201 });
  } catch (err) {
    console.error('[EUR] Failed to create quote:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to create FX quote' },
      { status: 500 }
    );
  }
}
