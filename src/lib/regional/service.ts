import {createHash} from 'node:crypto';
import {parseRegionalSettings,sanitizeRegionalSettings,isCurrency,type RegionalSettings,type Currency} from './settings';

type Actor={organizationId:string;role:string|null;isActive:boolean};
export interface RegionalRepository {
  findById(id:string):Promise<{settings?:Record<string,unknown>|null;booksCurrency?:unknown}|null>;
  updateSettingsIfUnchanged(id:string,previous:Record<string,unknown>|null,next:Record<string,unknown>):Promise<boolean>;
}
/** The accounting currency follows the header currency switch (the single
 * control for Books + Display currency). It is derived from the org's
 * books_currency, never from a separately stored or forced value. */
function booksCurrencyOf(org:{booksCurrency?:unknown}|null):Currency|null{
  return org&&isCurrency(org.booksCurrency)?org.booksCurrency:null;
}
function revision(settings:Record<string,unknown>|null){return createHash('sha256').update(JSON.stringify(settings===null?null:Object.fromEntries(Object.entries(settings).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');}
function read(settings:Record<string,unknown>|null):RegionalSettings{
  // Missing, null or malformed stored settings fall back per field to the
  // app's existing defaults; a corrupt stored object must never block
  // reading preferences or re-saving them.
  return sanitizeRegionalSettings(settings);
}
export class RegionalSettingsService {
  constructor(private readonly repository:RegionalRepository){}
  async get(actor:Actor){
    if(!actor.organizationId||!actor.isActive)throw new Error('regional.forbidden');
    const org=await this.repository.findById(actor.organizationId);
    if(!org)throw new Error('regional.notFound');
    const settings=org.settings??null;
    const preferences=read(settings);
    // The currency field reflects the header-selected books currency.
    // A stale stored value (or a never-set books currency) falls back to
    // the stored/sanitized value, never to a forced PKR.
    const books=booksCurrencyOf(org);
    if(books)preferences.accountingCurrency=books;
    return {preferences,revision:revision(settings),currencyWriteEnabled:false};
  }
  async save(actor:Actor,input:unknown,expectedRevision:unknown){
    if(!actor.organizationId||!actor.isActive||actor.role!=='owner')throw new Error('regional.forbidden');
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('regional.invalid');
    const provided=input as Record<string,unknown>;
    if(Object.keys(provided).some(key=>!['language','locale','timeZone','accountingCurrency'].includes(key)))throw new Error('regional.invalid');
    const org=await this.repository.findById(actor.organizationId);
    if(!org)throw new Error('regional.notFound');
    const previous=org.settings??null;
    // Per-field merge over the sanitized stored values: only provided
    // fields change, so changing one setting never resets the others,
    // and a corrupt stored object can always be repaired by saving.
    // Provided fields are validated strictly (parseRegionalSettings
    // throws the per-field code) — a malformed provided value is
    // rejected, never written. The accounting currency is NOT a
    // separately editable field: it follows the header currency switch,
    // so the stored value is always the org's books currency (when the
    // org has one). There is no PKR lock and no currency rejection.
    const preferences=parseRegionalSettings({...sanitizeRegionalSettings(previous),...provided});
    const books=booksCurrencyOf(org);
    if(books)preferences.accountingCurrency=books;
    if(typeof expectedRevision!=='string'||expectedRevision!==revision(previous))throw new Error('regional.conflict');
    const next={...preferences};
    if(!await this.repository.updateSettingsIfUnchanged(actor.organizationId,previous,next))throw new Error('regional.conflict');
    return {preferences,revision:revision(next),currencyWriteEnabled:false};
  }
}
