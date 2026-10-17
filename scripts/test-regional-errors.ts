import assert from 'node:assert/strict';
import {resolveRegionalErrorText} from '../src/components/regional/RegionalSettingsPanel';
import {regionalUi} from '../src/lib/regional/ui-messages';
import {messages} from '../src/lib/regional/messages';
import type {Language} from '../src/lib/regional/settings';

const languages: Language[] = ['en', 'es', 'it', 'ur'];
for (const language of languages) {
  // No error → no alert text (and therefore no false success either).
  assert.equal(resolveRegionalErrorText(null, language), null);
  // The unavailable-persistence path must surface the exact QA message.
  assert.equal(resolveRegionalErrorText('persistenceUnavailable', language), regionalUi[language].persistenceUnavailable);
  assert.equal(resolveRegionalErrorText('regional.persistenceUnavailable', language), regionalUi[language].persistenceUnavailable);
  assert.ok(regionalUi[language].persistenceUnavailable.length > 0);
  // Load / save / conflict paths.
  assert.equal(resolveRegionalErrorText('loadError', language), regionalUi[language].loadError);
  assert.equal(resolveRegionalErrorText('saveError', language), regionalUi[language].saveError);
  assert.equal(resolveRegionalErrorText('regional.conflict', language), regionalUi[language].conflict);
  // Catalogued validation keys resolve through the message catalog.
  assert.equal(resolveRegionalErrorText('regional.currencyLocked', language), messages[language]['regional.currencyLocked']);
  assert.equal(resolveRegionalErrorText('regional.languageInvalid', language), messages[language]['regional.languageInvalid']);
  // Unknown / forbidden codes fall back to the generic save error — never blank, never success.
  // (Empty string means "no error" and correctly yields no alert text.)
  for (const code of ['regional.forbidden', 'regional.notFound', 'bogus-code']) {
    const text = resolveRegionalErrorText(code, language);
    assert.ok(text && text.trim().length > 0, `blank message for ${code}`);
    assert.equal(text, regionalUi[language].saveError);
  }
}
console.log('PASS regional error mapping: unavailable/load/save/conflict/currency-locked in all four languages; unknown codes never blank.');
