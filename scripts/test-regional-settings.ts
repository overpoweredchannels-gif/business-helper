import assert from 'node:assert/strict';
import { currencies, direction, legacyRegionalSettings, parseRegionalSettings, assertAccountingCurrencyUnchanged } from '../src/lib/regional/settings';
import { decimalToMinor, formatMinor, formatDocumentMoney } from '../src/lib/regional/money';
import { messages } from '../src/lib/regional/messages';
import { formatCalendarDate, formatEventTime } from '../src/lib/regional/dates';

for (const currency of ['PKR','EUR','USD','GBP'] as const) {
  assert.equal(decimalToMinor('1.005', currency), BigInt(101));
  assert.equal(decimalToMinor('-1.005', currency), BigInt(-101));
  assert.equal(decimalToMinor('0', currency), BigInt(0));
  assert.ok(formatDocumentMoney({ amount: '1234.56', currency }, 'es-ES').includes(currency));
}
assert.equal(decimalToMinor('1.5','JPY'),BigInt(2));
assert.equal(decimalToMinor('1.2345','KWD'),BigInt(1235));
assert.equal(decimalToMinor('-0.001','PKR'),BigInt(0));
assert.ok(formatMinor(BigInt(-1),'EUR','es-ES').includes('-0,01'));
assert.ok(formatMinor(BigInt('123456789012345678901'),'USD','en-US').includes('1,234,567,890,123,456,789.01'));
for (const invalid of ['NaN','Infinity','1,25','1e2','', ' 1.0', '--1']) assert.throws(()=>decimalToMinor(invalid,'EUR'));
for(const language of ['en','es','it','ur'] as const) {
  const settings=parseRegionalSettings({...legacyRegionalSettings,language});
  assert.equal(settings.accountingCurrency,'PKR');
  assert.equal(settings.locale,'en-PK'); // language cannot silently change financial preferences
  assert.deepEqual(Object.keys(messages[language]).sort(),Object.keys(messages.en).sort());
  assert.ok(Object.values(messages[language]).every(s=>s.trim()));
}
assert.equal(direction('ur'),'rtl'); assert.equal(direction('es'),'ltr');
assert.throws(()=>parseRegionalSettings({...legacyRegionalSettings,accountingCurrency:'XYZ'}));
assert.throws(()=>parseRegionalSettings({...legacyRegionalSettings,timeZone:'Not/AZone'}));
assert.throws(()=>parseRegionalSettings({...legacyRegionalSettings,admin:true}));
assertAccountingCurrencyUnchanged('PKR','PKR');
assert.throws(()=>assertAccountingCurrencyUnchanged('PKR','EUR'));
const old=Object.freeze({amount:'100.00',currency:'PKR' as const});
for(const locale of ['es-ES','it-IT','ur-PK'] as const) assert.ok(formatDocumentMoney(old,locale).includes('PKR'));
assert.equal(old.amount,'100.00'); assert.equal(old.currency,'PKR');
assert.equal(currencies.GBP.digits,2);
assert.ok(formatCalendarDate('2026-01-01','en-US').includes('01'));
assert.throws(()=>formatCalendarDate('2026-02-30','es-ES'));
assert.doesNotThrow(()=>formatCalendarDate('2024-02-29','it-IT'));
assert.throws(()=>formatEventTime('2026-01-01T00:00:00','en-US','Asia/Karachi'));
assert.notEqual(formatEventTime('2026-01-01T00:00:00Z','en-US','Asia/Karachi'),formatEventTime('2026-01-01T00:00:00Z','en-US','Europe/Madrid'));
console.log('PASS regional catalogs, independent settings, decimal rounding, historical currency and precision controls.');
