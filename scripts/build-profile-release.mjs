// Local code generation only. No database/network calls.
import fs from 'node:fs';
import crypto from 'node:crypto';

const dir = 'docs/evidence';
const pre = JSON.parse(fs.readFileSync(`${dir}/PROFILE_RELEASE_PRE_da88c3d.json`, 'utf8'));
const evidence = JSON.parse(fs.readFileSync(`${dir}/PROFILE_AUTHORIZATION_da88c3d.json`, 'utf8'));
const query = fs.readFileSync('scripts/profile-release-state.sql', 'utf8').replace(/^--.*\n/gm, '').trim().replace(/;$/, '');
const quote = s => '"' + s.replaceAll('"', '""') + '"';
const post = structuredClone(pre);
post.columns.find(c => c.name === 'role').default = "'staff'::text";
post.relation.acl = post.relation.acl.map(a => /^(anon|authenticated)=/.test(a) ? a.replace(/=[^/]+\//, '=r/') : a);
post.policies = post.policies.filter(p => p.cmd === 'r');
post.callers = post.callers.filter(p => p.tablename !== 'profiles');
const helper = post.helpers.find(f => f.name === 'is_current_user_owner_or_admin');
const fix = text => text.replace("coalesce(p.role, 'owner')", 'p.role').replace('coalesce(p.is_active, true) = true', 'p.is_active is true');
if (!helper.source.includes("coalesce(p.role, 'owner')") || !helper.source.includes('coalesce(p.is_active, true) = true')) throw new Error('Helper preimage drift');
helper.source = fix(helper.source);
for (const row of post.effective) if (row.role !== 'service_role' && row.privilege !== 'SELECT') row.allowed = false;
for (const row of post.effective_columns) if (row.role !== 'service_role' && row.privilege !== 'SELECT') row.allowed = false;
fs.writeFileSync(`${dir}/PROFILE_RELEASE_POST_da88c3d.json`, JSON.stringify(post, null, 2) + '\n');

const originalFunction = evidence.snapshot.functions.find(f => f.name === helper.name).definition.replaceAll('\r', '');
const identity = `do $identity$
begin
  if current_setting('tradeos.release_project_ref', true) is distinct from 'rtfowunsyrdygyvubnvs'
     or current_setting('tradeos.release_deployment', true) is distinct from 'tradeos-qa'
     or current_setting('tradeos.release_commit', true) is distinct from 'da88c3d56df58cf29e7d32debfcc1045d0ea01b4'
     or current_user <> 'postgres' then
    raise exception 'Verified runner connection/deployment context required';
  end if;
  if not exists(select 1 from public.pos_release_test_marker where marker='disposable-pos-atomic-sales') then
    raise exception 'Disposable marker missing';
  end if;
end;
$identity$;`;
function guard(state, label) {
  return `do $guard$\ndeclare actual jsonb;\nbegin\n  ${query.replace(/^select /, 'select ')} into actual;\n  if actual is distinct from $expected$${JSON.stringify(state)}$expected$::jsonb then\n    raise exception '${label}: metadata drift; no release changes may commit';\n  end if;\nend;\n$guard$;`;
}
const begin = `begin;\nset local search_path = public, pg_catalog;\nset local lock_timeout = '5s';\nset local statement_timeout = '30s';\n${identity}\nselect pg_advisory_xact_lock(736452901);\nlock table public.profiles in access exclusive mode;`;
const revoked = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const mutation = `alter table public.profiles alter column role set default 'staff';
drop policy profiles_insert_authenticated on public.profiles;
drop policy profiles_update_same_org_owner_admin_or_self on public.profiles;
revoke ${revoked.join(', ')} on table public.profiles from PUBLIC, anon, authenticated;
${pre.columns.map(c => `revoke insert (${quote(c.name)}), update (${quote(c.name)}), references (${quote(c.name)}) on table public.profiles from PUBLIC, anon, authenticated;`).join('\n')}
${fix(originalFunction)};`;
const policyCommands = { a: 'INSERT', w: 'UPDATE' };
const restorePolicies = pre.policies.filter(p => p.cmd !== 'r').map(p =>
  `create policy ${quote(p.name)} on public.profiles as ${p.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} for ${policyCommands[p.cmd]} to ${p.roles.map(quote).join(', ')}${p.using ? ` using (${p.using})` : ''}${p.check ? ` with check (${p.check})` : ''};`).join('\n');
if (pre.columns.some(c => c.acl.length)) throw new Error('Unexpected column grants: generate reviewed exact restoration first');
const restoredGrants = evidence.snapshot.table_grants.filter(g => ['anon', 'authenticated'].includes(g.grantee) && revoked.includes(g.privilege)).map(g => {
  if (g.grantor !== 'postgres') throw new Error('Unexpected grantor');
  return `grant ${g.privilege} on table public.profiles to ${quote(g.grantee)}${g.grantable ? ' with grant option' : ''};`;
}).join('\n');
const header = '-- GENERATED REVIEW SQL. Remote execution is NOT authorized. Use the guarded runner after separate approval.\n-- Exact canonical before/after assertions include SELECT, RLS, defaults, helpers, ACLs and effective grants.\n';
fs.writeFileSync('src/lib/migrations/20261011_staff_profile_role_access.sql', `${header}${begin}\n${guard(pre, 'Preflight')}\n${mutation}\n${guard(post, 'Postflight')}\ncommit;\n`);
fs.writeFileSync(`${dir}/PROFILE_AUTHORIZATION_ROLLBACK_da88c3d.sql`, `${header}-- WARNING: restores insecure owner/active NULL fallbacks, owner default, INSERT/self-UPDATE exposure.\n${begin}\n${guard(post, 'Rollback preflight')}\nalter table public.profiles alter column role set default ${pre.columns.find(c => c.name === 'role').default};\n${restoredGrants}\n${restorePolicies}\n${originalFunction};\n${guard(pre, 'Rollback postflight')}\ncommit;\n`);
fs.writeFileSync(`${dir}/PROFILE_RELEASE_PREFLIGHT_da88c3d.sql`, `begin isolation level repeatable read read only;\nset local search_path = public, pg_catalog;\n${identity}\n${guard(pre, 'Read-only preflight')}\nrollback;\n`);
const files = ['scripts/profile-release-state.sql', `${dir}/PROFILE_RELEASE_PRE_da88c3d.json`, `${dir}/PROFILE_RELEASE_POST_da88c3d.json`, 'src/lib/migrations/20261011_staff_profile_role_access.sql', `${dir}/PROFILE_AUTHORIZATION_ROLLBACK_da88c3d.sql`, `${dir}/PROFILE_RELEASE_PREFLIGHT_da88c3d.sql`];
fs.writeFileSync(`${dir}/PROFILE_RELEASE_MANIFEST_da88c3d.json`, JSON.stringify(Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])), null, 2) + '\n');
console.log('Generated guarded migration, read-only preflight, minimal rollback and integrity manifest; no database access.');
