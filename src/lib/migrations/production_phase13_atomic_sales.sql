-- Atomic finalized owner sales. Staff sales continue through the draft route.
begin;

alter table public.sales_transactions
  add column if not exists request_id uuid,
  add column if not exists request_fingerprint text,
  add column if not exists cash_received numeric(14,2) not null default 0,
  add column if not exists change_due numeric(14,2) not null default 0;

create unique index if not exists sales_transactions_org_request_id_uidx
  on public.sales_transactions (organization_id, request_id)
  where request_id is not null;

-- Internal response builder; only the two authenticated RPCs below can call it.
create or replace function public.sales_atomic_result(p_sale_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'transaction', to_jsonb(st) - 'request_fingerprint',
    'customer_name', c.customer_name,
    'items', coalesce((
      select jsonb_agg(to_jsonb(si) || jsonb_build_object(
        'product_name', p.name,
        'unit_type', p.unit_type,
        'subunit_type', p.subunit_type
      ))
      from public.sales_items si
      join public.products p on p.id = si.product_id
      where si.sales_transaction_id = st.id
    ), '[]'::jsonb),
    'replayed', p_replayed
  )
  from public.sales_transactions st
  join public.customers c on c.id = st.customer_id
  where st.id = p_sale_id;
$$;

create or replace function public.create_sales_invoice_atomic(p_request_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_customer public.customers%rowtype;
  v_product public.products%rowtype;
  v_sale public.sales_transactions%rowtype;
  v_line jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_price numeric;
  v_discount numeric;
  v_bonus numeric;
  v_unit_mode text;
  v_line_subtotal numeric := 0;
  v_invoice_discount_input numeric := 0;
  v_invoice_discount_type text := 'flat';
  v_invoice_discount numeric := 0;
  v_tax_rate numeric := 0;
  v_tax numeric := 0;
  v_taxable numeric := 0;
  v_total numeric := 0;
  v_payment_type text;
  v_sale_date date;
  v_cash_received numeric := 0;
  v_change_due numeric := 0;
  v_credit_override boolean := false;
  v_credit_policy text;
  v_credit_limit numeric;
  v_credit_days integer;
  v_due_date date;
  v_outstanding numeric := 0;
  v_overdue_count integer := 0;
  v_legacy_pool numeric := 0;
  v_invoice record;
  v_remaining numeric;
  v_invoice_total numeric;
  v_explicit numeric;
  v_fallback numeric;
  v_sequence bigint;
  v_invoice_number text;
  v_fingerprint text;
  v_existing public.sales_transactions%rowtype;
  v_item_id uuid;
  v_purchase_price numeric;
  v_purchase_unit_mode text;
begin
  if v_actor is null or p_request_id is null or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'Authenticated actor, request id, and sale object are required' using errcode = '22023';
  end if;

  select p.organization_id into v_org
  from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null or not public.sales_tool_allowed(v_org, 'owner') then
    raise exception 'Owner sales permission is required' using errcode = '42501';
  end if;

  v_fingerprint := md5(p_input::text);
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_request_id::text, 0));
  select * into v_existing from public.sales_transactions
  where organization_id = v_org and request_id = p_request_id;
  if found then
    if v_existing.created_by_profile_id <> v_actor then
      raise exception 'Request id belongs to another actor' using errcode = '42501';
    end if;
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'Request id was already used for different sale contents' using errcode = '22023';
    end if;
    return public.sales_atomic_result(v_existing.id, true);
  end if;

  if jsonb_typeof(p_input->'lines') is distinct from 'array' then
    raise exception 'Sale lines must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_input->'lines') = 0 or jsonb_array_length(p_input->'lines') > 500 then
    raise exception 'A sale must contain between 1 and 500 lines' using errcode = '22023';
  end if;
  if coalesce(p_input->>'customer_id', '') = '' then
    raise exception 'Customer is required' using errcode = '22023';
  end if;
  v_sale_date := nullif(p_input->>'sale_date', '')::date;
  if v_sale_date is null then raise exception 'Sale date is required' using errcode = '22023'; end if;
  v_payment_type := lower(coalesce(p_input->>'payment_type', ''));
  if v_payment_type not in ('cash', 'credit') then raise exception 'Invalid payment type' using errcode = '22023'; end if;
  v_credit_override := coalesce((p_input->>'credit_override_confirmed')::boolean, false);

  select * into v_customer from public.customers
  where id = (p_input->>'customer_id')::uuid and organization_id = v_org
    and is_active is distinct from false
  for update;
  if not found then raise exception 'Customer is unavailable in this organization' using errcode = '22023'; end if;

  -- Lock products in a stable order. The existing sales_items trigger remains
  -- the only stock writer and applies subunit/bonus conversion and stock policy.
  perform 1 from public.products p
  where p.organization_id = v_org and p.id in (
    select distinct (value->>'product_id')::uuid from jsonb_array_elements(p_input->'lines')
  ) order by p.id for update;

  for v_line in select value from jsonb_array_elements(p_input->'lines') loop
    if jsonb_typeof(v_line) is distinct from 'object' then raise exception 'Invalid sale line' using errcode = '22023'; end if;
    v_product_id := (v_line->>'product_id')::uuid;
    v_quantity := round((v_line->>'quantity')::numeric, 2);
    v_price := round((v_line->>'selling_price')::numeric, 2);
    v_discount := round(coalesce(nullif(v_line->>'discount', '')::numeric, 0), 2);
    v_bonus := round(coalesce(nullif(v_line->>'bonus', '')::numeric, 0), 2);
    v_unit_mode := coalesce(nullif(v_line->>'unit_mode', ''), 'main');
    if v_quantity is null or v_quantity <= 0 or v_quantity::text in ('NaN','Infinity','-Infinity')
      or v_price is null or v_price < 0 or v_price::text in ('NaN','Infinity','-Infinity')
      or v_discount < 0 or v_discount::text in ('NaN','Infinity','-Infinity')
      or v_bonus < 0 or v_bonus::text in ('NaN','Infinity','-Infinity')
      or v_unit_mode not in ('main','subunit')
      or v_discount > v_quantity * v_price then
      raise exception 'Invalid quantity, price, unit, bonus, or line discount' using errcode = '22023';
    end if;
    select * into v_product from public.products
    where id = v_product_id and organization_id = v_org and is_active is distinct from false;
    if not found then raise exception 'Product is unavailable in this organization' using errcode = '22023'; end if;
    if v_unit_mode = 'subunit' and coalesce(v_product.units_per_pack, 0) <= 0 then
      raise exception 'Configure units per pack before selling sub-units' using errcode = '22023';
    end if;
    v_line_subtotal := v_line_subtotal + (v_quantity * v_price) - v_discount;
  end loop;

  v_invoice_discount_input := coalesce(nullif(p_input->>'invoice_discount', '')::numeric, 0);
  v_invoice_discount_type := coalesce(nullif(p_input->>'invoice_discount_type', ''), 'flat');
  v_tax_rate := coalesce(nullif(p_input->>'tax_rate', '')::numeric, 0);
  if v_invoice_discount_input < 0 or v_invoice_discount_input::text in ('NaN','Infinity','-Infinity')
    or v_invoice_discount_type not in ('flat','percent')
    or (v_invoice_discount_type = 'percent' and v_invoice_discount_input > 100)
    or (v_invoice_discount_type = 'flat' and v_invoice_discount_input > v_line_subtotal)
    or v_tax_rate < 0 or v_tax_rate > 999.99 or v_tax_rate::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Invalid invoice discount or tax rate' using errcode = '22023';
  end if;
  v_tax_rate := round(v_tax_rate, 2);
  v_invoice_discount := round(case when v_invoice_discount_type = 'percent'
    then v_line_subtotal * v_invoice_discount_input / 100 else v_invoice_discount_input end, 2);
  v_taxable := greatest(0, v_line_subtotal - v_invoice_discount);
  v_tax := round(v_taxable * v_tax_rate / 100, 2);
  v_total := round(v_taxable + v_tax, 2);

  if v_payment_type = 'cash' then
    -- The advanced invoice form has no tender input; treat its cash invoice as exact.
    -- The quick POS always sends an explicit amount (including zero for blank input).
    v_cash_received := coalesce(nullif(p_input->>'cash_received', '')::numeric, v_total);
    if v_cash_received < 0 or v_cash_received::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Invalid cash received amount' using errcode = '22023';
    end if;
    if v_cash_received < v_total then raise exception 'Cash received is less than the sale total' using errcode = '22023'; end if;
    v_cash_received := round(v_cash_received, 2);
    v_change_due := round(v_cash_received - v_total, 2);
  end if;

  if v_payment_type = 'credit' then
    v_credit_policy := coalesce(v_customer.credit_policy, 'cash_only');
    if v_credit_policy = 'cash_only' or v_credit_policy not in ('cash_only','limit_only','days_only','limit_and_days','unrestricted') then
      raise exception 'This customer is not configured for credit sales' using errcode = '22023';
    end if;
    v_credit_limit := coalesce(v_customer.credit_limit, 0);
    v_credit_days := coalesce(v_customer.credit_days, 0);
    if v_credit_days < 0 or v_credit_days > 36500 or v_credit_limit < 0 then
      raise exception 'Customer credit terms are invalid' using errcode = '22023';
    end if;

    select greatest(
      coalesce((select sum(cp.amount) from public.customer_payments cp
        where cp.organization_id = v_org and cp.customer_id = v_customer.id), 0)
      - coalesce((select sum(a.amount) from public.customer_payment_allocations a
        join public.sales_transactions st on st.id = a.sales_transaction_id
        where a.organization_id = v_org and st.organization_id = v_org and st.customer_id = v_customer.id), 0),
      0
    ) into v_legacy_pool;

    for v_invoice in
      select st.id, st.sale_date, st.created_at, st.credit_due_date, st.total_amount,
        coalesce((select sum(si.quantity * si.selling_price - si.discount)
          from public.sales_items si where si.sales_transaction_id = st.id), 0) as line_total,
        coalesce((select sum(a.amount) from public.customer_payment_allocations a
          where a.organization_id = v_org and a.sales_transaction_id = st.id), 0) as allocated
      from public.sales_transactions st
      where st.organization_id = v_org and st.customer_id = v_customer.id
        and st.payment_type = 'credit' and st.status in ('confirmed','paid','partially_paid')
      order by coalesce(st.sale_date, st.created_at::date), st.created_at, st.id
    loop
      v_invoice_total := case when coalesce(v_invoice.total_amount, 0) > 0 then v_invoice.total_amount
        else greatest(0, v_invoice.line_total - coalesce((select st2.discount_amount from public.sales_transactions st2 where st2.id = v_invoice.id),0))
          + coalesce((select st2.tax_amount from public.sales_transactions st2 where st2.id = v_invoice.id),0) end;
      v_remaining := greatest(0, v_invoice_total - v_invoice.allocated);
      v_fallback := least(v_legacy_pool, v_remaining);
      v_legacy_pool := greatest(0, v_legacy_pool - v_fallback);
      v_remaining := greatest(0, v_remaining - v_fallback);
      v_outstanding := v_outstanding + v_remaining;
      if v_remaining > 0 and v_invoice.credit_due_date < current_date then v_overdue_count := v_overdue_count + 1; end if;
    end loop;

    if v_credit_policy in ('limit_only','limit_and_days') and v_outstanding + v_total > v_credit_limit then
      if not coalesce(v_customer.allow_over_limit, false) then raise exception 'Customer credit limit exceeded' using errcode = '22023'; end if;
      if not v_credit_override then raise exception 'Credit limit override confirmation is required' using errcode = '22023'; end if;
    end if;
    if v_credit_policy in ('days_only','limit_and_days') and v_overdue_count > 0 then
      if not coalesce(v_customer.allow_overdue_sales, false) then raise exception 'Customer has overdue credit invoices' using errcode = '22023'; end if;
      if not v_credit_override then raise exception 'Overdue credit override confirmation is required' using errcode = '22023'; end if;
    end if;
    if v_credit_policy in ('days_only','limit_and_days') or (v_credit_policy = 'unrestricted' and v_credit_days > 0) then
      v_due_date := v_sale_date + v_credit_days;
    end if;
  end if;

  v_sequence := public.next_invoice_number(v_org, 'sales');
  if v_sequence is null or v_sequence <= 0 then raise exception 'Could not allocate sale invoice number'; end if;
  v_invoice_number := 'S-' || lpad((100000 + v_sequence)::text, 6, '0');

  insert into public.sales_transactions (
    customer_id, invoice_number, sale_date, payment_type, credit_due_date,
    credit_limit_snapshot, credit_days_snapshot, notes, organization_id,
    total_amount, discount_amount, tax_rate, tax_amount, status, invoice_type,
    created_by_profile_id, request_id, request_fingerprint, cash_received, change_due
  ) values (
    v_customer.id, v_invoice_number, v_sale_date, v_payment_type, v_due_date,
    case when v_credit_policy in ('limit_only','limit_and_days') and v_payment_type = 'credit' then v_credit_limit end,
    case when v_payment_type = 'credit' and (v_credit_policy in ('days_only','limit_and_days') or (v_credit_policy = 'unrestricted' and v_credit_days > 0)) then v_credit_days end,
    null, v_org, v_total, round(v_invoice_discount,2), v_tax_rate, v_tax,
    case when v_payment_type = 'cash' then 'paid' else 'confirmed' end,
    'sales', v_actor, p_request_id, v_fingerprint, v_cash_received, v_change_due
  ) returning * into v_sale;

  for v_line in select value from jsonb_array_elements(p_input->'lines') loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_quantity := round((v_line->>'quantity')::numeric, 2);
    v_price := round((v_line->>'selling_price')::numeric, 2);
    v_discount := round(coalesce(nullif(v_line->>'discount', '')::numeric, 0), 2);
    v_bonus := round(coalesce(nullif(v_line->>'bonus', '')::numeric, 0), 2);
    v_unit_mode := coalesce(nullif(v_line->>'unit_mode', ''), 'main');
    select * into v_product from public.products
    where id = v_product_id and organization_id = v_org;
    v_purchase_price := null;
    v_purchase_unit_mode := null;
    select pi.purchase_price, pi.unit_mode into v_purchase_price, v_purchase_unit_mode
    from public.purchase_items pi
    join public.purchase_transactions pt on pt.id = pi.purchase_transaction_id
    where pi.organization_id = v_org and pt.organization_id = v_org and pi.product_id = v_product_id
      and pi.purchase_price > 0
    order by pt.created_at desc, pi.id
    limit 1;
    if v_purchase_unit_mode = 'subunit' and coalesce(v_product.units_per_pack, 0) > 0 then
      v_purchase_price := v_purchase_price * v_product.units_per_pack;
    end if;
    if v_purchase_price is null or v_purchase_price <= 0 then
      v_purchase_price := case when coalesce(v_product.last_purchase_price, 0) > 0 then v_product.last_purchase_price end;
    end if;
    insert into public.sales_items (
      sales_transaction_id, product_id, quantity, selling_price, purchase_price_snapshot,
      discount, bonus, unit_mode, organization_id
    ) values (
      v_sale.id, v_product_id, v_quantity, v_price, v_purchase_price,
      v_discount, v_bonus, v_unit_mode, v_org
    );
  end loop;

  if v_payment_type = 'cash' and v_total > 0 then
    insert into public.customer_payments (
      organization_id, customer_id, amount, payment_date, payment_method, notes
    ) values (
      v_org, v_customer.id, v_total, v_sale_date, 'cash',
      'Payment received against invoice ' || v_invoice_number
    ) returning id into v_item_id;
    insert into public.customer_payment_allocations (
      customer_payment_id, sales_transaction_id, amount, organization_id
    ) values (v_item_id, v_sale.id, v_total, v_org);
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, action, entity_type, entity_id,
    entity_label, description, new_values
  ) values (
    v_org, v_actor, 'created', 'sales_invoice', v_sale.id, v_invoice_number,
    'Created sales invoice ' || v_invoice_number || ' for ' || v_customer.customer_name,
    jsonb_build_object('customer_id',v_customer.id,'invoice_number',v_invoice_number,
      'sale_date',v_sale_date,'payment_type',v_payment_type,'total_amount',v_total,
      'request_id',p_request_id)
  );

  return public.sales_atomic_result(v_sale.id, false);
end;
$$;

create or replace function public.get_sales_invoice_request_status(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_sale public.sales_transactions%rowtype;
begin
  if v_actor is null or p_request_id is null then
    raise exception 'Authenticated actor and request id are required' using errcode = '22023';
  end if;
  select p.organization_id into v_org from public.profiles p
  where p.id = v_actor and p.is_active is distinct from false;
  if v_org is null or not public.sales_tool_allowed(v_org, 'owner') then
    raise exception 'Owner sales permission is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_request_id::text, 0));
  select * into v_sale from public.sales_transactions
  where organization_id = v_org and request_id = p_request_id;
  if not found then return jsonb_build_object('status','unknown'); end if;
  if v_sale.created_by_profile_id <> v_actor then
    raise exception 'Request id belongs to another actor' using errcode = '42501';
  end if;
  return jsonb_build_object('status','confirmed','result',public.sales_atomic_result(v_sale.id,true));
end;
$$;

revoke all on function public.sales_atomic_result(uuid,boolean) from public, anon, authenticated;
revoke all on function public.create_sales_invoice_atomic(uuid,jsonb) from public, anon;
revoke all on function public.get_sales_invoice_request_status(uuid) from public, anon;
grant execute on function public.create_sales_invoice_atomic(uuid,jsonb) to authenticated;
grant execute on function public.get_sales_invoice_request_status(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
