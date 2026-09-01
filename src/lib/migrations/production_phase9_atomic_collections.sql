-- TradeOS production phase 9: atomic collection decisions.
--
-- A collection approval changes four related records: the collection, the
-- customer payment, invoice allocations, and the customer balance. Keeping
-- those writes in one PostgreSQL function guarantees that either every write
-- commits or every write rolls back.

create or replace function public.process_collection_decision(
  p_organization_id uuid,
  p_collection_id uuid,
  p_actor_profile_id uuid,
  p_action text,
  p_notes text default null,
  p_processed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collection public.collections%rowtype;
  v_customer public.customers%rowtype;
  v_invoice record;
  v_payment_id uuid;
  v_employee_profile_id uuid;
  v_payment_method text;
  v_remaining numeric := 0;
  v_allocation numeric := 0;
  v_allocated numeric := 0;
begin
  if p_organization_id is null or p_collection_id is null or p_actor_profile_id is null then
    raise exception using
      errcode = '22023',
      message = 'process_collection_decision: organization, collection, and actor are required';
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception using
      errcode = '22023',
      message = 'process_collection_decision: action must be approve or reject';
  end if;

  if p_processed_at is null then
    raise exception using
      errcode = '22023',
      message = 'process_collection_decision: processed time is required';
  end if;

  perform 1
  from public.profiles
  where id = p_actor_profile_id
    and organization_id = p_organization_id
    and is_active is distinct from false;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'process_collection_decision: actor does not belong to this organization';
  end if;

  select *
  into v_collection
  from public.collections
  where id = p_collection_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'process_collection_decision: collection not found';
  end if;

  if v_collection.status <> 'pending' then
    raise exception using
      errcode = 'P0001',
      message = format('process_collection_decision: collection is already %s', v_collection.status);
  end if;

  if v_collection.amount is null or v_collection.amount <= 0 then
    raise exception using
      errcode = '22023',
      message = 'process_collection_decision: collection amount must be greater than zero';
  end if;

  update public.collections
  set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      approved_by = p_actor_profile_id,
      approved_at = p_processed_at,
      notes = coalesce(p_notes, v_collection.notes),
      updated_at = p_processed_at
  where id = p_collection_id
    and organization_id = p_organization_id
  returning * into v_collection;

  if p_action = 'approve' then
    -- The customer lock serializes concurrent approvals for the same customer,
    -- preventing lost balance updates and duplicate over-allocation.
    select *
    into v_customer
    from public.customers
    where id = v_collection.customer_id
      and organization_id = p_organization_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'process_collection_decision: customer not found';
    end if;

    v_payment_method := case
      when v_collection.method = 'bank_transfer' then 'bank'
      when v_collection.method = 'cash' then 'cash'
      else 'other'
    end;

    insert into public.customer_payments (
      organization_id,
      customer_id,
      amount,
      payment_date,
      payment_method,
      notes
    ) values (
      p_organization_id,
      v_collection.customer_id,
      v_collection.amount,
      (p_processed_at at time zone 'UTC')::date,
      v_payment_method,
      format(
        'Approved collection %s%s',
        p_collection_id,
        case
          when v_collection.reference_number is not null
            then format(' (%s)', v_collection.reference_number)
          else ''
        end
      )
    )
    returning id into v_payment_id;

    v_remaining := v_collection.amount;

    for v_invoice in
      select
        transaction.id,
        greatest(
          coalesce(transaction.total_amount, 0) - coalesce(sum(allocation.amount), 0),
          0
        ) as amount_due
      from public.sales_transactions as transaction
      left join public.customer_payment_allocations as allocation
        on allocation.sales_transaction_id = transaction.id
       and allocation.organization_id = p_organization_id
      where transaction.organization_id = p_organization_id
        and transaction.customer_id = v_collection.customer_id
        and transaction.payment_type = 'credit'
        and transaction.status not in ('cancelled', 'void')
      group by transaction.id, transaction.total_amount, transaction.sale_date, transaction.created_at
      order by transaction.sale_date asc nulls last, transaction.created_at asc, transaction.id asc
    loop
      exit when v_remaining <= 0;
      v_allocation := least(v_invoice.amount_due, v_remaining);

      if v_allocation > 0 then
        insert into public.customer_payment_allocations (
          organization_id,
          customer_payment_id,
          sales_transaction_id,
          amount
        ) values (
          p_organization_id,
          v_payment_id,
          v_invoice.id,
          v_allocation
        );
        v_remaining := v_remaining - v_allocation;
        v_allocated := v_allocated + v_allocation;
      end if;
    end loop;

    update public.customers
    set outstanding_balance = greatest(
          0,
          coalesce(v_customer.outstanding_balance, 0) - v_collection.amount
        ),
        updated_at = p_processed_at
    where id = v_collection.customer_id
      and organization_id = p_organization_id;
  end if;

  select profile_id
  into v_employee_profile_id
  from public.employees
  where id = v_collection.employee_id
    and organization_id = p_organization_id;

  return jsonb_build_object(
    'collection', to_jsonb(v_collection),
    'employee_profile_id', v_employee_profile_id,
    'payment_id', v_payment_id,
    'allocated_amount', v_allocated,
    'unapplied_amount', greatest(v_remaining, 0)
  );
end;
$$;

revoke all on function public.process_collection_decision(uuid, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_collection_decision(uuid, uuid, uuid, text, text, timestamptz)
  to service_role;

select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'process_collection_decision';
