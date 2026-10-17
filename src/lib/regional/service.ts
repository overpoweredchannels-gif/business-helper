import {createHash} from 'node:crypto';
import {parseRegionalSettings,assertAccountingCurrencyUnchanged,type RegionalSettings} from './settings';

type Actor={organizationId:string;role:string|null;isActive:boolean};
export interface RegionalRepository {
  findById(id:string):Promise<{settings?:Record<string,unknown>|null}|null>;
  updateSettingsIfUnchanged(id:string,previous:Record<string,unknown>|null,next:Record<string,unknown>):Promise<boolean>;
}
function revision(settings:Record<string,unknown>|null){return createHash('sha256').update(JSON.stringify(settings===null?null:Object.fromEntries(Object.entries(settings).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');}
function read(settings:Record<string,unknown>|null):RegionalSettings{
  if(!settings)throw new Error('regional.persistenceUnavailable');
  const parsed=parseRegionalSettings(settings);
  // Until document currencies and all writers are migrated, PKR is the only
  // operational currency. Never trust arbitrary JSON as a currency authority.
  assertAccountingCurrencyUnchanged('PKR',parsed.accountingCurrency);
  return parsed;
}
export class RegionalSettingsService {
  constructor(private readonly repository:RegionalRepository){}
  async get(actor:Actor){
    if(!actor.organizationId||!actor.isActive)throw new Error('regional.forbidden');
    const org=await this.repository.findById(actor.organizationId);
    if(!org)throw new Error('regional.notFound');
    const settings=org.settings??null;
    return {preferences:read(settings),revision:revision(settings),currencyWriteEnabled:false};
  }
  async save(actor:Actor,input:unknown,expectedRevision:unknown){
    if(!actor.organizationId||!actor.isActive||actor.role!=='owner')throw new Error('regional.forbidden');
    const preferences=parseRegionalSettings(input);
    assertAccountingCurrencyUnchanged('PKR',preferences.accountingCurrency);
    const org=await this.repository.findById(actor.organizationId);
    if(!org)throw new Error('regional.notFound');
    const previous=org.settings??null;
    read(previous); // Corrupt/unsupported stored settings cannot be silently overwritten.
    if(typeof expectedRevision!=='string'||expectedRevision!==revision(previous))throw new Error('regional.conflict');
    const next={...preferences};
    if(!await this.repository.updateSettingsIfUnchanged(actor.organizationId,previous,next))throw new Error('regional.conflict');
    return {preferences,revision:revision(next),currencyWriteEnabled:false};
  }
}
