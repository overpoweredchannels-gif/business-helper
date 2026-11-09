-- TradeOS production phase 14: atomic direct payments (customer + supplier).
--
-- Problem (payment-safety first slice, contract 2026-11-05): each direct
-- payment was three separate browser calls (payment insert, allocation
-- insert, audit insert). An allocation failure left a committed orphan
-- payment, there was no duplicate protection, and no server-side
-- validation, authorization, or party check on the write path. Supplier
-- payment tables had no RLS policies in repo SQL at all.
--
-- This file is ADDITIVE ONLY and safe to run again. It adds:
--   * request_key / request_fingerprint / created_by_profile_id columns
--     (nullable) plus partial unique indexes on both payment tables;
--   * CHECK (amount > 0) on both payment tables and CHECK (amount >= 0)
--     on both allocation tables;
--   * RLS + org-scoped policies on supplier_payments and
--     supplier_payment_allocations, mirroring the phase-4 customer policies;
--   * payments_tool_allowed(p_org): owner/admin bypass, else a
--     Staff & Permissions grant (can_manage_payments, or the
--     customer-payments / supplier-payments / supplier-ledger sections),
--     else a custom role_definitions row granting payments_manage. This
--     mirrors how resolveActor merges permissions server-side. Note the
--     same limitation as sales_tool_allowed: a grant that exists ONLY as
--     a custom role is honored here; there is no other hidden source.
--   * create_payment_atomic: one SECURITY DEFINER function, called from
--     the browser as the authenticated user (sales-RPC pattern). It
--     validates actor/org/permission, party, amount (positive, max two
--     decimals), method (cash/bank/other — card stays rejected until the
--     separate card migration), and every allocation against the same
--     remaining-balance derivation the UI uses (returns offset first,
--     explicit allocations second, unallocated-payment pool FIFO
--     oldest-first); then inserts the payment, its allocations, decrements
--     the stored outstanding_balance by the full payment amount (floored
--     at 0, the collections-path rule), and writes the audit row — all in
--     one transaction. The audit row also records the stored balance BEFORE
--     the payment (previous_outstanding_balance) so a later void can
--     restore it exactly. A stable request key + advisory lock + md5
--     fingerprint make retries replay instead of duplicating; reusing a
--     key with different content is rejected. The method list is
--     cash/bank/card/other (card enabled by phase 15's CHECK widening);
--     a payment reference (cheque no., card last 4 digits, bank ref) is
--     stored when the caller supplies one.
--   * get_payment_request_status: confirms a request key after a lost
--     response without re-posting.
--
-- What this file does NOT do: change sales, purchases, returns, or the
-- collections approval flow; change any existing row. The payment_method
-- CHECK widening, the void columns/RPC, the reconciliation RPCs and the
-- card sales-tender change live in phase 15 / phase 16, which must be
-- applied together with this file, in order (phase 14, then 15, then 16):
-- this file's remaining-balance derivation already excludes voided
-- payments, and the voided_at column is created by phase 15.
--
-- PRE-CHECK (run before applying, read-only): confirm no existing rows
-- would violate the new CHECKs, otherwise the migration stops there:
--   select 'customer_payments' t, count(*) n from customer_payments
--     where amount is null or amount <= 0
--   union all select 'supplier_payments', count(*) from supplier_payments
--     where amount is null or amount <= 0
--   union all select 'customer_payment_allocations', count(*) from
--     customer_payment_allocations where amount is null or amount < 0
--   union all select 'supplier_payment_allocations', count(*) from
--     supplier_payment_allocations where amount is null or amount < 0;
-- All four counts must be 0. If any is not, report it and stop — do not
-- apply this file until the offending rows are reviewed.
begin;

-- The 2026-11-09 con-fix widened create_payment_atomic from 8 to 9
-- parameters (p_reference). CREATE OR REPLACE only replaces the same
-- signature, so a database where the 8-arg version was already applied
-- (the disposable DB) would keep BOTH overloads. Drop the stale 8-arg
-- signature first; on a fresh database this is a no-op. The 8-arg version
-- is never called by the current client (submit-payment.ts passes 9 args).
drop function if exists public.create_payment_atomic(uuid, text, uuid, numeric, date, text, text, jsonb);

alter table public.customer_payments
  add column if not exists request_key uuid,
  add column if not exists request_fingerprint text,
  add column if not exists created_by_profile_id uuid;
alter table public.supplier_payments
  add column if not exists request_key uuid,
  add column if not exists request_fingerprint text,
  add column if not exists created_by_profile_id uuid;

create unique index if not exists customer_payments_org_request_key_uidx
  on public.customer_payments (organization_id, request_key)
  where request_key is not null;
create unique index if not exists supplier_payments_org_request_key_uidx
  on public.supplier_payments (organization_id, request_key)
  where request_key is not null;

-- CHECK constraints: no IF NOT EXISTS in Postgres, so guard with a DO block.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customer_payments_amount_positive') then
    alter table public.customer_payments add constraint customer_payments_amount_positive check (amount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_payments_amount_positive') then
    alter table public.supplier_payments add constraint supplier_payments_amount_positive check (amount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customer_payment_allocations_amount_non_negative') then
    alter table public.customer_payment_allocations add constraint customer_payment_allocations_amount_non_negative check (amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_payment_allocations_amount_non_negative') then
    alter table public.supplier_payment_allocations add constraint supplier_payment_allocations_amount_non_negative check (amount >= 0);
  end if;
end $$;

-- Supplier payment tables: RLS + org-scoped policies, mirroring the
-- phase-4 customer payment policies exactly. The atomic RPC below is
-- SECURITY DEFINER and bypasses RLS; these policies are the defense in
-- depth for direct table access.
alter table public.supplier_payments enable row level security;
alter table public.supplier_payment_allocations enable row level security;

drop policy if exists supplier_payments_select_org on public.supplier_payments;
create policy supplier_payments_select_org on public.supplier_payments
  for select using (organization_id = current_org_id());
drop policy if exists supplier_payments_insert_org on public.supplier_payments;
create policy supplier_payments_insert_org on public.supplier_payments
  for insert with check (organization_id = current_org_id());
drop policy if exists supplier_payments_update_org on public.supplier_payments;
create policy supplier_payments_update_org on public.supplier_payments
  for update using (organization_id = current_org_id());
drop policy if exists supplier_payments_delete_org on public.supplier_payments;
create policy supplier_payments_delete_org on public.supplier_payments
  for delete using (organization_id = current_org_id());

drop policy if exists supplier_payment_allocations_select_org on public.supplier_payment_allocations;
create policy supplier_payment_allocations_select_org on public.supplier_payment_allocations
  for select using (organization_id = current_org_id());
drop policy if exists supplier_payment_allocations_insert_org on public.supplier_payment_allocations;
create policy supplier_payment_allocations_insert_org on public.supplier_payment_allocations
  for insert with check (organization_id = current_org_id());
drop policy if exists supplier_payment_allocations_update_org on public.supplier_payment_allocations;
create policy supplier_payment_allocations_update_org on public.supplier_payment_allocations
  for update using (organization_id = current_org_id());
drop policy if exists supplier_payment_allocations_delete_org on public.supplier_payment_allocations;
create policy supplier_payment_allocations_delete_org on public.supplier_payment_allocations
  for delete using (organization_id = current_org_id());

create or replace function public.payments_tool_allowed(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    left join public.staff_permissions sp on sp.profile_id = p.id and sp.organization_id = p.organization_id
    where p.id = auth.uid() and p.organization_id = p_org and p.is_active is distinct from false
    and (
      p.role in ('owner', 'admin')
      or coalesce(sp.can_manage_payments, false)
      or 'customer-payments' = any(coalesce(sp.granted_sections, '{}'::text[]))
      or 'supplier-payments' = any(coalesce(sp.granted_sections, '{}'::text[]))
      or 'supplier-ledger' = any(coalesce(sp.granted_sections, '{}'::text[]))
      or exists (
        select 1 from public.role_definitions r
        where r.organization_id = p_org and r.id = p.role
          and r.is_built_in is distinct from true
          and jsonb_typeof(coalesce(r.permissions, '[]'::jsonb)) = 'array'
          and coalesce(r.permissions, '[]'::jsonb) ? 'payments_manage'
      )
    )
  );
$$;
revoke all on function public.payments_tool_allowed(uuid) from public, anon;
grant execute on function public.payments_tool_allowed(uuid) to authenticated, service_role;

-- Internal response builder; only the two authenticated RPCs below call it.
create or replace function public.payment_atomic_result(p_kind text, p_payment_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'payment_id', p.id,
    'kind', p_kind,
    'party_id', p.party_id,
    'amount', p.amount,
    'allocated_amount', coalesce(a.allocated, 0),
    'unapplied_amount', greatest(0, p.amount - coalesce(a.allocated, 0)),
    'replayed', p_replayed
  )
  from (
    select id, customer_id as party_id, amount from public.customer_payments
      where p_kind = 'customer' and id = p_payment_id
    union all
    select id, supplier_id as party_id, amount from public.supplier_payments
      where p_kind = 'supplier' and id = p_payment_id
  ) p
  left join (
    select 'customer' as kind, customer_payment_id as payment_id, sum(amount) as allocated
      from public.customer_payment_allocations group by 1, 2
    union all
    select 'supplier' as kind, supplier_payment_id as payment_id, sum(amount) as allocated
      from public.supplier_payment_allocations group by 1, 2
  ) a on a.kind = p_kind and a.payment_id = p.id;
$$;

create or replace function public.create_payment_atomic(
  p_request_key uuid,
  p_kind text,
  p_party_id uuid,
  p_amount numeric,
  p_payment_date date default null,
  p_payment_method text default 'cash',
  p_notes text default null,
  p_allocations jsonb default '[]'::jsonb,
  p_reference text default null
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
  v_previous_balance numeric;
  v_payment_id uuid;
  v_fingerprint text;
  v_existing_id uuid;
  v_existing_fingerprint text;
  v_existing_actor uuid;
  v_alloc jsonb;
  v_alloc_invoice uuid;
  v_alloc_amount numeric;
  v_alloc_total numeric := 0;
  v_allocated numeric := 0;
  v_seen uuid[] := '{}';
  v_invoice record;
  v_invoice_total numeric;
  v_line_total numeric;
  v_returned numeric;
  v_explicit numeric;
  v_remaining_after numeric;
  v_fallback numeric;
  v_remaining numeric;
  v_requested numeric;
  v_pool numeric;
begin
  if v_actor is null or p_request_key is null or p_party_id is null then
    raise exception 'Authenticated actor, request key, and party are required' using errcode = '22023';
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

  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount must be a positive amount with at most two decimals' using errcode = '22023';
  end if;
  if p_payment_method not in ('cash', 'bank', 'card', 'other') then
    raise exception 'Invalid payment_method' using errcode = '22023';
  end if;
  if jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'Payment allocations must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_allocations) > 500 then
    raise exception 'A payment may allocate at most 500 invoices' using errcode = '22023';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'kind', p_kind, 'party_id', p_party_id, 'amount', p_amount,
    'payment_date', p_payment_date, 'method', p_payment_method,
    'notes', p_notes, 'allocations', p_allocations, 'reference', p_reference
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_kind || ':' || p_request_key::text, 0));
  if p_kind = 'customer' then
    select id, request_fingerprint, created_by_profile_id
      into v_existing_id, v_existing_fingerprint, v_existing_actor
      from public.customer_payments
      where organization_id = v_org and request_key = p_request_key;
  else
    select id, request_fingerprint, created_by_profile_id
      into v_existing_id, v_existing_fingerprint, v_existing_actor
      from public.supplier_payments
      where organization_id = v_org and request_key = p_request_key;
  end if;
  if found then
    if v_existing_actor is distinct from v_actor then
      raise exception 'Request key belongs to another actor' using errcode = '42501';
    end if;
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'Request key was already used for a different payment' using errcode = '22023';
    end if;
    return public.payment_atomic_result(p_kind, v_existing_id, true);
  end if;

  -- Lock the party row: same-business check + serializes concurrent
  -- payments for the same party (balance updates cannot be lost).
  -- The stored balance BEFORE this payment is captured so a later void
  -- can restore it exactly.
  if p_kind = 'customer' then
    select customer_name, coalesce(outstanding_balance, 0)
      into v_party_name, v_previous_balance from public.customers
    where id = p_party_id and organization_id = v_org
      and is_active is distinct from false
    for update;
    if not found then raise exception 'Customer is unavailable in this organization' using errcode = '22023'; end if;
  else
    select supplier_name, coalesce(outstanding_balance, 0)
      into v_party_name, v_previous_balance from public.suppliers
    where id = p_party_id and organization_id = v_org
      and is_active is distinct from false
    for update;
    if not found then raise exception 'Supplier is unavailable in this organization' using errcode = '22023'; end if;
  end if;

  -- Validate every allocation: shape, scale, duplicates, total, and that
  -- the invoice belongs to this party in this organization.
  for v_alloc in select value from jsonb_array_elements(p_allocations) loop
    if jsonb_typeof(v_alloc) is distinct from 'object' then
      raise exception 'Invalid payment allocation' using errcode = '22023';
    end if;
    v_alloc_invoice := (v_alloc->>'invoice_id')::uuid;
    v_alloc_amount := (v_alloc->>'amount')::numeric;
    if v_alloc_invoice is null or v_alloc_amount is null
      or v_alloc_amount::text in ('NaN', 'Infinity', '-Infinity')
      or v_alloc_amount < 0 or v_alloc_amount <> round(v_alloc_amount, 2) then
      raise exception 'Invalid payment allocation: amounts must be non-negative with at most two decimals' using errcode = '22023';
    end if;
    if v_alloc_invoice = any(v_seen) then
      raise exception 'Duplicate allocation for the same invoice' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_alloc_invoice);
    v_alloc_total := v_alloc_total + v_alloc_amount;
    if p_kind = 'customer' then
      perform 1 from public.sales_transactions st
      where st.id = v_alloc_invoice and st.organization_id = v_org
        and st.customer_id = p_party_id and st.payment_type = 'credit'
        and st.status not in ('cancelled', 'void');
      if not found then raise exception 'Allocated invoice is unavailable for this payment' using errcode = '22023'; end if;
    else
      perform 1 from public.purchase_transactions pt
      where pt.id = v_alloc_invoice and pt.organization_id = v_org
        and pt.supplier_id = p_party_id;
      if not found then raise exception 'Allocated purchase is unavailable for this payment' using errcode = '22023'; end if;
    end if;
  end loop;
  if v_alloc_total > p_amount then
    raise exception 'Allocations exceed the payment amount' using errcode = '22023';
  end if;

  -- Remaining-balance validation, using the same derivation the UI uses:
  -- returns offset first, explicit allocations second, the unallocated
  -- payment pool FIFO oldest-first. The pool is computed BEFORE this
  -- payment is inserted, so the new payment never funds itself.
  -- Voided payments (phase 15) are excluded from the pool and from the
  -- explicit allocations: a voided payment covers nothing.
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
      select coalesce((select (value->>'amount')::numeric
        from jsonb_array_elements(p_allocations)
        where (value->>'invoice_id')::uuid = v_invoice.id), 0) into v_requested;
      if v_requested > v_remaining then
        raise exception 'Allocation exceeds the invoice remaining balance' using errcode = '22023';
      end if;
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
      -- The UI totals a purchase from its lines (quantity x price), not
      -- from the stored total, so the RPC uses the same derivation.
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
      select coalesce((select (value->>'amount')::numeric
        from jsonb_array_elements(p_allocations)
        where (value->>'invoice_id')::uuid = v_invoice.id), 0) into v_requested;
      if v_requested > v_remaining then
        raise exception 'Allocation exceeds the purchase remaining balance' using errcode = '22023';
      end if;
    end loop;
  end if;

  if p_kind = 'customer' then
    insert into public.customer_payments (
      organization_id, customer_id, amount, payment_date, payment_method, notes,
      request_key, request_fingerprint, created_by_profile_id, reference
    ) values (
      v_org, p_party_id, p_amount, p_payment_date, p_payment_method, p_notes,
      p_request_key, v_fingerprint, v_actor, nullif(p_reference, '')
    ) returning id into v_payment_id;
  else
    insert into public.supplier_payments (
      organization_id, supplier_id, amount, payment_date, payment_method, notes,
      request_key, request_fingerprint, created_by_profile_id, reference
    ) values (
      v_org, p_party_id, p_amount, p_payment_date, p_payment_method, p_notes,
      p_request_key, v_fingerprint, v_actor, nullif(p_reference, '')
    ) returning id into v_payment_id;
  end if;

  for v_alloc in select value from jsonb_array_elements(p_allocations) loop
    v_alloc_invoice := (v_alloc->>'invoice_id')::uuid;
    v_alloc_amount := (v_alloc->>'amount')::numeric;
    if v_alloc_amount > 0 then
      if p_kind = 'customer' then
        insert into public.customer_payment_allocations (
          organization_id, customer_payment_id, sales_transaction_id, amount
        ) values (v_org, v_payment_id, v_alloc_invoice, v_alloc_amount);
      else
        insert into public.supplier_payment_allocations (
          organization_id, supplier_payment_id, purchase_transaction_id, amount
        ) values (v_org, v_payment_id, v_alloc_invoice, v_alloc_amount);
      end if;
      v_allocated := v_allocated + v_alloc_amount;
    end if;
  end loop;

  -- The stored outstanding balance falls by the full payment amount
  -- (collections-path rule), floored at 0. The displayed balance already
  -- falls by the same amount through allocations + pool, so this removes
  -- the divergence between the two instead of creating a new rule.
  if p_kind = 'customer' then
    update public.customers
    set outstanding_balance = greatest(0, coalesce(outstanding_balance, 0) - p_amount),
        updated_at = now()
    where id = p_party_id and organization_id = v_org;
    insert into public.audit_logs (
      organization_id, actor_profile_id, action, entity_type, entity_id,
      entity_label, description, new_values
    ) values (
      v_org, v_actor, case when v_allocated > 0 then 'allocated' else 'created' end,
      'customer_payment', v_payment_id, v_party_name,
      case when v_allocated > 0
        then 'Created customer payment with allocations for ' || v_party_name
        else 'Created customer payment for ' || v_party_name end,
      jsonb_build_object('customer_id', p_party_id, 'amount', p_amount,
        'payment_method', p_payment_method, 'payment_date', p_payment_date,
        'notes', p_notes, 'allocations', p_allocations, 'request_key', p_request_key,
        'reference', p_reference, 'previous_outstanding_balance', v_previous_balance)
    );
  else
    update public.suppliers
    set outstanding_balance = greatest(0, coalesce(outstanding_balance, 0) - p_amount),
        updated_at = now()
    where id = p_party_id and organization_id = v_org;
    insert into public.audit_logs (
      organization_id, actor_profile_id, action, entity_type, entity_id,
      entity_label, description, new_values
    ) values (
      v_org, v_actor, case when v_allocated > 0 then 'allocated' else 'created' end,
      'supplier_payment', v_payment_id, v_party_name,
      case when v_allocated > 0
        then 'Created supplier payment with allocations for ' || v_party_name
        else 'Created supplier payment for ' || v_party_name end,
      jsonb_build_object('supplier_id', p_party_id, 'amount', p_amount,
        'payment_method', p_payment_method, 'payment_date', p_payment_date,
        'notes', p_notes, 'allocations', p_allocations, 'request_key', p_request_key,
        'reference', p_reference, 'previous_outstanding_balance', v_previous_balance)
    );
  end if;

  return public.payment_atomic_result(p_kind, v_payment_id, false);
end;
$$;

create or replace function public.get_payment_request_status(p_request_key uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_payment_id uuid;
  v_payment_actor uuid;
begin
  if v_actor is null or p_request_key is null then
    raise exception 'Authenticated actor and request key are required' using errcode = '22023';
  end if;
  if p_kind not in ('customer', 'supplier') then
    raise exception 'Payment kind must be customer or supplier' using errcode = '22023';
  end if;
  select p.organization_id into v_org from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null or not public.payments_tool_allowed(v_org) then
    raise exception 'Payments permission is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_kind || ':' || p_request_key::text, 0));
  if p_kind = 'customer' then
    select id, created_by_profile_id into v_payment_id, v_payment_actor
    from public.customer_payments
    where organization_id = v_org and request_key = p_request_key;
  else
    select id, created_by_profile_id into v_payment_id, v_payment_actor
    from public.supplier_payments
    where organization_id = v_org and request_key = p_request_key;
  end if;
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  if v_payment_actor is distinct from v_actor then
    raise exception 'Request key belongs to another actor' using errcode = '42501';
  end if;
  return jsonb_build_object('status', 'confirmed', 'result', public.payment_atomic_result(p_kind, v_payment_id, true));
end;
$$;

revoke all on function public.payment_atomic_result(text,uuid,boolean) from public, anon, authenticated;
revoke all on function public.create_payment_atomic(uuid,text,uuid,numeric,date,text,text,jsonb,text) from public, anon;
revoke all on function public.get_payment_request_status(uuid,text) from public, anon;
grant execute on function public.create_payment_atomic(uuid,text,uuid,numeric,date,text,text,jsonb,text) to authenticated;
grant execute on function public.get_payment_request_status(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
