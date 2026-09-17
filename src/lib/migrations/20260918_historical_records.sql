-- Run this complete file manually in Supabase SQL Editor.
-- Archive-only storage. Does not modify stock, cash, payable/receivable balances,
-- existing sales/purchases, or their triggers. Safe to rerun.
begin;

create table if not exists public.historical_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  kind text not null check (kind in ('sale','purchase','customer_payment','supplier_payment')),
  source_system text not null check (length(btrim(source_system)) > 0),
  record_number text not null check (length(btrim(record_number)) > 0),
  party_id uuid not null,
  party_name text not null,
  record_date date not null,
  cutover_date date not null check (record_date < cutover_date),
  total_amount numeric(18,2) not null check (total_amount >= 0 and total_amount < 1e15),
  related_id uuid references public.historical_records(id),
  source_file text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  imported_by uuid not null references public.profiles(id),
  imported_at timestamptz not null default now()
);
create unique index if not exists historical_records_identity
  on public.historical_records(organization_id,kind,lower(btrim(source_system)),lower(btrim(record_number)));
create index if not exists historical_records_party_date on public.historical_records(organization_id,party_id,record_date desc);
alter table public.historical_records enable row level security;
-- All access goes through authenticated server routes; no client-side table access.
revoke all on public.historical_records from public, anon, authenticated, service_role;
grant select, insert on public.historical_records to service_role;

create or replace function public.import_historical_records(
  p_org uuid, p_actor uuid, p_cutover date, p_file text, p_kind text, p_records jsonb
) returns integer language plpgsql security invoker set search_path = public as $$
declare
  doc jsonb; line jsonb; party uuid; related uuid; amount numeric; subtotal numeric;
  qty numeric; price numeric; discount numeric; bonus numeric; header_discount numeric; tax numeric;
  number text; source text; record_day date; count_saved integer := 0; is_payment boolean; is_supplier boolean;
begin
  if p_kind not in ('sale','purchase','customer_payment','supplier_payment') or p_kind is null then raise exception 'Unsupported history type'; end if;
  if p_cutover is null or nullif(btrim(p_file),'') is null then raise exception 'Start date and source file are required'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 5000 then raise exception 'Provide 1 to 5000 historical documents'; end if;
  if not exists(select 1 from profiles where id=p_actor and organization_id=p_org) then raise exception 'Importer does not belong to this organization'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 731));
  if exists(select 1 from historical_records where organization_id=p_org and cutover_date<>p_cutover) then raise exception 'Use the same start date as previously imported history for this business'; end if;
  is_payment := p_kind in ('customer_payment','supplier_payment');
  is_supplier := p_kind in ('purchase','supplier_payment');
  for doc in select value from jsonb_array_elements(p_records) loop
    number := nullif(btrim(doc->>'record_number'),''); source := nullif(btrim(doc->>'source_system'),'');
    party := (doc->>'party_id')::uuid; record_day := (doc->>'record_date')::date;
    amount := (doc->>'total_amount')::numeric; related := nullif(doc->>'related_id','')::uuid;
    if number is null or source is null or record_day is null or record_day >= p_cutover then raise exception 'Each historical record needs a source, reference and date before the start date'; end if;
    if amount is null or amount < 0 or amount >= 1e15 then raise exception 'Invalid historical amount'; end if;
    if is_supplier then
      if not exists(select 1 from suppliers where id=party and organization_id=p_org) then raise exception 'Supplier not found in this organization'; end if;
    else
      if not exists(select 1 from customers where id=party and organization_id=p_org) then raise exception 'Customer not found in this organization'; end if;
    end if;
    if (p_kind='sale' and exists(select 1 from sales_transactions where organization_id=p_org and invoice_type='sales' and lower(btrim(invoice_number))=lower(number)))
      or (p_kind='purchase' and exists(select 1 from purchase_transactions where organization_id=p_org and invoice_type='purchase' and lower(btrim(invoice_number))=lower(number)))
      or (p_kind='customer_payment' and exists(select 1 from customer_payments where organization_id=p_org and customer_id=party and lower(btrim(reference_number))=lower(number)))
      or (p_kind='supplier_payment' and exists(select 1 from supplier_payments where organization_id=p_org and supplier_id=party and lower(btrim(reference_number))=lower(number))) then
      raise exception 'Reference % already exists in live transactions', number;
    end if;
    if is_payment then
      if amount <= 0 or amount <> round(amount,2) then raise exception 'Payment must be positive with at most two decimal places'; end if;
      if related is not null and not exists(select 1 from historical_records where id=related and organization_id=p_org and party_id=party and kind=case when is_supplier then 'purchase' else 'sale' end and lower(btrim(source_system))=lower(source)) then raise exception 'Related invoice does not match this party and source'; end if;
    else
      if related is not null then raise exception 'Invoices cannot be linked as payments'; end if;
      if doc->>'payment_type' is null or doc->>'payment_type' not in ('cash','credit') then raise exception 'Invalid invoice payment type'; end if;
      if jsonb_typeof(doc->'lines') is distinct from 'array' or jsonb_array_length(doc->'lines') not between 1 and 5000 then raise exception 'Invoice lines are required'; end if;
      subtotal := 0;
      for line in select value from jsonb_array_elements(doc->'lines') loop
        if not exists(select 1 from products where id=(line->>'product_id')::uuid and organization_id=p_org) then raise exception 'Product not found in this organization'; end if;
        qty := (line->>'quantity')::numeric; price := (line->>'unit_price')::numeric;
        discount := coalesce((line->>'discount')::numeric,0); bonus := coalesce((line->>'bonus')::numeric,0);
        if qty is null or qty<=0 or qty>=1e15 or price is null or price<0 or price>=1e15 or discount<0 or discount>qty*price or bonus<0 or bonus>=1e15 then raise exception 'Invalid historical line amount or quantity'; end if;
        if line->>'unit_mode' is null or line->>'unit_mode' not in ('main','subunit') then raise exception 'Invalid historical unit mode'; end if;
        subtotal := subtotal + qty*price-discount;
      end loop;
      header_discount:=coalesce((doc->>'discount_amount')::numeric,0); tax:=coalesce((doc->>'tax_amount')::numeric,0);
      if header_discount<0 or header_discount>subtotal or tax<0 or tax>=1e15 or abs(round(subtotal-header_discount+tax,2)-amount)>0.01 then raise exception 'Historical invoice total does not reconcile'; end if;
      if doc->>'paid_amount' is not null and ((doc->>'paid_amount')::numeric<0 or (doc->>'paid_amount')::numeric>amount) then raise exception 'Invalid source paid amount'; end if;
    end if;
    insert into historical_records(organization_id,kind,source_system,record_number,party_id,party_name,record_date,cutover_date,total_amount,related_id,source_file,payload,imported_by)
      values(p_org,p_kind,source,number,party,coalesce(doc->>'party_name',''),record_day,p_cutover,amount,related,p_file,doc,p_actor);
    count_saved := count_saved+1;
  end loop;
  return count_saved;
end $$;
revoke all on function public.import_historical_records(uuid,uuid,date,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_historical_records(uuid,uuid,date,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
