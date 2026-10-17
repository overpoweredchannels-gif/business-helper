import assert from 'node:assert/strict';
import {LANGUAGE_BOOTSTRAP_SCRIPT, parseLanguageCookie, direction} from '../src/lib/regional/settings';
import type {Language} from '../src/lib/regional/settings';

// Effective document state after the bootstrap script runs on a fresh page
// (default <html lang="en"> with implicit LTR).
function bootstrap(cookie: string): {lang: string; dir: string} {
  const documentElement = {lang: 'en', dir: 'ltr'};
  new Function('document', LANGUAGE_BOOTSTRAP_SCRIPT)({documentElement, cookie});
  return documentElement;
}

type Case = {cookie: string; expected: Language | null};
const cases: Case[] = [
  // All four supported languages.
  {cookie: 'tradeos-ui-language=en', expected: 'en'},
  {cookie: 'tradeos-ui-language=es', expected: 'es'},
  {cookie: 'tradeos-ui-language=it', expected: 'it'},
  {cookie: 'tradeos-ui-language=ur', expected: 'ur'},
  // Cookie ordering: first tradeos-ui-language wins; position among others is free.
  {cookie: 'other=1; tradeos-ui-language=ur', expected: 'ur'},
  {cookie: 'tradeos-ui-language=ur; other=1', expected: 'ur'},
  {cookie: 'a=1; b=2; tradeos-ui-language=es; c=3', expected: 'es'},
  // Separator whitespace variants.
  {cookie: 'a=1;tradeos-ui-language=ur', expected: 'ur'},
  {cookie: 'a=1;  tradeos-ui-language=ur', expected: 'ur'},
  {cookie: 'a=1;\ttradeos-ui-language=it', expected: 'it'},
  // Missing / empty / unknown values fall back to English.
  {cookie: '', expected: null},
  {cookie: 'other=1', expected: null},
  {cookie: 'tradeos-ui-language=', expected: null},
  {cookie: 'tradeos-ui-language=xx', expected: null},
  {cookie: 'tradeos-ui-language=UR', expected: null},
  {cookie: 'tradeos-ui-language=urdu', expected: null},
  {cookie: 'tradeos-ui-language=ur ', expected: null},
  {cookie: 'tradeos-ui-language=ur=extra', expected: null},
  // Encoded values are NOT decoded: they fall back to English in both paths.
  {cookie: 'tradeos-ui-language=%75%72', expected: null}, // "ur" percent-encoded
  {cookie: 'tradeos-ui-language=%65%73', expected: null}, // "es" percent-encoded
  // Malformed encoding falls back to English in both paths (no throw).
  {cookie: 'tradeos-ui-language=%', expected: null},
  {cookie: 'tradeos-ui-language=%ZZ', expected: null},
  {cookie: 'tradeos-ui-language=%2', expected: null},
];

for (const {cookie, expected} of cases) {
  // Path 1: the shared parser used by RegionalProvider.
  assert.equal(parseLanguageCookie(cookie), expected, `parseLanguageCookie(${JSON.stringify(cookie)})`);
  // Path 2: the pre-paint bootstrap script.
  const {lang, dir} = bootstrap(cookie);
  const effectiveLang = expected ?? 'en';
  assert.equal(lang, effectiveLang, `bootstrap lang for ${JSON.stringify(cookie)}`);
  // Both paths must resolve to the same effective language AND direction.
  assert.equal(dir, direction(effectiveLang), `bootstrap dir for ${JSON.stringify(cookie)}`);
}
console.log(`PASS cookie parity: ${cases.length} cases resolve identically in parser and bootstrap (encoded/malformed → English/LTR).`);
