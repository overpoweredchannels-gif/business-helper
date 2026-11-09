-- TradeOS production phase 15: card payments, payment void, and balance
-- reconciliation (customer + supplier).
--
-- This file must be applied TOGETHER with the amended phase-14 file, in
-- order (phase 14, then 15, then 16). It fixes the three limitations the
-- 2026-11-09 review listed against the atomic payment slice:
--
--   Con 1 — card payments: the phase-4 payment_method CHECK allowed only
--   cash/bank/other, so the UI's card option was rejected after a full
--   form fill. This file widens the CHECK on BOTH payment tables to
--   cash/bank/card/other (reusing phase 4's own drop-by-definition
--   pattern, so it is re-runnable and survives a phase-4 re-run only in
--   the sense that re-running phase 4 would narrow it again — phase 4
--   is a historical migration and must not be re-run after this file).
--   The amended phase-14 RPC already accepts 'card'; cheque is recorded
--   as method 'other' (the collections-path mapping) and shown as
--   "Cheque" in the UI label map. A nullable reference column (cheque
--   no., card last 4 digits, bank ref) is added to both payment tables
--   and carried by the RPC.
--
--   Con 2 — edit/delete/void: a saved payment could not be corrected.
--   This file adds void columns (voided_at / voided_by_profile_id /
--   void_reason / void_request_key / void_request_fingerprint) and a
--   void_payment_atomic RPC: one transaction that marks the payment
--   voided, excludes it (and its allocations) from every derivation,
--   restores the stored outstanding balance, and writes the audit row.
--   The balance is restored to the previous_outstanding_balance the
--   create audit recorded; for payments created before that field
--   existed, the full amount is added back (documented approximation —
--   any residual difference is reported by the reconciliation below,
--   never silently repaired). The voided row stays in history with a
--   Voided badge — nothing is hard-deleted. "Edit" in the UI is
--   void-then-create through the normal form (each step atomic; a
--   failed re-create leaves the old payment visibly voided, never a
--   half-written payment). The RPC is idempotent per request key.
--
--   Con 3 — old drifted data: this file adds payment_derived_outstanding
--   (the same FIFO derivation the create RPC uses, read-only),
--   reconcile_outstanding_balances (lists every party whose stored
--   balance differs from the derived balance), and
--   correct_outstanding_balance_atomic (sets stored := derived for ONE
--   party, audit-logged, idempotent per request key, only on the
--   owner's explicit per-party approval from the UI report). History is
--   never silently repaired: the correction is a named, audited action.
--
-- What this file does NOT do: change the sales function (phase 16 does
-- that, including the card tender); change any existing row's amount,
-- method, or allocations; delete anything.
--
-- PRE-CHECK (run before applying, read-only): the new CHECK must accept
-- every existing payment_method value. Phase 4 only ever allowed
-- cash/bank/other and the card migration (if it ran) only added card, so
-- the widened set is a superset — but confirm explicitly:
--   select payment_method, count(*) from customer_payments
--     group by 1 order by 1;
--   select payment_method, count(*) from supplier_payments
--     group by 1 order by 1;
-- Every value must be one of cash/bank/card/other. If any other value
-- appears, report it and stop — do not apply this file until it is
-- reviewed.
begin;

-- CHECK widening: drop any existing payment_method CHECK by definition
-- (phase-4 pattern), then add the widened one with an explicit name.
do $$ declare r record; begin
  for r in select conname, conrelid::regclass as tbl from pg_constraint
    where contype = 'c' and conrelid in ('public.customer_payments'::regclass, 'public.supplier_payments'::regclass)
      and pg_get_constraintdef(oid) ilike '%payment_method%' loop
    execute 'alter table ' || r.tbl || ' drop constraint ' || quote_ident(r.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'customer_payments_payment_method_check') then
    alter table public.customer_payments add constraint customer_payments_payment_method_check
      check (payment_method in ('cash', 'bank', 'card', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_payments_payment_method_check') then
    alter table public.supplier_payments add constraint supplier_payments_payment_method_check
      check (payment_method in ('cash', 'bank', 'card', 'other'));
  end if;
end $$;

alter table public.customer_payments
  add column if not exists reference text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by_profile_id uuid,
  add column if not exists void_reason text,
  add column if not exists void_request_key uuid,
  add column if not exists void_request_fingerprint text;
alter table public.supplier_payments
  add column if not exists reference text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by_profile_id uuid,
  add column if not exists void_reason text,
  add column if not exists void_request_key uuid,
  add column if not exists void_request_fingerprint text;

create unique index if not exists customer_payments_org_void_key_uidx
  on public.customer_payments (organization_id, void_request_key)
  where void_request_key is not null;
create unique index if not exists supplier_payments_org_void_key_uidx
  on public.supplier_payments (organization_id, void_request_key)
  where void_request_key is not null;

-- Derived outstanding for ONE party, read-only: the same FIFO derivation
-- the create RPC validates against (returns offset first, explicit
-- allocations second, unallocated-payment pool FIFO oldest-first).
-- Voided payments and their allocations cover nothing.
create or replace function public.payment_derived_outstanding(p_kind text, p_party_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_pool numeric := 0;
  v_invoice record;
  v_invoice_total numeric;
  v_line_total numeric;
  v_returned numeric;
  v_explicit numeric;
  v_remaining_after numeric;
  v_fallback numeric;
  v_remaining numeric;
  v_total numeric := 0;
begin
  if p_kind not in ('customer', 'supplier') or p_party_id is null then
    raise exception 'Payment kind and party are required' using errcode = '22023';
  end if;
  select p.organization_id into v_org
  from public.profiles p
  where p.id = auth.uid() and p.is_active is distinct from false;
  if v_org is null or not public.payments_tool_allowed(v_org) then
    raise exception 'Payments permission is required' using errcode = '42501';
  end if;

  if p_kind = 'customer' then
    select greatest(
      coalesce((select sum(cp.amount) from public.customer_payments cp
        where cp.organization_id = v_org and cp.customer_id = p_party_id and cp.voided_at is null), 0)
      - coalesce((select sum(a.amount) from public.customer_payment_allocations a
        join public.sales_transactions st on st.id = a.sales_transaction_id
        where a.organization_id = v_org and st.organization_id = v_org and st.customer_id = p_party_id
          and not exists (select 1 from public.customer_payments cp2 where cp2.id = a.customer_payment_id and cp2.voided_at is not null)), 0),
      0
    ) into v_pool;

    for v_invoice in
      select st.id, st.total_amount, st.discount_amount, st.tax_amount,
        coalesce(st.sale_date, st.created_at::date) as sort_date, st.created_at
      from public.sales_transactions st
      where st.organization_id = v_org and st.customer_id = p_party_id
        and st.payment_type = 'credit' and st.status not in ('cancelled', 'void')
      order by coalesce(st.sale_date, st.created_at::date), st.created_at, st.id
    loop
      v_invoice_total := coalesce(v_invoice.total_amount, 0);
      if v_invoice_total <= 0 then
        select coalesce(sum(si.quantity * si.selling_price - si.discount), 0)
          into v_line_total from public.sales_items si
          where si.sales_transaction_id = v_invoice.id;
        v_invoice_total := greatest(0, v_line_total - coalesce(v_invoice.discount_amount, 0))
          + coalesce(v_invoice.tax_amount, 0);
      end if;
      select coalesce(sum(greatest(0, (
        select coalesce(sum(sri.quantity * sri.unit_price - sri.discount), 0)
        from public.sales_return_items sri where sri.sales_return_id = sr.id
      ))), 0) into v_returned
      from public.sales_returns sr
      where sr.sales_transaction_id = v_invoice.id and sr.organization_id = v_org
        and sr.status <> 'cancelled';
      select coalesce(sum(a.amount), 0) into v_explicit
      from public.customer_payment_allocations a
      where a.organization_id = v_org and a.sales_transaction_id = v_invoice.id
        and not exists (select 1 from public.customer_payments cp2 where cp2.id = a.customer_payment_id and cp2.voided_at is not null);
      v_remaining_after := greatest(0, v_invoice_total - v_returned - v_explicit);
      v_fallback := least(v_pool, v_remaining_after);
      v_remaining := v_remaining_after - v_fallback;
      v_pool := greatest(0, v_pool - v_fallback);
      v_total := v_total + v_remaining;
    end loop;
  else
    select greatest(
      coalesce((select sum(sp.amount) from public.supplier_payments sp
        where sp.organization_id = v_org and sp.supplier_id = p_party_id and sp.voided_at is null), 0)
      - coalesce((select sum(a.amount) from public.supplier_payment_allocations a
        join public.purchase_transactions pt on pt.id = a.purchase_transaction_id
        where a.organization_id = v_org and pt.organization_id = v_org and pt.supplier_id = p_party_id
          and not exists (select 1 from public.supplier_payments sp2 where sp2.id = a.supplier_payment_id and sp2.voided_at is not null)), 0),
      0
    ) into v_pool;

    for v_invoice in
      select pt.id, pt.purchase_date, pt.created_at
      from public.purchase_transactions pt
      where pt.organization_id = v_org and pt.supplier_id = p_party_id
      order by pt.created_at, pt.id
    loop
      select coalesce(sum(pi.quantity * pi.purchase_price), 0)
        into v_invoice_total from public.purchase_items pi
        where pi.purchase_transaction_id = v_invoice.id and pi.organization_id = v_org;
      select coalesce(sum(greatest(0, (
        select coalesce(sum(pri.quantity * pri.unit_price), 0)
        from public.purchase_return_items pri where pri.purchase_return_id = pr.id
      ))), 0) into v_returned
      from public.purchase_returns pr
      where pr.purchase_transaction_id = v_invoice.id and pr.organization_id = v_org
        and pr.status <> 'cancelled';
      select coalesce(sum(a.amount), 0) into v_explicit
      from public.supplier_payment_allocations a
      where a.organization_id = v_org and a.purchase_transaction_id = v_invoice.id
        and not exists (select 1 from public.supplier_payments sp2 where sp2.id = a.supplier_payment_id and sp2.voided_at is not null);
      v_remaining_after := greatest(0, v_invoice_total - v_returned - v_explicit);
      v_fallback := least(v_pool, v_remaining_after);
      v_remaining := v_remaining_after - v_fallback;
      v_pool := greatest(0, v_pool - v_fallback);
      v_total := v_total + v_remaining;
    end loop;
  end if;

  return v_total;
end;
$$;
revoke all on function public.payment_derived_outstanding(text,uuid) from public, anon, authenticated;

-- Void one saved payment, atomically: marks the payment voided, restores
-- the stored outstanding balance, and writes the audit row — all in one
-- transaction. The payment row and its allocations stay in the database
-- (excluded from every derivation by the voided_at checks); history
-- shows the row with a Voided badge. Idempotent per request key: a
-- retry replays the void instead of voiding twice.
create or replace function public.void_payment_atomic(
  p_request_key uuid,
  p_kind text,
  p_payment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_party_id uuid;
  v_party_name text;
  v_amount numeric;
  v_stored numeric;
  v_previous numeric;
  v_restored numeric;
  v_restored_from text;
  v_fingerprint text;
  v_existing_id uuid;
  v_existing_actor uuid;
  v_existing_reason text;
  v_voided_at timestamptz;
begin
  if v_actor is null or p_request_key is null or p_payment_id is null then
    raise exception 'Authenticated actor, request key, and payment are required' using errcode = '22023';
  end if;
  if p_kind not in ('customer', 'supplier') then
    raise exception 'Payment kind must be customer or supplier' using errcode = '22023';
  end if;
  if p_reason is not null and length(p_reason) > 500 then
    raise exception 'Void reason must be at most 500 characters' using errcode = '22023';
  end if;

  select p.organization_id into v_org
  from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null or not public.payments_tool_allowed(v_org) then
    raise exception 'Payments permission is required' using errcode = '42501';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'kind', p_kind, 'payment_id', p_payment_id, 'reason', p_reason
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_kind || ':' || p_request_key::text, 0));

  -- Replay: the same request key voids the same payment again (same
  -- reason fingerprint); a different payment or reason under it is
  -- rejected, and another actor's key is rejected.
  if p_kind = 'customer' then
    select id, created_by_profile_id, void_reason
      into v_existing_id, v_existing_actor, v_existing_reason
      from public.customer_payments
      where organization_id = v_org and void_request_key = p_request_key;
  else
    select id, created_by_profile_id, void_reason
      into v_existing_id, v_existing_actor, v_existing_reason
      from public.supplier_payments
      where organization_id = v_org and void_request_key = p_request_key;
  end if;
  if found then
    if v_existing_actor is distinct from v_actor then
      raise exception 'Request key belongs to another actor' using errcode = '42501';
    end if;
    if v_existing_id <> p_payment_id or v_existing_reason is distinct from p_reason then
      raise exception 'Request key was already used for a different void' using errcode = '22023';
    end if;
    return jsonb_build_object('payment_id', v_existing_id, 'kind', p_kind, 'replayed', true, 'voided', true);
  end if;

  -- Lock the payment, then the party (balance update cannot be lost).
  if p_kind = 'customer' then
    select customer_id, amount, voided_at into v_party_id, v_amount, v_voided_at
      from public.customer_payments
      where id = p_payment_id and organization_id = v_org
      for update;
    if not found then raise exception 'Payment is unavailable in this organization' using errcode = '22023'; end if;
    if v_voided_at is not null then raise exception 'Payment is already voided' using errcode = '22023'; end if;
    select customer_name, coalesce(outstanding_balance, 0)
      into v_party_name, v_stored from public.customers
      where id = v_party_id and organization_id = v_org for update;
  else
    select supplier_id, amount, voided_at into v_party_id, v_amount, v_voided_at
      from public.supplier_payments
      where id = p_payment_id and organization_id = v_org
      for update;
    if not found then raise exception 'Payment is unavailable in this organization' using errcode = '22023'; end if;
    if v_voided_at is not null then raise exception 'Payment is already voided' using errcode = '22023'; end if;
    select supplier_name, coalesce(outstanding_balance, 0)
      into v_party_name, v_stored from public.suppliers
      where id = v_party_id and organization_id = v_org for update;
  end if;

  -- The create audit row records the stored balance BEFORE the payment;
  -- restoring to it is exact. Older payments have no such record: the
  -- full amount is added back (documented approximation — the original
  -- decrement was by the full amount, floored at 0, so any floored
  -- portion stays as a reported drift for the reconciliation).
  select (new_values->>'previous_outstanding_balance')::numeric into v_previous
  from public.audit_logs
  where organization_id = v_org and entity_type = case when p_kind = 'customer' then 'customer_payment' else 'supplier_payment' end
    and entity_id = p_payment_id and action in ('allocated', 'created')
  order by created_at desc limit 1;
  if v_previous is not null then
    v_restored := v_previous;
    v_restored_from := 'recorded';
  else
    v_restored := v_stored + v_amount;
    v_restored_from := 'added_back';
  end if;

  if p_kind = 'customer' then
    update public.customer_payments
    set voided_at = now(), voided_by_profile_id = v_actor, void_reason = p_reason,
        void_request_key = p_request_key, void_request_fingerprint = v_fingerprint
    where id = p_payment_id and organization_id = v_org;
    update public.customers
    set outstanding_balance = v_restored, updated_at = now()
    where id = v_party_id and organization_id = v_org;
    insert into public.audit_logs (
      organization_id, actor_profile_id, action, entity_type, entity_id,
      entity_label, description, new_values
    ) values (
      v_org, v_actor, 'voided', 'customer_payment', p_payment_id, v_party_name,
      'Voided customer payment for ' || v_party_name,
      jsonb_build_object('customer_id', v_party_id, 'amount', v_amount,
        'reason', p_reason, 'restored_balance', v_restored, 'previous_stored', v_stored,
        'restored_from', v_restored_from, 'request_key', p_request_key)
    );
  else
    update public.supplier_payments
    set voided_at = now(), voided_by_profile_id = v_actor, void_reason = p_reason,
        void_request_key = p_request_key, void_request_fingerprint = v_fingerprint
    where id = p_payment_id and organization_id = v_org;
    update public.suppliers
    set outstanding_balance = v_restored, updated_at = now()
    where id = v_party_id and organization_id = v_org;
    insert into public.audit_logs (
      organization_id, actor_profile_id, action, entity_type, entity_id,
      entity_label, description, new_values
    ) values (
      v_org, v_actor, 'voided', 'supplier_payment', p_payment_id, v_party_name,
      'Voided supplier payment for ' || v_party_name,
      jsonb_build_object('supplier_id', v_party_id, 'amount', v_amount,
        'reason', p_reason, 'restored_balance', v_restored, 'previous_stored', v_stored,
        'restored_from', v_restored_from, 'request_key', p_request_key)
    );
  end if;

  return jsonb_build_object(
    'payment_id', p_payment_id, 'kind', p_kind, 'party_id', v_party_id,
    'amount', v_amount, 'voided', true, 'replayed', false,
    'restored_balance', v_restored, 'restored_from', v_restored_from
  );
end;
$$;
revoke all on function public.void_payment_atomic(uuid,text,uuid,text) from public, anon;
grant execute on function public.void_payment_atomic(uuid,text,uuid,text) to authenticated;

-- List every party whose stored outstanding balance differs from the
-- balance derived from invoices and payments. Read-only; the UI shows
-- this report and the owner corrects one party at a time.
create or replace function public.reconcile_outstanding_balances(p_kind text)
returns table (party_id uuid, party_name text, stored_balance numeric, derived_balance numeric, drift numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_row record;
  v_derived numeric;
  v_stored numeric;
begin
  if v_actor is null then
    raise exception 'Authenticated actor is required' using errcode = '22023';
  end if;
  if p_kind not in ('customer', 'supplier') then
    raise exception 'Payment kind must be customer or supplier' using errcode = '22023';
  end if;
  select p.organization_id into v_org
  from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null or not public.payments_tool_allowed(v_org) then
    raise exception 'Payments permission is required' using errcode = '42501';
  end if;

  if p_kind = 'customer' then
    for v_row in select c.id, c.customer_name, coalesce(c.outstanding_balance, 0) as stored
      from public.customers c where c.organization_id = v_org order by c.customer_name loop
      v_stored := v_row.stored;
      v_derived := public.payment_derived_outstanding('customer', v_row.id);
      if v_stored <> v_derived then
        party_id := v_row.id;
        party_name := v_row.customer_name;
        stored_balance := v_stored;
        derived_balance := v_derived;
        drift := v_stored - v_derived;
        return next;
      end if;
    end loop;
  else
    for v_row in select s.id, s.supplier_name, coalesce(s.outstanding_balance, 0) as stored
      from public.suppliers s where s.organization_id = v_org order by s.supplier_name loop
      v_stored := v_row.stored;
      v_derived := public.payment_derived_outstanding('supplier', v_row.id);
      if v_stored <> v_derived then
        party_id := v_row.id;
        party_name := v_row.supplier_name;
        stored_balance := v_stored;
        derived_balance := v_derived;
        drift := v_stored - v_derived;
        return next;
      end if;
    end loop;
  end if;
  return;
end;
$$;
revoke all on function public.reconcile_outstanding_balances(text) from public, anon;
grant execute on function public.reconcile_outstanding_balances(text) to authenticated;

-- Correct ONE party's stored outstanding balance to the derived balance,
-- audit-logged, idempotent per request key. Only ever called from the
-- reconciliation report after the owner's explicit per-party approval.
create or replace function public.correct_outstanding_balance_atomic(
  p_request_key uuid,
  p_kind text,
  p_party_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_party_name text;
  v_stored numeric;
  v_derived numeric;
  v_fingerprint text;
  v_existing jsonb;
  v_existing_fingerprint text;
begin
  if v_actor is null or p_request_key is null or p_party_id is null then
    raise exception 'Authenticated actor, request key, and party are required' using errcode = '22023';
  end if;
  if p_kind not in ('customer', 'supplier') then
    raise exception 'Payment kind must be customer or supplier' using errcode = '22023';
  end if;
  if p_reason is not null and length(p_reason) > 500 then
    raise exception 'Correction reason must be at most 500 characters' using errcode = '22023';
  end if;

  select p.organization_id into v_org
  from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null or not public.payments_tool_allowed(v_org) then
    raise exception 'Payments permission is required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_kind || ':' || p_party_id::text, 0));

  -- Replay: the same request key for the same party returns the recorded
  -- correction; a different party or content under it is rejected.
  select new_values into v_existing from public.audit_logs
  where organization_id = v_org and action = 'balance_corrected'
    and entity_id = p_party_id and new_values->>'request_key' = p_request_key::text
  order by created_at desc limit 1;
  if found then
    v_existing_fingerprint := v_existing->>'fingerprint';
    v_fingerprint := md5(jsonb_build_object(
      'kind', p_kind, 'party_id', p_party_id, 'reason', p_reason
    )::text);
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'Request key was already used for a different correction' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'party_id', p_party_id, 'kind', p_kind, 'corrected', true, 'replayed', true,
      'stored_before', (v_existing->>'stored_before')::numeric,
      'stored_after', (v_existing->>'stored_after')::numeric,
      'derived', (v_existing->>'derived')::numeric
    );
  end if;

  if p_kind = 'customer' then
    select customer_name, coalesce(outstanding_balance, 0)
      into v_party_name, v_stored from public.customers
      where id = p_party_id and organization_id = v_org for update;
    if not found then raise exception 'Customer is unavailable in this organization' using errcode = '22023'; end if;
  else
    select supplier_name, coalesce(outstanding_balance, 0)
      into v_party_name, v_stored from public.suppliers
      where id = p_party_id and organization_id = v_org for update;
    if not found then raise exception 'Supplier is unavailable in this organization' using errcode = '22023'; end if;
  end if;

  v_derived := public.payment_derived_outstanding(p_kind, p_party_id);
  v_fingerprint := md5(jsonb_build_object(
    'kind', p_kind, 'party_id', p_party_id, 'reason', p_reason
  )::text);

  if v_stored = v_derived then
    return jsonb_build_object(
      'party_id', p_party_id, 'kind', p_kind, 'corrected', false, 'replayed', false,
      'stored_before', v_stored, 'stored_after', v_stored, 'derived', v_derived
    );
  end if;

  if p_kind = 'customer' then
    update public.customers
    set outstanding_balance = v_derived, updated_at = now()
    where id = p_party_id and organization_id = v_org;
    insert into public.audit_logs (
      organization_id, actor_profile_id, action, entity_type, entity_id,
      entity_label, description, new_values
    ) values (
      v_org, v_actor, 'balance_corrected', 'customer', p_party_id, v_party_name,
      'Corrected stored outstanding balance for ' || v_party_name || ' to the derived balance',
      jsonb_build_object('request_key', p_request_key, 'fingerprint', v_fingerprint,
        'stored_before', v_stored, 'stored_after', v_derived, 'derived', v_derived, 'reason', p_reason)
    );
  else
    update public.suppliers
    set outstanding_balance = v_derived, updated_at = now()
    where id = p_party_id and organization_id = v_org;
    insert into public.audit_logs (
      organization_id, actor_profile_id, action, entity_type, entity_id,
      entity_label, description, new_values
    ) values (
      v_org, v_actor, 'balance_corrected', 'supplier', p_party_id, v_party_name,
      'Corrected stored outstanding balance for ' || v_party_name || ' to the derived balance',
      jsonb_build_object('request_key', p_request_key, 'fingerprint', v_fingerprint,
        'stored_before', v_stored, 'stored_after', v_derived, 'derived', v_derived, 'reason', p_reason)
    );
  end if;

  return jsonb_build_object(
    'party_id', p_party_id, 'kind', p_kind, 'corrected', true, 'replayed', false,
    'stored_before', v_stored, 'stored_after', v_derived, 'derived', v_derived
  );
end;
$$;
revoke all on function public.correct_outstanding_balance_atomic(uuid,text,uuid,text) from public, anon;
grant execute on function public.correct_outstanding_balance_atomic(uuid,text,uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
