import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

async function main(){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table public.pos_release_test_marker(marker text);insert into public.pos_release_test_marker values('disposable-pos-atomic-sales');
  create table public.organizations(id uuid primary key,name text);
  create table public.profiles(id uuid primary key,organization_id uuid,role text,is_active boolean);
  insert into organizations values('00000000-0000-4000-8000-000000000001','Synthetic');
  insert into profiles values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','owner',true);
  grant usage on schema public,auth to authenticated;grant select on profiles to authenticated;grant select,update on organizations to authenticated;
  select set_config('tradeos.regional_project_ref','rtfowunsyrdygyvubnvs',false);`);
  const sql=fs.readFileSync('docs/proposals/REGIONAL_PREFERENCES_QA.sql','utf8');
  await db.exec(sql);
  const baseline=await db.query('select * from profiles');
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);update organizations set regional_preferences=jsonb_set(regional_preferences,'{language}','"ur"');`);
  for(const currency of ['EUR','USD','GBP'])await assert.rejects(db.exec(`update organizations set regional_preferences=jsonb_set(regional_preferences,'{accountingCurrency}','"${currency}"');`));
  for(const field of ['language','locale','timeZone'])await assert.rejects(db.exec(`update organizations set regional_preferences=jsonb_set(regional_preferences,'{${field}}','null');`));
  await db.exec('reset role;');
  for(const state of ["role='staff'","role='admin'","role=null","role='owner',is_active=null","is_active=false"]){
    await db.exec(`update profiles set ${state};set role authenticated;`);
    await assert.rejects(db.exec(`update organizations set regional_preferences=jsonb_set(regional_preferences,'{language}','"es"');`));
    await db.exec('reset role;');
  }
  await db.exec("update profiles set role='owner',is_active=true;");
  assert.deepEqual((await db.query('select * from profiles')).rows,baseline.rows);
  const saved=await db.query<{regional_preferences:{accountingCurrency:string}}>('select regional_preferences from organizations');
  assert.equal(saved.rows[0].regional_preferences.accountingCurrency,'PKR');
  await assert.rejects(db.exec(sql),'repeat migration must stop');
  await db.exec('rollback;');
  await db.close();
  console.log('PASS isolated PostgreSQL regional schema, owner/admin/staff/NULL states, currency locks and repeat guard. No remote connection.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
