import {createSupabaseService} from '@/lib/supabase/server';
import type {RegionalRepository} from './service';
export class RegionalPreferencesRepository implements RegionalRepository {
  async findById(id:string){
    const {data,error}=await createSupabaseService().from('organizations').select('regional_preferences').eq('id',id).single();
    if(error)throw new Error('regional.persistenceUnavailable');
    return data?{settings:data.regional_preferences as Record<string,unknown>}:null;
  }
  async updateSettingsIfUnchanged(id:string,previous:Record<string,unknown>|null,next:Record<string,unknown>){
    // A SQL NULL stored value never equals anything — not even the JSON
    // null the old .eq() compared against — so the compare-and-swap could
    // never match a never-saved org and every save conflicted
    // (regional.conflict on every save while the QA org's stored value
    // was NULL). Match an absent value with IS NULL; a stored object
    // still matches by JSONB equality. Verified against the disposable
    // DB: eq null-jsonb 0 rows, IS NULL 1 row, eq object 1 row.
    const query=createSupabaseService().from('organizations').update({regional_preferences:next}).eq('id',id);
    const {data,error}=await (previous===null?query.is('regional_preferences',null):query.eq('regional_preferences',JSON.stringify(previous))).select('id').maybeSingle();
    if(error)throw new Error('regional.persistenceUnavailable');
    return Boolean(data);
  }
}
