export const languages = ['en', 'es', 'it', 'ur'] as const;
export type Language = typeof languages[number];
export const locales = ['en-PK', 'en-US', 'en-GB', 'es-ES', 'it-IT', 'ur-PK'] as const;
export type RegionalLocale = typeof locales[number];

// Extend only with reviewed accounting precision; Intl alone accepts invented codes.
export const currencies = {
  PKR: { digits: 2, name: 'Pakistani rupee' },
  EUR: { digits: 2, name: 'Euro' },
  USD: { digits: 2, name: 'US dollar' },
  GBP: { digits: 2, name: 'Pound sterling' },
  AED: { digits: 2, name: 'UAE dirham' },
  SAR: { digits: 2, name: 'Saudi riyal' },
  JPY: { digits: 0, name: 'Japanese yen' },
  KWD: { digits: 3, name: 'Kuwaiti dinar' },
} as const;
export type Currency = keyof typeof currencies;
export type RegionalSettings = {
  language: Language;
  locale: RegionalLocale;
  timeZone: string;
  accountingCurrency: Currency;
};
export const legacyRegionalSettings: Readonly<RegionalSettings> = Object.freeze({
  language: 'en', locale: 'en-PK', timeZone: 'Asia/Karachi', accountingCurrency: 'PKR',
});
export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.hasOwn(currencies, value);
}
export function direction(language: Language): 'rtl' | 'ltr' { return language === 'ur' ? 'rtl' : 'ltr'; }

/** Display locale for dates/times in the selected UI language. Timezone handling
 * is intentionally untouched — callers must not pass a timeZone option here. */
export function localeFor(language: Language): string {
  switch (language) {
    case 'es': return 'es-ES';
    case 'it': return 'it-IT';
    case 'ur': return 'ur-PK';
    default: return 'en-PK';
  }
}

/** Canonical browser-language cookie parsing, shared by the pre-paint bootstrap
 * and the React provider. Accepts exactly the supported language codes;
 * encoded, malformed, empty or unknown values fall back to null (English/LTR).
 * Values are matched literally — never decoded — so both paths resolve identically. */
export function parseLanguageCookie(cookie: string): Language | null {
  for (const part of cookie.split(';')) {
    const trimmed = part.replace(/^\s+/, '');
    if (trimmed.startsWith('tradeos-ui-language=')) {
      const value = trimmed.slice('tradeos-ui-language='.length);
      return (languages as readonly string[]).includes(value) ? (value as Language) : null;
    }
  }
  return null;
}

/** Canonical display-currency cookie parsing, mirroring parseLanguageCookie.
 * Accepts exactly the supported currency codes; anything else falls back to null (PKR). */
export function parseCurrencyCookie(cookie: string): Currency | null {
  for (const part of cookie.split(';')) {
    const trimmed = part.replace(/^\s+/, '');
    if (trimmed.startsWith('tradeos-ui-currency=')) {
      const value = trimmed.slice('tradeos-ui-currency='.length);
      return isCurrency(value) ? value : null;
    }
  }
  return null;
}

/** Pre-paint bootstrap: applies the saved browser language's lang/dir before first
 * paint so Urdu users never see an LTR flash. Mirrors DISPLAY_ZOOM_BOOTSTRAP_SCRIPT.
 * Parsing mirrors parseLanguageCookie exactly (no decoding); the cookie is only
 * written when the regional QA gate is enabled, and layout.tsx only inlines this
 * script behind the same gate. */
export const LANGUAGE_BOOTSTRAP_SCRIPT = `try{var lang=null;var parts=document.cookie.split(';');for(var i=0;i<parts.length;i++){var p=parts[i].replace(/^\\s+/,'');if(p.indexOf('tradeos-ui-language=')===0){var v=p.substring(p.indexOf('=')+1);if(v==='en'||v==='es'||v==='it'||v==='ur'){lang=v;}break;}}if(lang==='ur'){document.documentElement.lang='ur';document.documentElement.dir='rtl';}else if(lang==='es'){document.documentElement.lang='es';document.documentElement.dir='ltr';}else if(lang==='it'){document.documentElement.lang='it';document.documentElement.dir='ltr';}}catch(e){}`;

export function parseRegionalSettings(input: unknown): RegionalSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('regional.invalid');
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some(k => !['language','locale','timeZone','accountingCurrency'].includes(k))) throw new Error('regional.invalid');
  if (!languages.includes(v.language as Language)) throw new Error('regional.languageInvalid');
  if (!locales.includes(v.locale as RegionalLocale)) throw new Error('regional.localeInvalid');
  if (!isCurrency(v.accountingCurrency)) throw new Error('regional.currencyInvalid');
  if (typeof v.timeZone !== 'string' || !v.timeZone.trim()) throw new Error('regional.timeZoneInvalid');
  try { new Intl.DateTimeFormat('en', { timeZone: v.timeZone }).format(0); }
  catch { throw new Error('regional.timeZoneInvalid'); }
  return { language: v.language as Language, locale: v.locale as RegionalLocale, timeZone: v.timeZone, accountingCurrency: v.accountingCurrency };
}

/** Pure rule only. Persistence must enforce this atomically with transaction creation. */
export function assertAccountingCurrencyUnchanged(current: Currency, next: Currency) {
  if (!isCurrency(current) || !isCurrency(next)) throw new Error('regional.currencyInvalid');
  if (current !== next) throw new Error('regional.currencyLocked');
}
