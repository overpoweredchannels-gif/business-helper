import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// In-memory PostgreSQL only. No fetch, socket, external URL or remote DB driver.
const pre = JSON.parse(readFileSync('docs/evidence/PROFILE_RELEASE_PRE_da88c3d.json', 'utf8'));
const post = JSON.parse(readFileSync('docs/evidence/PROFILE_RELEASE_POST_da88c3d.json', 'utf8'));
const evidence = JSON.parse(readFileSync('docs/evidence/PROFILE_AUTHORIZATION_da88c3d.json', 'utf8'));
const stateSql = readFileSync('scripts/profile-release-state.sql', 'utf8');
const migration = readFileSync('src/lib/migrations/20261011_staff_profile_role_access.sql', 'utf8');
const rollback = readFileSync('docs/evidence/PROFILE_AUTHORIZATION_ROLLBACK_da88c3d.sql', 'utf8');
const preflight = readFileSync('docs/evidence/PROFILE_RELEASE_PREFLIGHT_da88c3d.sql', 'utf8');
const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const org = '10000000-0000-0000-0000-000000000001';
const user = '20000000-0000-0000-0000-000000000001';
const nextUser = '20000000-0000-0000-0000-000000000002';
const project = 'rtfowunsyrdygyvubnvs';
let checks = 0;

async function state(db: PGlite) { return Object.values((await db.query(stateSql)).rows[0] as object)[0]; }
async function fixture() {
  const db = new PGlite();
  await db.exec(`set search_path=public,pg_catalog;
    create role anon; create role authenticated; create role service_role bypassrls;
    create role authenticator login noinherit;
    grant anon, authenticated, service_role to authenticator with inherit false, set true;
    alter schema public owner to pg_database_owner;
    revoke all on schema public from public;
    set role pg_database_owner;
    grant usage on schema public to public, postgres, anon, authenticated, service_role;
    reset role;
    create schema auth; grant usage on schema auth to public;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key, name text);
    create table public.profiles(${pre.columns.map((c: { name: string; type: string; not_null: boolean; default: string | null }) => `${q(c.name)} ${c.type}${c.not_null ? ' not null' : ''}${c.default ? ` default ${c.default}` : ''}`).join(',')});
    create table public.staff_permissions(profile_id uuid,organization_id uuid,note text);
    create table public.security_checks(organization_id uuid,note text);
    create table public.pos_release_test_marker(marker text);
    insert into public.pos_release_test_marker values('disposable-pos-atomic-sales');
  `);
  for (const c of pre.constraints) await db.exec(`alter table profiles add constraint ${q(c.name)} ${c.definition};`);
  await db.exec('alter table staff_permissions add foreign key(profile_id) references profiles(id) on delete cascade;');
  for (const idx of pre.indexes) if (idx.name !== 'profiles_pkey') await db.exec(idx.definition);
  for (const g of evidence.snapshot.table_grants) await db.exec(`grant ${g.privilege} on profiles to ${q(g.grantee)}${g.grantable ? ' with grant option' : ''};`);
  for (const h of pre.helpers) {
    const original = evidence.snapshot.functions.find((f: { name: string }) => f.name === h.name);
    await db.exec(original.definition);
    await db.exec(`grant execute on function public.${h.name}(${h.name === 'user_can_access_organization' ? 'uuid' : ''}) to anon, authenticated, service_role;`);
  }
  const commands: Record<string, string> = { a: 'INSERT', r: 'SELECT', w: 'UPDATE' };
  for (const p of pre.policies) await db.exec(`create policy ${q(p.name)} on profiles as ${p.permissive ? 'permissive' : 'restrictive'} for ${commands[p.cmd]} to ${p.roles.map(q).join(',')}${p.using ? ` using (${p.using})` : ''}${p.check ? ` with check (${p.check})` : ''};`);
  await db.exec('alter table profiles enable row level security;');
  for (const p of pre.callers.filter((p: { tablename: string }) => p.tablename !== 'profiles')) {
    await db.exec(`alter table ${q(p.tablename)} enable row level security;
      grant select,insert,update,delete on ${q(p.tablename)} to authenticated;
      create policy ${q(p.policyname)} on ${q(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(q).join(',')} using (${p.qual}) with check (${p.with_check});`);
  }
  // SELECT policy is needed for UPDATE positive controls on organizations.
  await db.exec(`create policy organizations_select_own on organizations for select to authenticated using(id=current_user_organization_id());
    insert into organizations values('${org}','original');
    insert into auth.users values('${user}'),('${nextUser}');
    insert into profiles(id,auth_user_id,organization_id,full_name,role,is_active) values('${user}','${user}','${org}','Synthetic','owner',true);
    insert into staff_permissions values('${user}','${org}','original');
    insert into security_checks values('${org}','original');
    select set_config('tradeos.release_project_ref','${project}',false);
    select set_config('tradeos.release_deployment','tradeos-qa',false);
    select set_config('tradeos.release_commit','da88c3d56df58cf29e7d32debfcc1045d0ea01b4',false);
  `);
  assert.deepEqual(await state(db), pre, 'fixture must match captured release metadata exactly');
  return db;
}
async function asStaff(db: PGlite, sql: string) {
  await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true);`);
  try { return await db.query(sql); } finally { await db.exec('rollback;'); }
}
async function rejectedWithoutChange(db: PGlite, sql: string) {
  const before = await db.query('select * from profiles order by id');
  await assert.rejects(asStaff(db, sql), /permission denied/);
  assert.deepEqual((await db.query('select * from profiles order by id')).rows, before.rows);
  checks++;
}
async function main() {
  const db = await fixture();
  try {
    await db.exec(preflight);
    const untouched = await db.query(`select oid from pg_policy where polname='profiles_select_same_org'`);
    const rowsBefore = (await db.query('select * from profiles order by id')).rows;
    await db.exec(migration);
    assert.deepEqual(await state(db), post);
    assert.deepEqual((await db.query('select * from profiles order by id')).rows, rowsBefore, 'migration rewrites no rows');
    checks++;
    for (const role of [null, '', 'staff', 'salesman', 'unknown', 'owner', 'admin']) {
      for (const active of [null, false, true]) {
        await db.query('update profiles set role=$1,is_active=$2 where id=$3', [role, active, user]);
        const expected = (role === 'owner' || role === 'admin') && active === true;
        assert.deepEqual((await asStaff(db, 'select public.is_current_user_owner_or_admin() as allowed')).rows, [{ allowed: expected }]);
        // Test actual surviving policy callers with persisted state rolled back.
        const organizations = await asStaff(db, "update organizations set name='changed' returning id");
        assert.equal(organizations.rows.length, expected ? 1 : 0);
        const permissions = await asStaff(db, "update staff_permissions set note='changed' returning profile_id");
        assert.equal(permissions.rows.length, expected ? 1 : 0);
        const security = await asStaff(db, "update security_checks set note='changed' returning organization_id");
        assert.equal(security.rows.length, expected ? 1 : 0);
        checks += 4;
      }
    }
    await db.query('update profiles set role=$1,is_active=true where id=$2', ['staff', user]);
    for (const sql of [
      "update profiles set role='owner' returning id",
      `insert into profiles(id,full_name,organization_id,role) values('${nextUser}','New','${org}','owner') returning id`,
      `insert into profiles(id,full_name,organization_id,role) values('${user}','Upsert','${org}','owner') on conflict(id) do update set role=excluded.role returning id`,
      `insert into profiles(id,full_name,organization_id,role) values('${nextUser}','Upsert','${org}','owner') on conflict(id) do update set role=excluded.role returning id`,
      'delete from profiles returning id',
    ]) await rejectedWithoutChange(db, sql);
    assert.equal((await asStaff(db, 'select * from profiles')).rows.length, 1, 'SELECT still works under its original RLS');
    await db.exec('begin; set local role service_role;');
    try { assert.equal((await db.query("update profiles set display_name='server' returning id")).rows.length, 1); } finally { await db.exec('rollback;'); }
    // Controlled demonstration: BYPASSRLS is not a substitute for ordinary grants.
    await db.exec('begin; revoke update on profiles from service_role; set local role service_role;');
    try { await assert.rejects(db.query("update profiles set display_name='no grant'"), /permission denied/); } finally { await db.exec('rollback;'); }
    await db.exec(rollback);
    assert.deepEqual(await state(db), pre, 'exact preimage restored');
    assert.deepEqual(await db.query(`select oid from pg_policy where polname='profiles_select_same_org'`), untouched, 'SELECT policy never dropped/recreated');
    await db.exec('update profiles set role=null,is_active=null;');
    assert.deepEqual((await asStaff(db, 'select is_current_user_owner_or_admin() as allowed')).rows, [{ allowed: true }], 'rollback explicitly reopens NULL privilege exposure');
    checks += 5;
  } finally { await db.close(); }

  const drifts = [
    ['default', "alter table profiles alter column role set default 'admin'"],
    ['RLS', 'alter table profiles disable row level security'],
    ['SELECT grant', 'revoke select on profiles from authenticated'],
    ['SELECT policy', 'alter policy profiles_select_same_org on profiles using(true)'],
    ['server grant', 'revoke update on profiles from service_role'],
    ['column ACL', 'grant update(role) on profiles to authenticated'],
    ['PUBLIC', 'grant insert on profiles to public'],
    ['inheritance', 'grant service_role to authenticated'],
    ['helper', "alter function is_current_user_owner_or_admin() set search_path=pg_catalog"],
    ['caller policy', 'alter policy security_checks_owner_admin_access on security_checks using(true)'],
  ];
  for (const phase of ['apply', 'rollback']) {
    const testDb = await fixture();
    try {
      if (phase === 'rollback') await testDb.exec(migration);
      for (const [label, drift] of drifts) {
        // An outer transaction lets us discard each deliberate drift after proving
        // the release transaction fails, without touching any remote database.
        await testDb.exec('begin;');
        await testDb.exec(drift);
        await assert.rejects(testDb.exec(phase === 'apply' ? migration : rollback), /metadata drift/, `${phase} must reject ${label}`);
        await testDb.exec('rollback;');
        assert.deepEqual(await state(testDb), phase === 'apply' ? pre : post, `${phase} drift rejection changes nothing`);
        checks++;
      }
      for (const context of ["select set_config('tradeos.release_project_ref','wrong',true)", "select set_config('tradeos.release_deployment','production',true)", "select set_config('tradeos.release_commit','wrong',true)", 'delete from pos_release_test_marker']) {
        await testDb.exec(`begin; ${context};`);
        await assert.rejects(testDb.exec(phase === 'apply' ? migration : rollback), /context required|marker missing/);
        await testDb.exec('rollback;');
        checks++;
      }
    } finally { await testDb.close(); }
  }
  const assertionDb = await fixture();
  try {
    for (const [, drift] of drifts.filter(([label]) => ['default', 'RLS', 'SELECT grant', 'SELECT policy', 'server grant'].includes(label))) {
      const at = migration.lastIndexOf('do $guard$');
      const faulted = migration.slice(0, at) + drift + ';\n' + migration.slice(at);
      await assert.rejects(assertionDb.exec(faulted), /Postflight: metadata drift/);
      await assertionDb.exec('rollback;');
      assert.deepEqual(await state(assertionDb), pre, 'postflight failure atomically undoes release changes');
      checks++;
    }
  } finally { await assertionDb.close(); }
  console.log(`PASS ${checks} local checks: exact captured metadata, helper and caller matrix, no-row-rewrite, direct DML/upsert denial, preserved SELECT/server grants, exact minimal rollback, and deliberate drift/identity failures. No remote SQL applied.`);
}
main().catch(error => { console.error(error); process.exit(1); });
