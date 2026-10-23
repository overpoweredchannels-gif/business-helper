/**
 * Books-currency conversion service — the seam between the HTTP route
 * and the database conversion.
 *
 * The authoritative conversion runs inside Postgres
 * (convert_organization_books_currency, see the SQL package
 * Books_Currency_Migration_2026-10-23.sql): one function call = one
 * transaction = all-or-nothing, with its own control-total
 * reconciliation before the books currency flips. This service owns
 * everything around that call:
 *   - request validation (supported currency, sane rate) BEFORE any
 *     database write is attempted;
 *   - the migration / same-currency refusals, decided from a fresh read
 *     of the org's books currency (this is also what makes a
 *     double-submit safe at the app layer: after a successful run the
 *     re-read sees the NEW currency and the repeat aborts as
 *     same-currency; the SQL function re-checks under the org row lock);
 *   - a defence-in-depth verification of the returned event's control
 *     totals. The SQL check is authoritative and aborts before commit;
 *     if this check ever fires, the SQL check has a bug — the error is
 *     books.reconciliationMismatch and it carries the committed event so
 *     the run stays auditable instead of looking like a clean abort.
 */
import { isCurrency, type Currency } from '../regional/settings';
import {
  BooksConversionError,
  parseConversionRate,
  verifyControlTotals,
  type ControlTotals,
} from './currency';

export { BooksConversionError };
export type { ControlTotals } from './currency';

export interface BooksConversionEvent {
  id: string;
  organizationId: string;
  actorProfileId: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  /** The switch rate as entered: 1 <from> = rate <to>. */
  rate: string;
  controlTotalsBefore: ControlTotals;
  controlTotalsAfter: ControlTotals;
}

export interface BooksConversionDeps {
  /** Fresh read of the org's books-currency state. */
  loadState(
    organizationId: string,
  ): Promise<{ kind: 'ready'; currency: Currency } | { kind: 'missing' }>;
  /** Runs the atomic database conversion and returns its audit event. */
  execute(input: {
    organizationId: string;
    actorProfileId: string;
    fromCurrency: Currency;
    toCurrency: Currency;
    rateText: string;
  }): Promise<BooksConversionEvent>;
}

export interface BooksConversionRequest {
  organizationId: string;
  actorProfileId: string;
  toCurrency: unknown;
  /** The entered rate: "1 <current> = rate <new>". */
  rate: unknown;
}

export async function runBooksConversion(
  deps: BooksConversionDeps,
  request: BooksConversionRequest,
): Promise<BooksConversionEvent> {
  if (!isCurrency(request.toCurrency)) {
    throw new BooksConversionError('books.currencyInvalid');
  }
  // Rate validation happens before ANY state is read or written: a bad
  // rate must never reach the database layer.
  const rate = parseConversionRate(request.rate);

  const state = await deps.loadState(request.organizationId);
  if (state.kind === 'missing') {
    throw new BooksConversionError('books.migrationMissing');
  }
  if (state.currency === request.toCurrency) {
    throw new BooksConversionError('books.sameCurrency');
  }

  const event = await deps.execute({
    organizationId: request.organizationId,
    actorProfileId: request.actorProfileId,
    fromCurrency: state.currency,
    toCurrency: request.toCurrency,
    rateText: rate.text,
  });

  const violations = verifyControlTotals(
    event.controlTotalsBefore,
    event.controlTotalsAfter,
    rate.micro,
  );
  if (violations.length > 0) {
    const error = new BooksConversionError('books.reconciliationMismatch');
    (error as BooksConversionError & { event?: BooksConversionEvent }).event = event;
    throw error;
  }
  return event;
}
