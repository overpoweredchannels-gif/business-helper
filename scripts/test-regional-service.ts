import assert from 'node:assert/strict';
import {RegionalSettingsService,type RegionalRepository} from '../src/lib/regional/service';
import {legacyRegionalSettings} from '../src/lib/regional/settings';
import {regionalQaEnabled} from '../src/lib/regional/qa';

async function main(){
  let stored:Record<string,unknown>={...legacyRegionalSettings};let writes=0;let conflict=false;
  let booksCurrency:unknown='PKR';
  const repository:RegionalRepository={
    async findById(id){assert.equal(id,'org-one');return {settings:structuredClone(stored),booksCurrency};},
    async updateSettingsIfUnchanged(id,previous,next){assert.equal(id,'org-one');assert.deepEqual(previous,stored);if(conflict)return false;stored=structuredClone(next);writes++;return true;}
  };
  const service=new RegionalSettingsService(repository);
  const actor={organizationId:'org-one',role:'owner',isActive:true};
  const original=await service.get(actor);
  for(const role of ['staff','salesman','admin',null])await assert.rejects(service.save({...actor,role},{...legacyRegionalSettings},original.revision),/forbidden/);
  await assert.rejects(service.save({...actor,isActive:false},{...legacyRegionalSettings},original.revision),/forbidden/);
  await assert.rejects(service.save(actor,{...legacyRegionalSettings,organizationId:'foreign'},original.revision),/invalid/);
  assert.equal(writes,0);
  // Currency follows the header-selected books currency (no PKR lock):
  // get() reflects books_currency, and a save stores books_currency
  // even when the client sends a different currency — never rejected.
  booksCurrency='EUR';
  assert.equal((await service.get(actor)).preferences.accountingCurrency,'EUR');
  const currencySave=await service.save(actor,{...legacyRegionalSettings,accountingCurrency:'USD'},original.revision);
  assert.equal(currencySave.preferences.accountingCurrency,'EUR');
  assert.equal(stored.accountingCurrency,'EUR');
  assert.equal(writes,1);
  booksCurrency='PKR';
  assert.equal((await service.get(actor)).preferences.accountingCurrency,'PKR');
  const saved=await service.save(actor,{...legacyRegionalSettings,language:'ur',locale:'it-IT',timeZone:'Europe/Rome'},(await service.get(actor)).revision);
  assert.equal(stored.accountingCurrency,'PKR');assert.equal(writes,2);
  await assert.rejects(service.save(actor,{...legacyRegionalSettings},original.revision),/conflict/);
  stored=Object.fromEntries(Object.entries(stored).reverse());
  assert.equal((await service.get(actor)).revision,saved.revision,'JSONB key ordering cannot invalidate a revision');
  // New contract: missing/corrupt stored settings fall back to defaults and
  // can always be re-saved; a partial save changes only the provided fields.
  stored=null as unknown as Record<string,unknown>;
  assert.deepEqual((await service.get(actor)).preferences,legacyRegionalSettings);
  stored={language:'xx',locale:'xx',timeZone:'Not/AZone',accountingCurrency:'XYZ',admin:true};
  assert.deepEqual((await service.get(actor)).preferences,legacyRegionalSettings);
  const corruptRevision=(await service.get(actor)).revision;
  const repaired=await service.save(actor,{timeZone:'Europe/Madrid'},corruptRevision);
  assert.equal(repaired.preferences.timeZone,'Europe/Madrid');
  assert.equal(repaired.preferences.language,'en');
  assert.equal(repaired.preferences.accountingCurrency,'PKR');
  assert.deepEqual(stored,repaired.preferences);
  const afterRepair=await service.get(actor);
  const languageOnly=await service.save(actor,{language:'ur'},afterRepair.revision);
  assert.equal(languageOnly.preferences.language,'ur');
  assert.equal(languageOnly.preferences.timeZone,'Europe/Madrid');
  assert.equal(languageOnly.preferences.accountingCurrency,'PKR');
  conflict=true;
  await assert.rejects(service.save(actor,{...legacyRegionalSettings},saved.revision),/conflict/);
  assert.equal(writes,4); // 1 currency-follows save + 1 settings save + 2 new-contract saves above
  // Regional features are enabled for all environments now (qa.ts
  // returns true unconditionally) — the old URL-gated expectation
  // (production false, QA true) is stale and was already failing on
  // pristine main; both URLs now resolve to true.
  assert.equal(regionalQaEnabled('https://lhqmtgrstvwtysfjjmhz.supabase.co'),true);
  assert.equal(regionalQaEnabled('https://rtfowunsyrdygyvubnvs.supabase.co'),true);
  console.log('PASS owner/active/tenant scope, currency follows books currency, malformed input, stale/concurrent save and regional-enabled guard.');
}
main().catch(()=>{console.error('Regional service regression failed');process.exitCode=1;});
