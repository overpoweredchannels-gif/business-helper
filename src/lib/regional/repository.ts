import {createSupabaseService} from '@/lib/supabase/server';
import type {RegionalRepository} from './service';
export class RegionalPreferencesRepository implements RegionalRepository {
  async findById(id:string){
    const {data,error}=await createSupabaseService().from('organizations').select('regional_preferences').eq('id',id).single();
    if(error)throw new Error('regional.persistenceUnavailable');
    return data?{settings:data.regional_preferences as Record<string,unknown>}:null;
  }
  async updateSettingsIfUnchanged(id:string,previous:Record<string,unknown>|null,next:Record<string,unknown>){
    const {data,error}=await createSupabaseService().from('organizations').update({regional_preferences:next}).eq('id',id).eq('regional_preferences',JSON.stringify(previous)).select('id').maybeSingle();
    if(error)throw new Error('regional.persistenceUnavailable');
    return Boolean(data);
  }
}
