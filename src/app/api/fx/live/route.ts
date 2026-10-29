/**
 * Live FX rates for display-currency conversion.
 *
 * GET  /api/fx/live?currency=EUR -> { ok, currency, rate, rateDate, source, perPkr, stale? }
 *      rate = PKR per 1 unit of the quote currency, taken from the public
 *      exchange-rate feed (no key, no user data sent — only the PKR base).
 *      perPkr = the upstream quotes for the app's 8 currencies, so the
 *      header switch can compute the books-switch rate for any pair.
 *
 * This is separate from /api/fx/rates, which serves owner-entered saved
 * quotes for the settings panel and EUR documents. The header switch
 * follows the live internet rate, so it never asks the user to type one.
 *
 * Caching: one hour in memory, one table for all currencies. On an
 * upstream failure a stale cached table is served with stale:true; with
 * no cache at all the route returns 503 and callers must not convert.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/identity/authorization';
import { isCurrency, type Currency } from '@/lib/regional/settings';
import { perPkrMapFromBaseRates, pkrPerUnitFromBaseRates } from '@/lib/fx/live-rate';

export const runtime = 'nodejs';

const UPSTREAM = 'https://open.er-api.com/v6/latest/PKR';
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

// One cached table serves every currency: the previous single-rate slot
// answered a GBP request with the cached EUR rate inside the hour.
// perPkr carries the raw upstream quotes so the header switch can also
// compute the books-switch rate (1 <from> = perPkr[to] / perPkr[from]
// <to>) without a second fetch.
type Cached = {
  at: number;
  rateDate: string | null;
  perPkr: Partial<Record<Currency, number>>;
};
let cache: Cached | null = null;

async function fetchLiveTable(): Promise<{ rateDate: string | null; perPkr: Partial<Record<Currency, number>> } | null> {
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
    return { rateDate: payload.time_last_update_utc ?? null, perPkr: perPkrMapFromBaseRates(payload.rates) };
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

  const now = Date.now();
  let table: Cached | null = null;
  let stale = false;
  if (cache && now - cache.at < CACHE_TTL_MS) {
    table = cache;
  } else {
    const live = await fetchLiveTable();
    if (live) {
      cache = { at: now, rateDate: live.rateDate, perPkr: live.perPkr };
      table = cache;
    } else if (cache) {
      table = cache;
      stale = true;
    }
  }
  if (!table) {
    return NextResponse.json(
      { ok: false, error: 'Live rate unavailable' },
      { status: 503 },
    );
  }
  const rate = pkrPerUnitFromBaseRates(
    table.perPkr as Record<string, unknown>,
    currency as Currency,
  );
  if (rate === null) {
    return NextResponse.json(
      { ok: false, error: 'Live rate unavailable' },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true, currency, rate, rateDate: table.rateDate, source: 'open.er-api.com',
    perPkr: table.perPkr, ...(stale ? { stale: true } : {}),
  });
}
