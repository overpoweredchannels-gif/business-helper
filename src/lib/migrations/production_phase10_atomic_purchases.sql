-- Apply before deploying the purchase service. All mutations run in one transaction.
-- Only the server service role may call these functions; API permission checks
-- precede every call. Actor membership is checked again inside the transaction.
begin;
alter table public.suppliers add column if not exists outstanding_balance numeric not null default 0;
alter table public.suppliers add column if not exists last_purchase_date date;
alter table public.suppliers add column if not exists updated_at timestamptz not null default now();
-- Older deployed schemas lack the payment/adjustment fields used by the service.
alter table public.purchase_transactions add column if not exists payment_type text not null default 'cash';
alter table public.purchase_transactions add column if not exists credit_due_date date;
alter table public.purchase_transactions add column if not exists discount_amount numeric not null default 0;
alter table public.purchase_transactions add column if not exists tax_amount numeric not null default 0;
alter table public.purchase_transactions add column if not exists tax_rate numeric not null default 0;
alter table public.purchase_transactions add column if not exists request_key text;
alter table public.purchase_transactions add column if not exists request_fingerprint text;
create unique index if not exists purchase_transactions_request_key_unique
  on public.purchase_transactions (organization_id, request_key) where request_key is not null;

create or replace function public.create_purchase_atomic(
  p_organization_id uuid, p_actor_profile_id uuid, p_input jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tx public.purchase_transactions%rowtype;
  v_item public.purchase_items%rowtype;
  v_supplier public.suppliers%rowtype;
  v_po public.purchase_orders%rowtype;
  v_po_item public.purchase_order_items%rowtype;
  v_line jsonb;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_sequence bigint;
  v_invoice text;
  v_request text := nullif(p_input->>'request_key', '');
  v_payment text := coalesce(nullif(lower(p_input->>'payment_type'), ''), 'cash');
  v_date date := coalesce(nullif(p_input->>'purchase_date','')::date, current_date);
  v_credit_days integer := coalesce(nullif(p_input->>'credit_days','')::integer, 0);
  v_discount numeric := coalesce(nullif(p_input->>'discount_amount','')::numeric, 0);
  v_tax numeric := coalesce(nullif(p_input->>'tax_amount','')::numeric, 0);
  v_po_id uuid := nullif(p_input->>'purchase_order_id','')::uuid;
begin
  if not exists (select 1 from profiles where id = p_actor_profile_id
    and organization_id = p_organization_id and is_active is distinct from false) then
    raise exception 'Active organization actor required' using errcode = '42501';
  end if;
  if v_request is not null then
    if length(v_request) > 150 then raise exception 'Request key is too long'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || v_request, 0));
    select * into v_tx from purchase_transactions where organization_id = p_organization_id and request_key = v_request;
    if found then
      if v_tx.created_by_profile_id <> p_actor_profile_id then raise exception 'Request key belongs to another actor'; end if;
      if v_tx.request_fingerprint is distinct from md5((p_input - 'request_key')::text) then raise exception 'Request key was already used for a different purchase'; end if;
      return jsonb_build_object('transaction', to_jsonb(v_tx), 'items',
        (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from purchase_items i where purchase_transaction_id = v_tx.id), 'replayed', true);
    end if;
  end if;
  if jsonb_typeof(p_input->'lines') is distinct from 'array' then raise exception 'Purchase lines must be an array'; end if;
  if jsonb_array_length(p_input->'lines') = 0 then raise exception 'At least one purchase line is required'; end if;
  if v_payment not in ('cash','credit') or v_credit_days < 0 or v_credit_days > 36500 then raise exception 'Invalid purchase payment terms'; end if;
  if v_discount < 0 or v_tax < 0 or v_discount::text in ('NaN','Infinity','-Infinity') or v_tax::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid purchase adjustments'; end if;

  select * into v_supplier from suppliers where id = (p_input->>'supplier_id')::uuid
    and organization_id = p_organization_id for update;
  if not found then raise exception 'Supplier not found'; end if;
  if v_po_id is not null then
    select * into v_po from purchase_orders where id = v_po_id and organization_id = p_organization_id for update;
    if not found or v_po.supplier_id <> v_supplier.id or v_po.status not in ('ordered','partial') then raise exception 'Purchase order cannot be received'; end if;
  end if;
  -- Consistent product lock order prevents opposing multi-product purchases deadlocking.
  perform 1 from products where organization_id = p_organization_id and id::text in
    (select value->>'product_id' from jsonb_array_elements(p_input->'lines')) order by id for update;
  for v_line in select value from jsonb_array_elements(p_input->'lines') loop
    v_item := jsonb_populate_record(null::public.purchase_items, v_line);
    if v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity::text in ('NaN','Infinity','-Infinity')
      or v_item.purchase_price is null or v_item.purchase_price < 0 or v_item.purchase_price::text in ('NaN','Infinity','-Infinity')
      or (v_item.selling_price is not null and (v_item.selling_price < 0 or v_item.selling_price::text in ('NaN','Infinity','-Infinity')))
      or coalesce(v_item.unit_mode,'main') not in ('main','subunit') then raise exception 'Invalid purchase line'; end if;
    if not exists (select 1 from products where id = v_item.product_id and organization_id = p_organization_id) then raise exception 'Product not found in organization'; end if;
    if v_po_id is not null then
      select * into v_po_item from purchase_order_items where id = (v_line->>'order_item_id')::uuid
        and purchase_order_id = v_po_id and product_id = v_item.product_id for update;
      if not found or v_po_item.quantity_received + v_item.quantity > v_po_item.quantity_ordered then raise exception 'Receipt exceeds purchase order remaining quantity'; end if;
      update purchase_order_items set quantity_received = quantity_received + v_item.quantity,
        unit_price = v_item.purchase_price, batch_number = v_item.batch_number, expiry_date = v_item.expiry_date where id = v_po_item.id;
    end if;
    v_total := v_total + v_item.quantity * v_item.purchase_price;
  end loop;
  v_total := v_total - v_discount + v_tax;
  if v_total < 0 then raise exception 'Discount exceeds purchase total'; end if;
  v_invoice := nullif(p_input->>'import_invoice_number','');
  if v_invoice is null then
    v_sequence := public.next_invoice_number(p_organization_id, 'purchase');
    if v_sequence is null or v_sequence <= 0 then raise exception 'Invalid invoice sequence'; end if;
    v_invoice := 'P-' || (50000 + v_sequence)::text;
  end if;
  insert into purchase_transactions (organization_id, supplier_id, invoice_number, supplier_invoice_number,
    purchase_date, payment_type, credit_due_date, notes, total_amount, discount_amount, tax_amount,
    status, invoice_type, created_by_profile_id, request_key, request_fingerprint)
  values (p_organization_id, v_supplier.id, v_invoice, nullif(p_input->>'supplier_invoice_number',''), v_date, v_payment,
    case when v_payment = 'credit' then coalesce(nullif(p_input->>'credit_due_date','')::date, v_date + v_credit_days) else null end,
    nullif(p_input->>'notes',''), v_total, v_discount, v_tax, 'confirmed', 'purchase', p_actor_profile_id, v_request, md5((p_input - 'request_key')::text))
  returning * into v_tx;
  for v_line in select value from jsonb_array_elements(p_input->'lines') loop
    v_item := jsonb_populate_record(null::public.purchase_items, v_line);
    insert into purchase_items (purchase_transaction_id, organization_id, product_id, quantity, purchase_price,
      selling_price, batch_number, expiry_date, unit_mode)
    values (v_tx.id, p_organization_id, v_item.product_id, v_item.quantity, v_item.purchase_price,
      v_item.selling_price, v_item.batch_number, v_item.expiry_date, coalesce(v_item.unit_mode,'main')) returning * into v_item;
    v_items := v_items || jsonb_build_array(to_jsonb(v_item));
    if v_item.selling_price is not null then
      update products set default_selling_price = v_item.selling_price where id = v_item.product_id and organization_id = p_organization_id;
    end if;
  end loop;
  update suppliers set outstanding_balance = coalesce(outstanding_balance,0) + case when v_payment = 'credit' then v_total else 0 end,
    last_purchase_date = greatest(last_purchase_date, v_date), updated_at = now() where id = v_supplier.id and organization_id = p_organization_id;
  if v_po_id is not null then
    update purchase_orders set status = case when exists (select 1 from purchase_order_items where purchase_order_id = v_po_id
      and quantity_received < quantity_ordered) then 'partial' else 'received' end, updated_at = now() where id = v_po_id;
  end if;
  insert into audit_logs (organization_id, actor_profile_id, action, entity_type, entity_id, entity_label, description, new_values)
    values (p_organization_id, p_actor_profile_id, 'purchase_created', 'purchase_transaction', v_tx.id, v_invoice,
      'Created purchase ' || v_invoice, jsonb_build_object('total_amount',v_total,'supplier_id',v_supplier.id,'purchase_order_id',v_po_id));
  return jsonb_build_object('transaction',to_jsonb(v_tx),'items',v_items,'purchase_order_status',
    (select status from purchase_orders where id = v_po_id));
end $$;

create or replace function public.delete_purchase_atomic(p_organization_id uuid, p_actor_profile_id uuid, p_purchase_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tx public.purchase_transactions%rowtype;
begin
  if not exists (select 1 from profiles where id = p_actor_profile_id and organization_id = p_organization_id and is_active is distinct from false) then
    raise exception 'Active organization actor required' using errcode = '42501'; end if;
  select * into v_tx from purchase_transactions where id = p_purchase_id and organization_id = p_organization_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  -- Never silently remove financial links or receipts. These must be reversed explicitly.
  if exists (select 1 from supplier_payment_allocations where purchase_transaction_id = p_purchase_id)
    or exists (select 1 from expenses where purchase_transaction_id = p_purchase_id)
    or exists (select 1 from purchase_returns where purchase_transaction_id = p_purchase_id)
    or exists (select 1 from audit_logs where organization_id = p_organization_id and entity_id::text = p_purchase_id::text
      and new_values->>'purchase_order_id' is not null) then raise exception 'Purchase has linked records; reverse them before deleting'; end if;
  perform 1 from suppliers where id = v_tx.supplier_id and organization_id = p_organization_id for update;
  perform 1 from products where organization_id = p_organization_id and id in
    (select product_id from purchase_items where purchase_transaction_id = p_purchase_id) order by id for update;
  delete from purchase_items where purchase_transaction_id = p_purchase_id and organization_id = p_organization_id;
  delete from purchase_transactions where id = p_purchase_id and organization_id = p_organization_id;
  if lower(v_tx.payment_type) = 'credit' then
    update suppliers set outstanding_balance = coalesce(outstanding_balance,0) - coalesce(v_tx.total_amount,0), updated_at = now()
      where id = v_tx.supplier_id and organization_id = p_organization_id;
  end if;
  insert into audit_logs (organization_id, actor_profile_id, action, entity_type, entity_id, entity_label, description, old_values)
    values (p_organization_id,p_actor_profile_id,'purchase_deleted','purchase_transaction',p_purchase_id,v_tx.invoice_number,
      'Deleted purchase ' || v_tx.invoice_number,to_jsonb(v_tx));
end $$;
revoke all on function public.create_purchase_atomic(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.delete_purchase_atomic(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_purchase_atomic(uuid,uuid,jsonb) to service_role;
grant execute on function public.delete_purchase_atomic(uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;

select
  to_regprocedure('public.create_purchase_atomic(uuid,uuid,jsonb)') is not null as purchase_create_ready,
  to_regprocedure('public.delete_purchase_atomic(uuid,uuid,uuid)') is not null as purchase_delete_ready;
