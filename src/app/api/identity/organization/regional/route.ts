import {NextResponse} from 'next/server';
import {resolveActor} from '@/lib/identity/api-context';
import {RegionalPreferencesRepository} from '@/lib/regional/repository';
import {ProfileRepository} from '@/lib/identity/repositories/profile-repository';
import {RegionalSettingsService} from '@/lib/regional/service';
import {regionalQaEnabled} from '@/lib/regional/qa';

export const dynamic='force-dynamic';
function failure(error:unknown){
  const code=error instanceof Error?error.message:'';
  const safe=['regional.forbidden','regional.notFound','regional.conflict','regional.invalid','regional.persistenceUnavailable','regional.currencyLocked','regional.currencyInvalid','regional.languageInvalid','regional.localeInvalid','regional.timeZoneInvalid'].includes(code)?code:'regional.saveError';
  return NextResponse.json({error:safe},{status:safe==='regional.forbidden'?403:safe==='regional.notFound'?404:safe==='regional.conflict'||safe==='regional.currencyLocked'?409:safe==='regional.saveError'||safe==='regional.persistenceUnavailable'?503:400,headers:{'Cache-Control':'no-store'}});
}
export async function GET(request:Request){
  if(!regionalQaEnabled())return new NextResponse(null,{status:404});
  const {actor}=await resolveActor(request);
  if(!actor)return new NextResponse(null,{status:401});
  try{return NextResponse.json(await new RegionalSettingsService(new RegionalPreferencesRepository()).get(actor),{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}
}
export async function PATCH(request:Request){
  if(!regionalQaEnabled())return new NextResponse(null,{status:404});
  const {actor}=await resolveActor(request);
  if(!actor)return new NextResponse(null,{status:401});
  try{
    const body=await request.json().catch(()=>{throw new Error('regional.invalid');});
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['preferences','revision'].includes(key)))throw new Error('regional.invalid');
    const profile=await new ProfileRepository().findById(actor.profileId);
    if(profile?.role!=='owner'||profile.is_active!==true||profile.organization_id!==actor.organizationId)throw new Error('regional.forbidden');
    return NextResponse.json(await new RegionalSettingsService(new RegionalPreferencesRepository()).save(actor,body.preferences,body.revision),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return failure(e);}
}
