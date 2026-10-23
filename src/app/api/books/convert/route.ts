/**
 * Books-currency switch.
 *
 * POST /api/books/convert { toCurrency, rate } -> owner-only. Converts
 * every stored amount in the owner's organization from its current
 * books currency to `toCurrency` at the entered switch rate
 * ("1 <current> = rate <new>") and flips organizations.books_currency.
 *
 * The conversion itself is ONE atomic Postgres function
 * (convert_organization_books_currency — see the SQL package
 * Books_Currency_Migration_2026-10-23.sql): all updates, the
 * control-total reconciliation, the currency flip and the audit event
 * commit or roll back together. This route owns authentication,
 * validation and error mapping only.
 *
 * Until the migration runs, the endpoint answers 503
 * (books.migrationMissing) and the app behaves exactly as before.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/identity/authorization';
import { createSupabaseService } from '@/lib/supabase/server';
import { resolveBooksCurrency } from '@/lib/books/currency';
import {
  BooksConversionError,
  runBooksConversion,
  type BooksConversionDeps,
  type BooksConversionEvent,
  type ControlTotals,
} from '@/lib/books/service';

export const runtime = 'nodejs';

const STATUS_BY_CODE: Record<string, number> = {
  'books.currencyInvalid': 400,
  'books.invalidRate': 400,
  'books.sameCurrency': 409,
  'books.unmappedColumn': 409,
  'books.forbidden': 403,
  'books.organizationNotFound': 404,
  'books.migrationMissing': 503,
  'books.reconciliationFailed': 422,
  // The SQL reconciliation is authoritative and pre-commit; this code
  // means the app-side re-verification disagreed AFTER a commit. The
  // event id is returned so the run stays auditable.
  'books.reconciliationMismatch': 500,
};

function errorResponse(code: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, error: code, code, ...extra },
    { status: STATUS_BY_CODE[code] ?? 500 },
  );
}

/** Map a PostgREST / Postgres error from the conversion call to a
 * books.* code. The function raises named books.* exceptions; missing
 * schema surfaces as 42703 (column), 42883 / PGRST202 (function). */
function mapDatabaseError(error: { code?: string; message?: string }): BooksConversionError {
  const message = error?.message ?? '';
  const named = /books\.[a-zA-Z]+(?::[a-z_]+\.[a-z_]+)?/.exec(message);
  if (named) return new BooksConversionError(named[0]);
  if (
    error?.code === '42703' ||
    error?.code === '42883' ||
    error?.code === 'PGRST202' ||
    error?.code === 'PGRST205' ||
    error?.code === '42P01'
  ) {
    return new BooksConversionError('books.migrationMissing');
  }
  if (error?.code === '42501') return new BooksConversionError('books.forbidden');
  console.error('[books] conversion failed:', error);
  return new BooksConversionError('books.conversionFailed');
}

function normalizeTotals(raw: unknown): ControlTotals {
  const totals: ControlTotals = {};
  if (raw && typeof raw === 'object') {
    for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
      const e = (entry ?? {}) as { total?: unknown; units?: unknown };
      totals[name] = {
        total: String(e.total ?? '0'),
        units: Number(e.units ?? 0) || 0,
      };
    }
  }
  return totals;
}

export async function POST(request: NextRequest) {
  const permission = await requirePermission(request, 'administration');
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json(
      { ok: false, error: permission.reason ?? 'Forbidden' },
      { status: 403 },
    );
  }
  if (!permission.actor.isOwner) {
    return NextResponse.json(
      { ok: false, error: 'Owner access required', code: 'books.forbidden' },
      { status: 403 },
    );
  }

  const orgId = permission.actor.organizationId;
  const profileId = permission.actor.profileId;

  let body: { toCurrency?: unknown; rate?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  const rateText =
    typeof body.rate === 'string' ? body.rate : typeof body.rate === 'number' ? String(body.rate) : '';

  const supabase = createSupabaseService();

  const deps: BooksConversionDeps = {
    async loadState(organizationId) {
      const { data, error } = await supabase
        .from('organizations')
        .select('books_currency, regional_preferences')
        .eq('id', organizationId)
        .maybeSingle();
      if (error) {
        if (error.code === '42703' || error.message?.includes('books_currency')) {
          return { kind: 'missing' };
        }
        console.error('[books] failed to read organization:', error);
        throw new BooksConversionError('books.conversionFailed');
      }
      if (!data) throw new BooksConversionError('books.organizationNotFound');
      return {
        kind: 'ready',
        currency: resolveBooksCurrency(data.books_currency, data.regional_preferences),
      };
    },
    async execute(input) {
      const { data, error } = await supabase.rpc('convert_organization_books_currency', {
        p_organization_id: input.organizationId,
        p_actor_profile_id: input.actorProfileId,
        p_new_currency: input.toCurrency,
        p_rate: input.rateText,
      });
      if (error) throw mapDatabaseError(error);
      const raw = (data ?? {}) as Record<string, unknown>;
      const event: BooksConversionEvent = {
        id: String(raw.id ?? ''),
        organizationId: String(raw.organizationId ?? input.organizationId),
        actorProfileId: String(raw.actorProfileId ?? input.actorProfileId),
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate: String(raw.rate ?? input.rateText),
        controlTotalsBefore: normalizeTotals(raw.controlTotalsBefore),
        controlTotalsAfter: normalizeTotals(raw.controlTotalsAfter),
      };
      return event;
    },
  };

  try {
    const event = await runBooksConversion(deps, {
      organizationId: orgId,
      actorProfileId: profileId,
      toCurrency: typeof body.toCurrency === 'string' ? body.toCurrency.toUpperCase() : body.toCurrency,
      rate: rateText,
    });
    return NextResponse.json({ ok: true, event });
  } catch (err) {
    if (err instanceof BooksConversionError) {
      const withEvent = err as BooksConversionError & { event?: BooksConversionEvent };
      return errorResponse(err.code, withEvent.event ? { event: withEvent.event } : undefined);
    }
    console.error('[books] conversion failed:', err);
    return errorResponse('books.conversionFailed');
  }
}
