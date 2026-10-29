/**
 * Live FX rates for display-currency conversion.
 *
 * GET  /api/fx/live?currency=EUR -> { ok, currency, rate, rateDate, source, stale? }
 *      rate = PKR per 1 unit of the quote currency, taken from the public
 *      exchange-rate feed (no key, no user data sent — only the PKR base).
 *      PKR itself returns rate 1 without an upstream call.
 *
 * This is separate from /api/fx/rates, which serves owner-entered saved
 * quotes for the settings panel and EUR documents. Display conversion
 * follows the live internet rate, so the header dropdown never asks the
 * user to type a rate.
 *
 * Caching: one hour in memory. On an upstream failure a stale cached rate
 * is served with stale:true; with no cache at all the route returns 503
 * and the provider falls back to PKR rather than mislabelling amounts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/identity/authorization';
import { isCurrency } from '@/lib/regional/settings';
import { pkrPerUnitFromBaseRates } from '@/lib/fx/live-rate';

export const runtime = 'nodejs';

const UPSTREAM = 'https://open.er-api.com/v6/latest/PKR';
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

type Cached = { at: number; rate: number; rateDate: string | null };
let cache: Cached | null = null;

async function fetchLiveRate(currency: string): Promise<{ rate: number; rateDate: string | null } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(UPSTREAM, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      result?: string;
      time_last_update_utc?: string;
      rates?: Record<string, unknown>;
    };
    if (payload.result !== 'success') return null;
    const rate = pkrPerUnitFromBaseRates(payload.rates, currency as never);
    if (rate === null) return null;
    return { rate, rateDate: payload.time_last_update_utc ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, 'reports_view');
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? 'Forbidden' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const currency = (searchParams.get('currency') ?? 'EUR').toUpperCase();
  if (!isCurrency(currency)) {
    return NextResponse.json({ ok: false, error: 'Unsupported currency' }, { status: 400 });
  }
  if (currency === 'PKR') {
    return NextResponse.json({ ok: true, currency, rate: 1, rateDate: null, source: 'identity' });
  }

  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({
      ok: true, currency, rate: cache.rate, rateDate: cache.rateDate, source: 'open.er-api.com',
    });
  }

  const live = await fetchLiveRate(currency);
  if (live) {
    cache = { at: now, rate: live.rate, rateDate: live.rateDate };
    return NextResponse.json({
      ok: true, currency, rate: live.rate, rateDate: live.rateDate, source: 'open.er-api.com',
    });
  }
  if (cache) {
    return NextResponse.json({
      ok: true, currency, rate: cache.rate, rateDate: cache.rateDate, source: 'open.er-api.com', stale: true,
    });
  }
  return NextResponse.json(
    { ok: false, error: 'Live rate unavailable' },
    { status: 503 },
  );
}
