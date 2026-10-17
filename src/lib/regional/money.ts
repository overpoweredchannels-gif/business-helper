import { currencies, isCurrency, type Currency, type RegionalLocale } from './settings';

/** Canonical decimal input, never a localized string or binary-float calculation.
 * Quantize once at the declared monetary boundary, half away from zero.
 * Does not calculate tax, exchange rates, or change any stored transaction.
 */
export function decimalToMinor(value: string, currency: Currency): bigint {
  if (!isCurrency(currency)) throw new Error('regional.currencyInvalid');
  if (typeof value !== 'string' || value.length > 120 || !/^-?\d+(\.\d+)?$/.test(value)) throw new Error('money.invalid');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const digits = currencies[currency].digits;
  const factor = BigInt(10) ** BigInt(digits);
  let minor = BigInt(whole) * factor + BigInt(fraction.slice(0, digits).padEnd(digits, '0') || '0');
  if (Number(fraction[digits] ?? '0') >= 5) minor += BigInt(1);
  return negative && minor !== BigInt(0) ? -minor : minor;
}

/** Render an explicit document currency. Never read a business default here. */
export function formatMinor(minor: bigint, currency: Currency, locale: RegionalLocale): string {
  if (!isCurrency(currency)) throw new Error('regional.currencyInvalid');
  const digits = currencies[currency].digits;
  const factor = BigInt(10) ** BigInt(digits);
  const negative = minor < BigInt(0);
  const absolute = negative ? -minor : minor;
  const whole = absolute / factor;
  const signed = negative ? (whole === BigInt(0) ? -0 : -whole) : whole;
  const fraction = (absolute % factor).toString().padStart(digits, '0');
  const digitFormatter = new Intl.NumberFormat(locale, { useGrouping: false });
  const localizedFraction = [...fraction].map(d => digitFormatter.format(Number(d))).join('');
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, currencyDisplay: 'code',
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).formatToParts(signed).map(p => p.type === 'fraction' ? localizedFraction : p.value).join('');
}

export type DocumentMoney = Readonly<{ amount: string; currency: Currency }>;
export function formatDocumentMoney(document: DocumentMoney, locale: RegionalLocale) {
  return formatMinor(decimalToMinor(document.amount, document.currency), document.currency, locale);
}
