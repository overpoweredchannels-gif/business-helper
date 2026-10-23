import type { RegionalLocale } from './settings';

/** Calendar dates (invoice dates) never move across timezone boundaries. */
export function formatCalendarDate(value: string, locale: RegionalLocale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('date.invalid');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error('date.invalid');
  return new Intl.DateTimeFormat(locale, {year:'numeric',month:'short',day:'2-digit',timeZone:'UTC'}).format(date);
}

const CALENDAR_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Reduce a stored value to its calendar day (`YYYY-MM-DD`), or null when it
 * carries none. A date-only string is returned as-is; a timestamp-shaped
 * value (e.g. an ISO instant that landed in a date column) is reduced to
 * its literal leading date — the day as recorded in the value (for a `Z`
 * timestamp that is the UTC day). The date must be a real calendar day:
 * `2026-02-30` yields null, never a rolled-over March date.
 */
export function calendarDateOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = CALENDAR_DATE_PREFIX.exec(value.trim());
  if (!match) return null;
  const day = match[1];
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  return day;
}

/**
 * The calendar day a record belongs to: the first of `values` that carries
 * a valid calendar date wins. Callers pass the stored calendar date first
 * and the creation instant second, so the instant is only a fallback for
 * records that genuinely have no calendar date — a record is never grouped
 * or counted under its creation day while it has a calendar date of its own.
 */
export function calendarDayOfRecord(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const day = calendarDateOf(value);
    if (day) return day;
  }
  return null;
}

/** Events require an explicit offset and the business's display timezone. */
export function formatEventTime(value: string, locale: RegionalLocale, timeZone: string): string {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('date.offsetRequired');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('date.invalid');
  return new Intl.DateTimeFormat(locale,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone}).format(date);
}
