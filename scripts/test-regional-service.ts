import assert from 'node:assert/strict';
import {RegionalSettingsService,type RegionalRepository} from '../src/lib/regional/service';
import {legacyRegionalSettings} from '../src/lib/regional/settings';
import {regionalQaEnabled} from '../src/lib/regional/qa';

async function main(){
  let stored:Record<string,unknown>={...legacyRegionalSettings};let writes=0;let conflict=false;
  const repository:RegionalRepository={
    async findById(id){assert.equal(id,'org-one');return {settings:structuredClone(stored)};},
    async updateSettingsIfUnchanged(id,previous,next){assert.equal(id,'org-one');assert.deepEqual(previous,stored);if(conflict)return false;stored=structuredClone(next);writes++;return true;}
  };
  const service=new RegionalSettingsService(repository);
  const actor={organizationId:'org-one',role:'owner',isActive:true};
  const original=await service.get(actor);
  for(const role of ['staff','salesman','admin',null])await assert.rejects(service.save({...actor,role},{...legacyRegionalSettings},original.revision),/forbidden/);
  await assert.rejects(service.save({...actor,isActive:false},{...legacyRegionalSettings},original.revision),/forbidden/);
  for(const accountingCurrency of ['EUR','USD','GBP'])await assert.rejects(service.save(actor,{...legacyRegionalSettings,accountingCurrency},original.revision),/currencyLocked/);
  await assert.rejects(service.save(actor,{...legacyRegionalSettings,organizationId:'foreign'},original.revision),/invalid/);
  assert.equal(writes,0);
  const saved=await service.save(actor,{...legacyRegionalSettings,language:'ur',locale:'it-IT',timeZone:'Europe/Rome'},original.revision);
  assert.equal(stored.accountingCurrency,'PKR');assert.equal(writes,1);
  await assert.rejects(service.save(actor,{...legacyRegionalSettings},original.revision),/conflict/);
  stored=Object.fromEntries(Object.entries(stored).reverse());
  assert.equal((await service.get(actor)).revision,saved.revision,'JSONB key ordering cannot invalidate a revision');
  conflict=true;
  await assert.rejects(service.save(actor,{...legacyRegionalSettings},saved.revision),/conflict/);
  assert.equal(writes,1);
  assert.equal(regionalQaEnabled('https://lhqmtgrstvwtysfjjmhz.supabase.co'),false);
  assert.equal(regionalQaEnabled('https://rtfowunsyrdygyvubnvs.supabase.co'),true);
  console.log('PASS owner/active/tenant scope, currency lock, malformed input, stale/concurrent save and QA-only guard.');
}
main().catch(()=>{console.error('Regional service regression failed');process.exitCode=1;});
