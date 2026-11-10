-- Phase 17 — kind-scoped payment permissions + single-click edit.
--
-- Apply AFTER phase 14 + 15 + 16, in that order, before any call.
-- This file is ADDITIVE (new columns, new functions, regenerated
-- functions). The access-removing grant revokes live in phase 18,
-- a separate batch per the repo rule (never batch destructive with
-- additive). Nothing here applies to production by itself.
--
-- 1. Kind-scoped gate: payments_tool_allowed(p_org) is replaced by
--    payments_tool_allowed_for(p_org, p_kind, p_action). A staff member
--    with only the supplier-payments section can no longer create a
--    customer payment through the RPC (R7 finding 1, closed).
--    Actions: create / edit / void per kind; 'view' needs only the
--    kind's section. Owner/admin, legacy can_manage_payments, and custom
--    roles granting payments_manage keep full access (backwards
--    compatible). 'supplier-ledger' counts as a supplier-kind section.
-- 2. Six new staff_permissions booleans (create/edit/void x
--    customer/supplier). BACKFILL: they are set from granted_sections
--    (false -> true only, never true -> false), so effective access is
--    unchanged at apply time and the owner can narrow afterwards.
--    NOTE: re-applying this file restores section-implied grants;
--    narrow after the final apply.
-- 3. edit_payment_atomic: one-transaction edit of a saved payment
--    (amount, date, method, notes, reference, party, allocations).
--    Same payment id; edited_at marks it Updated in history.
-- 4. Void restore fix: void_payment_atomic restored the stored balance
--    to the create-audit previous balance outright, which erases later
--    payments on the same party. The exact restore is current stored +
--    least(amount, previous). Regression test T15b covers it.
--
-- PRE-CHECK: none blocking. The backfill only ever turns a boolean
-- false -> true; it never removes a grant.
begin;

-- Per-kind, per-action payment grants on staff_permissions.
alter table public.staff_permissions
  add column if not exists can_create_customer_payments boolean not null default false,
  add column if not exists can_edit_customer_payments boolean not null default false,
  add column if not exists can_void_customer_payments boolean not null default false,
  add column if not exists can_create_supplier_payments boolean not null default false,
  add column if not exists can_edit_supplier_payments boolean not null default false,
  add column if not exists can_void_supplier_payments boolean not null default false;

update public.staff_permissions
set can_create_customer_payments = coalesce(can_create_customer_payments, false)
      or ('customer-payments' = any(coalesce(granted_sections, '{}'::text[]))),
    can_edit_customer_payments = coalesce(can_edit_customer_payments, false)
      or ('customer-payments' = any(coalesce(granted_sections, '{}'::text[]))),
    can_void_customer_payments = coalesce(can_void_customer_payments, false)
      or ('customer-payments' = any(coalesce(granted_sections, '{}'::text[]))),
    can_create_supplier_payments = coalesce(can_create_supplier_payments, false)
      or ('supplier-payments' = any(coalesce(granted_sections, '{}'::text[])))
      or ('supplier-ledger' = any(coalesce(granted_sections, '{}'::text[]))),
    can_edit_supplier_payments = coalesce(can_edit_supplier_payments, false)
      or ('supplier-payments' = any(coalesce(granted_sections, '{}'::text[])))
      or ('supplier-ledger' = any(coalesce(granted_sections, '{}'::text[]))),
    can_void_supplier_payments = coalesce(can_void_supplier_payments, false)
      or ('supplier-payments' = any(coalesce(granted_sections, '{}'::text[])))
      or ('supplier-ledger' = any(coalesce(granted_sections, '{}'::text[])));

-- Edit tracking on both payment tables.
alter table public.customer_payments
  add column if not exists edited_at timestamptz,
  add column if not exists edit_request_key uuid,
  add column if not exists edit_request_fingerprint text;
alter table public.supplier_payments
  add column if not exists edited_at timestamptz,
  add column if not exists edit_request_key uuid,
  add column if not exists edit_request_fingerprint text;
create unique index if not exists customer_payments_org_edit_key_uidx
  on public.customer_payments (organization_id, edit_request_key) where edit_request_key is not null;
create unique index if not exists supplier_payments_org_edit_key_uidx
  on public.supplier_payments (organization_id, edit_request_key) where edit_request_key is not null;

-- Replace the 1-arg gate with the kind/action gate.
drop function if exists public.payments_tool_allowed(uuid);

create or replace function public.payments_tool_allowed_for(p_org uuid, p_kind text, p_action text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    left join public.staff_permissions sp on sp.profile_id = p.id and sp.organization_id = p.organization_id
    where p.id = auth.uid() and p.organization_id = p_org and p.is_active is distinct from false
    and (
      p.role in ('owner', 'admin')
      or coalesce(sp.can_manage_payments, false)
      or exists (
        select 1 from public.role_definitions r
        where r.organization_id = p_org and r.id = p.role
          and r.is_built_in is distinct from true
          and jsonb_typeof(coalesce(r.permissions, '[]'::jsonb)) = 'array'
          and coalesce(r.permissions, '[]'::jsonb) ? 'payments_manage'
      )
      or (
        (
          (p_kind || '-payments') = any(coalesce(sp.granted_sections, '{}'::text[]))
          or (p_kind = 'supplier' and 'supplier-ledger' = any(coalesce(sp.granted_sections, '{}'::text[])))
        )
        and (
          p_action = 'view'
          or (p_kind = 'customer' and p_action = 'create' and coalesce(sp.can_create_customer_payments, false))
          or (p_kind = 'customer' and p_action = 'edit' and coalesce(sp.can_edit_customer_payments, false))
          or (p_kind = 'customer' and p_action = 'void' and coalesce(sp.can_void_customer_payments, false))
          or (p_kind = 'supplier' and p_action = 'create' and coalesce(sp.can_create_supplier_payments, false))
          or (p_kind = 'supplier' and p_action = 'edit' and coalesce(sp.can_edit_supplier_payments, false))
          or (p_kind = 'supplier' and p_action = 'void' and coalesce(sp.can_void_supplier_payments, false))
        )
      )
    )
  );
$$;
revoke all on function public.payments_tool_allowed_for(uuid,text,text) from public, anon;
grant execute on function public.payments_tool_allowed_for(uuid,text,text) to authenticated, service_role;

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
  if v_org is null or not public.payments_tool_allowed_for(v_org, p_kind, 'create') then
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
revoke all on function public.create_payment_atomic(uuid,text,uuid,numeric,date,text,text,jsonb,text) from public, anon;
grant execute on function public.create_payment_atomic(uuid,text,uuid,numeric,date,text,text,jsonb,text) to authenticated;

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
  if v_org is null or not public.payments_tool_allowed_for(v_org, p_kind, 'view') then
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
revoke all on function public.get_payment_request_status(uuid,text) from public, anon;
grant execute on function public.get_payment_request_status(uuid,text) to authenticated;

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
  if v_org is null or not public.payments_tool_allowed_for(v_org, p_kind, 'view') then
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
  if v_org is null or not public.payments_tool_allowed_for(v_org, p_kind, 'void') then
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

  -- The create audit row records the stored balance BEFORE the payment.
  -- Restoring to it outright would erase later payments, so the exact
  -- restore is the current stored balance plus the part of this payment
  -- that actually decremented it: least(amount, previous). (When the
  -- create floored at 0, the floored portion was never decremented, so
  -- it is not added back.) Older payments have no such record: the full
  -- amount is added back (documented approximation — any floored portion
  -- stays as a reported drift for the reconciliation).
  select (new_values->>'previous_outstanding_balance')::numeric into v_previous
  from public.audit_logs
  where organization_id = v_org and entity_type = case when p_kind = 'customer' then 'customer_payment' else 'supplier_payment' end
    and entity_id = p_payment_id and action in ('allocated', 'created')
  order by created_at desc limit 1;
  if v_previous is not null then
    v_restored := v_stored + least(v_amount, v_previous);
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
  if v_org is null or not public.payments_tool_allowed_for(v_org, p_kind, 'view') then
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
  if v_org is null or not public.payments_tool_allowed_for(v_org, p_kind, 'edit') then
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

-- edit_payment_atomic: single-click edit of a saved payment (phase 17).
-- One transaction: the payment row (amount, date, method, notes, reference,
-- party), its allocations (replaced), the stored outstanding balance(s) and
-- the audit row land together or not at all. The payment keeps its id;
-- history shows it as Updated via edited_at. Idempotent per edit request
-- key: a retry with the same key replays instead of applying twice.
-- Balance rule (exact): the edit is a restore of the old amount plus an
-- application of the new amount. The restore uses the create-audit
-- previous balance: restore = current stored + least(old amount,
-- previous). Restoring to the previous balance outright would erase
-- later payments; adding back the full old amount would re-add a
-- portion the create floored away. Older payments with no create-audit
-- record fall back to the delta (documented approximation, same as void).
-- NOTE (2026-11-10): Postgres does NOT allow renaming an input parameter
-- with CREATE OR REPLACE (error 42P13). The original deploy declared
-- p_method; the live client sends p_payment_method. Drop the old function
-- first, then re-create it with the corrected name. Nothing inside the
-- database calls this function (only the app, via PostgREST), so the
-- drop is safe.
drop function if exists public.edit_payment_atomic(uuid,text,uuid,uuid,numeric,date,text,text,jsonb,text);
create or replace function public.edit_payment_atomic(
  p_request_key uuid,
  p_kind text,
  p_payment_id uuid,
  p_party_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
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
  v_fingerprint text;
  v_existing_fp text;
  v_existing_key uuid;
  v_old_party_id uuid;
  v_old_amount numeric;
  v_old_method text;
  v_old_date date;
  v_old_notes text;
  v_old_reference text;
  v_voided_at timestamptz;
  v_party_name text;
  v_old_party_name text;
  v_previous numeric;
  v_restored_from text;
  v_stored numeric;
  v_new_party_stored numeric;
  v_old_party_stored numeric;
  v_restore numeric;
  v_new_stored numeric;
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
  if v_actor is null or p_request_key is null or p_payment_id is null or p_party_id is null then
    raise exception 'Authenticated actor, request key, payment, and party are required' using errcode = '22023';
  end if;
  if p_kind not in ('customer', 'supplier') then
    raise exception 'Payment kind must be customer or supplier' using errcode = '22023';
  end if;

  select p.organization_id into v_org
  from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null or not public.payments_tool_allowed_for(v_org, p_kind, 'edit') then
    raise exception 'Payments edit permission is required' using errcode = '42501';
  end if;

  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount must be a positive amount with at most two decimals' using errcode = '22023';
  end if;
  if p_payment_date is null then
    raise exception 'Payment date is required' using errcode = '22023';
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
    'kind', p_kind, 'payment_id', p_payment_id, 'party_id', p_party_id, 'amount', p_amount,
    'payment_date', p_payment_date, 'method', p_payment_method, 'notes', p_notes,
    'allocations', p_allocations, 'reference', p_reference
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_kind || ':' || p_request_key::text, 0));

  -- Lock the payment row: same-business check, already-voided check, and
  -- the old values (needed for the balance delta and the audit trail).
  if p_kind = 'customer' then
    select customer_id, amount, payment_method, payment_date, notes, reference, voided_at, edit_request_key, edit_request_fingerprint
      into v_old_party_id, v_old_amount, v_old_method, v_old_date, v_old_notes, v_old_reference, v_voided_at, v_existing_key, v_existing_fp
      from public.customer_payments
      where id = p_payment_id and organization_id = v_org
      for update;
    if not found then raise exception 'Payment is unavailable in this organization' using errcode = '22023'; end if;
  else
    select supplier_id, amount, payment_method, payment_date, notes, reference, voided_at, edit_request_key, edit_request_fingerprint
      into v_old_party_id, v_old_amount, v_old_method, v_old_date, v_old_notes, v_old_reference, v_voided_at, v_existing_key, v_existing_fp
      from public.supplier_payments
      where id = p_payment_id and organization_id = v_org
      for update;
    if not found then raise exception 'Payment is unavailable in this organization' using errcode = '22023'; end if;
  end if;
  if v_voided_at is not null then raise exception 'A voided payment cannot be edited' using errcode = '22023'; end if;

  -- Replay: the same edit key with the same content returns the payment.
  -- A stored key only blocks a retry of THAT edit; a new key is a new edit.
  if v_existing_key is not null and v_existing_key = p_request_key then
    if v_existing_fp is distinct from v_fingerprint then
      raise exception 'Request key was already used for a different edit' using errcode = '22023';
    end if;
    return public.payment_atomic_result(p_kind, p_payment_id, true);
  end if;

  -- Lock the party rows (old, and new when the party changes) in id
  -- order, so concurrent edits cannot deadlock. The stored balances are
  -- read after the lock.
  if p_kind = 'customer' then
    if p_party_id = v_old_party_id then
      select customer_name, coalesce(outstanding_balance, 0)
        into v_party_name, v_stored from public.customers
      where id = p_party_id and organization_id = v_org
        and is_active is distinct from false
      for update;
      if not found then raise exception 'Customer is unavailable in this organization' using errcode = '22023'; end if;
      v_old_party_name := v_party_name;
      v_old_party_stored := v_stored;
    else
      perform 1 from public.customers
      where id in (v_old_party_id, p_party_id) and organization_id = v_org
      order by id for update;
      select customer_name, coalesce(outstanding_balance, 0)
        into v_old_party_name, v_old_party_stored from public.customers
      where id = v_old_party_id and organization_id = v_org
        and is_active is distinct from false;
      if not found then raise exception 'Customer is unavailable in this organization' using errcode = '22023'; end if;
      select customer_name, coalesce(outstanding_balance, 0)
        into v_party_name, v_new_party_stored from public.customers
      where id = p_party_id and organization_id = v_org
        and is_active is distinct from false;
      if not found then raise exception 'Customer is unavailable in this organization' using errcode = '22023'; end if;
    end if;
  else
    if p_party_id = v_old_party_id then
      select supplier_name, coalesce(outstanding_balance, 0)
        into v_party_name, v_stored from public.suppliers
      where id = p_party_id and organization_id = v_org
        and is_active is distinct from false
      for update;
      if not found then raise exception 'Supplier is unavailable in this organization' using errcode = '22023'; end if;
      v_old_party_name := v_party_name;
      v_old_party_stored := v_stored;
    else
      perform 1 from public.suppliers
      where id in (v_old_party_id, p_party_id) and organization_id = v_org
      order by id for update;
      select supplier_name, coalesce(outstanding_balance, 0)
        into v_old_party_name, v_old_party_stored from public.suppliers
      where id = v_old_party_id and organization_id = v_org
        and is_active is distinct from false;
      if not found then raise exception 'Supplier is unavailable in this organization' using errcode = '22023'; end if;
      select supplier_name, coalesce(outstanding_balance, 0)
        into v_party_name, v_new_party_stored from public.suppliers
      where id = p_party_id and organization_id = v_org
        and is_active is distinct from false;
      if not found then raise exception 'Supplier is unavailable in this organization' using errcode = '22023'; end if;
    end if;
  end if;

  -- The create audit row records the stored balance BEFORE the payment.
  -- The exact restore of the old amount is current stored +
  -- least(old amount, previous): see the header comment.
  select (new_values->>'previous_outstanding_balance')::numeric into v_previous
  from public.audit_logs
  where organization_id = v_org and entity_type = case when p_kind = 'customer' then 'customer_payment' else 'supplier_payment' end
    and entity_id = p_payment_id and action in ('allocated', 'created')
  order by created_at desc limit 1;
  if v_previous is not null then
    v_restore := v_old_party_stored + least(v_old_amount, v_previous);
    v_restored_from := 'recorded';
  else
    v_restore := v_old_party_stored + v_old_amount;
    v_restored_from := 'added_back';
  end if;

  -- Validate every new allocation: shape, scale, duplicates, total, and
  -- that the invoice belongs to the (new) party in this organization.
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

  -- Remaining-balance validation, using the same derivation the UI uses,
  -- against the NEW party — and excluding this payment's own old
  -- allocations, which are replaced by the edit. The pool is computed
  -- BEFORE the new allocations are written, so the edit never funds
  -- itself. Voided payments are excluded from the pool and from the
  -- explicit allocations.
  if p_kind = 'customer' then
    select greatest(
      coalesce((select sum(cp.amount) from public.customer_payments cp
        where cp.organization_id = v_org and cp.customer_id = p_party_id and cp.voided_at is null and cp.id <> p_payment_id), 0)
      - coalesce((select sum(a.amount) from public.customer_payment_allocations a
        join public.sales_transactions st on st.id = a.sales_transaction_id
        where a.organization_id = v_org and st.organization_id = v_org and st.customer_id = p_party_id
          and a.customer_payment_id <> p_payment_id
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
        and a.customer_payment_id <> p_payment_id
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
        where sp.organization_id = v_org and sp.supplier_id = p_party_id and sp.voided_at is null and sp.id <> p_payment_id), 0)
      - coalesce((select sum(a.amount) from public.supplier_payment_allocations a
        join public.purchase_transactions pt on pt.id = a.purchase_transaction_id
        where a.organization_id = v_org and pt.organization_id = v_org and pt.supplier_id = p_party_id
          and a.supplier_payment_id <> p_payment_id
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
        and a.supplier_payment_id <> p_payment_id
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

  -- Apply the edit: replace the allocations, update the payment row, and
  -- move the stored balance(s) by the exact restore + new amount.
  if p_kind = 'customer' then
    delete from public.customer_payment_allocations
    where customer_payment_id = p_payment_id and organization_id = v_org;
    update public.customer_payments
    set customer_id = p_party_id, amount = p_amount, payment_date = p_payment_date,
        payment_method = p_payment_method, notes = p_notes, reference = nullif(p_reference, ''),
        edited_at = now(), edit_request_key = p_request_key, edit_request_fingerprint = v_fingerprint
    where id = p_payment_id and organization_id = v_org;
    if p_party_id = v_old_party_id then
      v_new_stored := greatest(0, v_restore - p_amount);
      update public.customers
      set outstanding_balance = v_new_stored, updated_at = now()
      where id = p_party_id and organization_id = v_org;
    else
      update public.customers
      set outstanding_balance = v_restore, updated_at = now()
      where id = v_old_party_id and organization_id = v_org;
      v_new_stored := greatest(0, v_new_party_stored - p_amount);
      update public.customers
      set outstanding_balance = v_new_stored, updated_at = now()
      where id = p_party_id and organization_id = v_org;
    end if;
    insert into public.audit_logs (
      organization_id, actor_profile_id, action, entity_type, entity_id,
      entity_label, description, new_values
    ) values (
      v_org, v_actor, 'edited', 'customer_payment', p_payment_id, v_party_name,
      'Edited customer payment for ' || v_party_name,
      jsonb_build_object('customer_id', p_party_id, 'old_customer_id', v_old_party_id,
        'old_amount', v_old_amount, 'amount', p_amount,
        'old_payment_method', v_old_method, 'payment_method', p_payment_method,
        'old_payment_date', v_old_date, 'payment_date', p_payment_date,
        'old_notes', v_old_notes, 'notes', p_notes,
        'old_reference', v_old_reference, 'reference', p_reference,
        'allocations', p_allocations, 'request_key', p_request_key,
        'previous_outstanding_balance', v_old_party_stored, 'new_outstanding_balance', v_new_stored,
        'restored_from', v_restored_from)
    );
  else
    delete from public.supplier_payment_allocations
    where supplier_payment_id = p_payment_id and organization_id = v_org;
    update public.supplier_payments
    set supplier_id = p_party_id, amount = p_amount, payment_date = p_payment_date,
        payment_method = p_payment_method, notes = p_notes, reference = nullif(p_reference, ''),
        edited_at = now(), edit_request_key = p_request_key, edit_request_fingerprint = v_fingerprint
    where id = p_payment_id and organization_id = v_org;
    if p_party_id = v_old_party_id then
      v_new_stored := greatest(0, v_restore - p_amount);
      update public.suppliers
      set outstanding_balance = v_new_stored, updated_at = now()
      where id = p_party_id and organization_id = v_org;
    else
      update public.suppliers
      set outstanding_balance = v_restore, updated_at = now()
      where id = v_old_party_id and organization_id = v_org;
      v_new_stored := greatest(0, v_new_party_stored - p_amount);
      update public.suppliers
      set outstanding_balance = v_new_stored, updated_at = now()
      where id = p_party_id and organization_id = v_org;
    end if;
    insert into public.audit_logs (
      organization_id, actor_profile_id, action, entity_type, entity_id,
      entity_label, description, new_values
    ) values (
      v_org, v_actor, 'edited', 'supplier_payment', p_payment_id, v_party_name,
      'Edited supplier payment for ' || v_party_name,
      jsonb_build_object('supplier_id', p_party_id, 'old_supplier_id', v_old_party_id,
        'old_amount', v_old_amount, 'amount', p_amount,
        'old_payment_method', v_old_method, 'payment_method', p_payment_method,
        'old_payment_date', v_old_date, 'payment_date', p_payment_date,
        'old_notes', v_old_notes, 'notes', p_notes,
        'old_reference', v_old_reference, 'reference', p_reference,
        'allocations', p_allocations, 'request_key', p_request_key,
        'previous_outstanding_balance', v_old_party_stored, 'new_outstanding_balance', v_new_stored,
        'restored_from', v_restored_from)
    );
  end if;

  for v_alloc in select value from jsonb_array_elements(p_allocations) loop
    v_alloc_invoice := (v_alloc->>'invoice_id')::uuid;
    v_alloc_amount := (v_alloc->>'amount')::numeric;
    if v_alloc_amount > 0 then
      if p_kind = 'customer' then
        insert into public.customer_payment_allocations (
          organization_id, customer_payment_id, sales_transaction_id, amount
        ) values (v_org, p_payment_id, v_alloc_invoice, v_alloc_amount);
      else
        insert into public.supplier_payment_allocations (
          organization_id, supplier_payment_id, purchase_transaction_id, amount
        ) values (v_org, p_payment_id, v_alloc_invoice, v_alloc_amount);
      end if;
      v_allocated := v_allocated + v_alloc_amount;
    end if;
  end loop;

  return public.payment_atomic_result(p_kind, p_payment_id, false);
end;
$$;

revoke all on function public.edit_payment_atomic(uuid,text,uuid,uuid,numeric,date,text,text,jsonb,text) from public, anon;
grant execute on function public.edit_payment_atomic(uuid,text,uuid,uuid,numeric,date,text,text,jsonb,text) to authenticated;

notify pgrst, 'reload schema';
commit;
