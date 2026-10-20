/**
 * FX rates for display-currency conversion.
 *
 * GET  /api/fx/rates?currency=EUR -> latest active owner-entered rate
 *      (rate = PKR per 1 unit of the quote currency). { ok, currency, rate, rateDate }
 * POST /api/fx/rates { currency, rate } -> owner-only; inserts a new quote and
 *      supersedes the previous active one for that currency.
 *
 * Storage: fx_quotes (Stage 1 schema). Returns 503 when the table is absent so
 * the UI can show "rates not set up" instead of failing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/identity/authorization';
import { createSupabaseService } from '@/lib/supabase/server';
import { isCurrency } from '@/lib/regional/settings';

export const runtime = 'nodejs';

function schemaMissing(error: { code?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, 'reports_view');
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? 'Forbidden' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const currency = (searchParams.get('currency') ?? 'EUR').toUpperCase();
  if (!isCurrency(currency) || currency === 'PKR') {
    return NextResponse.json(
      { ok: false, error: 'Unsupported currency' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseService();
  const { data, error } = await supabase
    .from('fx_quotes')
    .select('rate, rate_date, created_at')
    .eq('organization_id', permission.actor.organizationId)
    .eq('base_currency', 'PKR')
    .eq('quote_currency', currency)
    .is('superseded_by', null)
    .order('rate_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    if (schemaMissing(error)) {
      return NextResponse.json(
        { ok: false, error: 'FX rates are not set up yet (database schema required).' },
        { status: 503 }
      );
    }
    console.error('[FX] Failed to load rate:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to load FX rate' },
      { status: 500 }
    );
  }

  const latest = data?.[0];
  return NextResponse.json({
    ok: true,
    currency,
    rate: latest ? String(latest.rate) : null,
    rateDate: latest ? latest.rate_date : null,
  });
}

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

  let body: { currency?: unknown; rate?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : '';
  if (!isCurrency(currency) || currency === 'PKR') {
    return NextResponse.json({ ok: false, error: 'Unsupported currency' }, { status: 400 });
  }

  const { parseRateToMicro } = await import('@/lib/money/currency');
  try {
    parseRateToMicro(String(body.rate ?? ''));
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid rate format. Use a decimal like "312.45"' },
      { status: 400 }
    );
  }
  const rate = String(body.rate);

  const supabase = createSupabaseService();
  const rateDate = new Date().toISOString().slice(0, 10);

  const { data: activeQuotes, error: activeError } = await supabase
    .from('fx_quotes')
    .select('id')
    .eq('organization_id', orgId)
    .eq('base_currency', 'PKR')
    .eq('quote_currency', currency)
    .is('superseded_by', null)
    .order('rate_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (activeError) {
    if (schemaMissing(activeError)) {
      return NextResponse.json(
        { ok: false, error: 'FX rates are not set up yet (database schema required).' },
        { status: 503 }
      );
    }
    console.error('[FX] Failed to read active quote:', activeError);
    return NextResponse.json({ ok: false, error: 'Failed to save FX rate' }, { status: 500 });
  }

  const { data: newQuote, error: insertError } = await supabase
    .from('fx_quotes')
    .insert({
      organization_id: orgId,
      base_currency: 'PKR',
      quote_currency: currency,
      rate,
      rate_date: rateDate,
      source: 'manual',
      created_by_profile_id: profileId,
    })
    .select()
    .single();

  if (insertError) {
    if (schemaMissing(insertError)) {
      return NextResponse.json(
        { ok: false, error: 'FX rates are not set up yet (database schema required).' },
        { status: 503 }
      );
    }
    console.error('[FX] Failed to insert quote:', insertError);
    return NextResponse.json({ ok: false, error: 'Failed to save FX rate' }, { status: 500 });
  }

  if (activeQuotes && activeQuotes.length > 0) {
    await supabase
      .from('fx_quotes')
      .update({ superseded_by: newQuote.id })
      .eq('id', activeQuotes[0].id);
  }

  return NextResponse.json(
    { ok: true, currency, rate: String(newQuote.rate), rateDate: newQuote.rate_date },
    { status: 201 }
  );
}
