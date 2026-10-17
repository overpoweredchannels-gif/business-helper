import type { RegionalLocale } from './settings';

/** Calendar dates (invoice dates) never move across timezone boundaries. */
export function formatCalendarDate(value: string, locale: RegionalLocale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('date.invalid');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error('date.invalid');
  return new Intl.DateTimeFormat(locale, {year:'numeric',month:'short',day:'2-digit',timeZone:'UTC'}).format(date);
}

/** Events require an explicit offset and the business's display timezone. */
export function formatEventTime(value: string, locale: RegionalLocale, timeZone: string): string {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('date.offsetRequired');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('date.invalid');
  return new Intl.DateTimeFormat(locale,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone}).format(date);
}
