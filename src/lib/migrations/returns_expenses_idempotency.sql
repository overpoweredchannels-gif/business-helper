-- Slice S7 — returns + expenses idempotency (Offline Tier-1).
--
-- HOW TO RUN: paste this whole file into the Supabase SQL editor.
-- Run it on the DISPOSABLE project first, then on production
-- ("trade os"). Safe to run again (IF NOT EXISTS + CREATE OR REPLACE
-- + revoke/grant). Additive only — no column is dropped, no row is
-- changed, and nothing here deletes or rewrites existing data.
--
-- WHY: the desktop sync engine must resolve an uncertain return /
-- expense outcome by asking the server first — never by re-posting
-- blind. A lost POST response, a timeout, or a crash mid-sync all end
-- up here: if the server already holds the return / expense, the
-- engine marks the local row synced and lands it in the history
-- mirror; only if the status is "unknown" does it POST again with the
-- same key. Same shape as get_sales_invoice_request_status (phase 13),
-- get_payment_request_status (phase 14) and
-- get_purchase_request_status (S6).
--
-- WHAT IT ADDS:
-- - `request_key` (uuid) on sales_returns, purchase_returns and
--   expenses, each with a unique index per org (where not null) —
--   the client request key the routes / insert dedupe on.
-- - `request_fingerprint` (text) on sales_returns and
--   purchase_returns — the routes store an md5 of the canonical
--   return body and compare it on replay, so the same key with
--   different contents is a 400 ("already used for a different
--   return") instead of a silent replay. Expenses compare
--   field-by-field in the sync module (no md5 helper in the
--   browser), so they need no fingerprint column.
-- - `get_sales_return_request_status`, `get_purchase_return_request_status`
--   and `get_expense_request_status` — each returns
--   `{status: "unknown"}` or `{status: "confirmed", result: {...}}`.
--
-- SECURITY: the status functions are granted to `authenticated` like
-- the sales / payment / purchase ones, but each can only ever return
-- a row the caller created (created_by_profile_id must equal
-- auth.uid()), in the caller's own active organization. They return
-- no rows for other actors. The returns routes keep using the user's
-- token (no service-role key anywhere in the desktop sync).
--
-- TRANSITION: until this SQL is run, the returns routes retry the
-- insert WITHOUT the key (so returns never break between deploy and
-- SQL run — dedup is degraded until then, the same exposure as
-- today), and the expense sync's status check fails soft to
-- "unknown". The sync modules document this in their headers.

begin;

alter table public.sales_returns
  add column if not exists request_key uuid;
alter table public.sales_returns
  add column if not exists request_fingerprint text;
create unique index if not exists sales_returns_org_request_key_uidx
  on public.sales_returns (organization_id, request_key)
  where request_key is not null;

alter table public.purchase_returns
  add column if not exists request_key uuid;
alter table public.purchase_returns
  add column if not exists request_fingerprint text;
create unique index if not exists purchase_returns_org_request_key_uidx
  on public.purchase_returns (organization_id, request_key)
  where request_key is not null;

alter table public.expenses
  add column if not exists request_key uuid;
create unique index if not exists expenses_org_request_key_uidx
  on public.expenses (organization_id, request_key)
  where request_key is not null;

create or replace function public.get_sales_return_request_status(p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_ret public.sales_returns%rowtype;
  v_items jsonb;
begin
  if v_actor is null or p_request_key is null or p_request_key = '' then
    raise exception 'Authenticated actor and request key are required' using errcode = '22023';
  end if;
  select p.organization_id into v_org from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null then
    raise exception 'Active organization actor required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_request_key, 0));
  select * into v_ret from public.sales_returns
  where organization_id = v_org and request_key = p_request_key::uuid;
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  if v_ret.created_by_profile_id <> v_actor then
    raise exception 'Request key belongs to another actor' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v_items
  from public.sales_return_items i where i.sales_return_id = v_ret.id;
  return jsonb_build_object(
    'status', 'confirmed',
    'result', jsonb_build_object('return', to_jsonb(v_ret), 'items', v_items)
  );
end;
$$;

create or replace function public.get_purchase_return_request_status(p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_ret public.purchase_returns%rowtype;
  v_items jsonb;
begin
  if v_actor is null or p_request_key is null or p_request_key = '' then
    raise exception 'Authenticated actor and request key are required' using errcode = '22023';
  end if;
  select p.organization_id into v_org from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null then
    raise exception 'Active organization actor required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_request_key, 0));
  select * into v_ret from public.purchase_returns
  where organization_id = v_org and request_key = p_request_key::uuid;
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  if v_ret.created_by_profile_id <> v_actor then
    raise exception 'Request key belongs to another actor' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v_items
  from public.purchase_return_items i where i.purchase_return_id = v_ret.id;
  return jsonb_build_object(
    'status', 'confirmed',
    'result', jsonb_build_object('return', to_jsonb(v_ret), 'items', v_items)
  );
end;
$$;

create or replace function public.get_expense_request_status(p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_exp public.expenses%rowtype;
begin
  if v_actor is null or p_request_key is null or p_request_key = '' then
    raise exception 'Authenticated actor and request key are required' using errcode = '22023';
  end if;
  select p.organization_id into v_org from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null then
    raise exception 'Active organization actor required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_request_key, 0));
  select * into v_exp from public.expenses
  where organization_id = v_org and request_key = p_request_key::uuid;
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  return jsonb_build_object(
    'status', 'confirmed',
    'result', jsonb_build_object('expense', to_jsonb(v_exp))
  );
end;
$$;

revoke all on function public.get_sales_return_request_status(text) from public, anon;
grant execute on function public.get_sales_return_request_status(text) to authenticated;
revoke all on function public.get_purchase_return_request_status(text) from public, anon;
grant execute on function public.get_purchase_return_request_status(text) to authenticated;
revoke all on function public.get_expense_request_status(text) from public, anon;
grant execute on function public.get_expense_request_status(text) to authenticated;

notify pgrst, 'reload schema';
commit;

select to_regprocedure('public.get_sales_return_request_status(text)') is not null as sales_return_status_ready;
select to_regprocedure('public.get_purchase_return_request_status(text)') is not null as purchase_return_status_ready;
select to_regprocedure('public.get_expense_request_status(text)') is not null as expense_status_ready;
