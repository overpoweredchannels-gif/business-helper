-- Slice S6 — get_purchase_request_status (Offline Tier-1).
--
-- HOW TO RUN: paste this whole file into the Supabase SQL editor.
-- Run it on the DISPOSABLE project first, then on production
-- ("trade os"). Safe to run again (CREATE OR REPLACE + revoke/grant).
-- Run AFTER production_phase10_atomic_purchases.sql: it reads
-- purchase_transactions.request_key, which phase 10 adds.
--
-- WHY: the desktop sync engine must resolve an uncertain purchase
-- outcome by asking the server first — never by re-posting blind.
-- A lost POST response, a timeout, or a crash mid-sync all end up
-- here: if the server already holds the purchase, the engine marks
-- the local row synced and lands it in the history mirror; only if
-- the status is "unknown" does it POST again with the same key.
-- Same shape as get_sales_invoice_request_status (phase 13) and
-- get_payment_request_status (phase 14).
--
-- SECURITY: the create RPC stays service-role-only (design §2 rule —
-- the service-role key never ships in the desktop app). This status
-- function is granted to `authenticated` like the sales one, but it
-- can only ever return a purchase the caller created
-- (created_by_profile_id must equal auth.uid()), in the caller's own
-- active organization. It returns no rows for other actors.
begin;

create or replace function public.get_purchase_request_status(p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_tx public.purchase_transactions%rowtype;
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
  select * into v_tx from public.purchase_transactions
  where organization_id = v_org and request_key = p_request_key;
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  if v_tx.created_by_profile_id <> v_actor then
    raise exception 'Request key belongs to another actor' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v_items
  from public.purchase_items i where i.purchase_transaction_id = v_tx.id;
  return jsonb_build_object(
    'status', 'confirmed',
    'result', jsonb_build_object('transaction', to_jsonb(v_tx), 'items', v_items)
  );
end;
$$;

revoke all on function public.get_purchase_request_status(text) from public, anon;
grant execute on function public.get_purchase_request_status(text) to authenticated;

notify pgrst, 'reload schema';
commit;

select to_regprocedure('public.get_purchase_request_status(text)') is not null as purchase_status_ready;
