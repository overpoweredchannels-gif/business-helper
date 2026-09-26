-- Run only after production_phase13_atomic_sales.sql has been re-run with the
-- three-decimal request validation. Deploy the application only after this
-- migration succeeds. It widens quantity/stock scales and preserves existing
-- values; the guards refuse a lossy conversion or an unexpected live schema.
begin;

do $$
declare
  v_table text;
  v_column text;
  v_max_scale integer;
  v_scale integer;
begin
  for v_table, v_column, v_max_scale in
    select * from (values
      ('sales_items','quantity',3),
      ('sales_items','bonus',3),
      ('products','current_stock',6),
      ('inventory_transactions','quantity_delta',6)
    ) as required(table_name, column_name, max_scale)
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'Required table public.% is missing', v_table;
    end if;
    select numeric_scale into v_scale
    from information_schema.columns
    where table_schema = 'public' and table_name = v_table and column_name = v_column and data_type = 'numeric';
    if not found then
      raise exception 'Required numeric column public.%.% is missing or has an unexpected type', v_table, v_column;
    end if;
    if v_scale is not null and v_scale > v_max_scale then
      raise exception 'public.%.% has more fractional precision than this migration preserves', v_table, v_column;
    end if;
  end loop;

  if exists (select 1 from public.sales_items where quantity <> round(quantity, 3)) then
    raise exception 'sales_items.quantity contains values that cannot be represented at three decimal places';
  end if;
  if exists (select 1 from public.sales_items where bonus <> round(bonus, 3)) then
    raise exception 'sales_items.bonus contains values that cannot be represented at three decimal places';
  end if;
  if exists (select 1 from public.products where current_stock <> round(current_stock, 6)) then
    raise exception 'products.current_stock contains values that cannot be represented at six decimal places';
  end if;
  if exists (select 1 from public.inventory_transactions where quantity_delta <> round(quantity_delta, 6)) then
    raise exception 'inventory_transactions.quantity_delta contains values that cannot be represented at six decimal places';
  end if;
end $$;

alter table public.sales_items
  alter column quantity type numeric(16,3) using quantity::numeric(16,3),
  alter column bonus type numeric(16,3) using bonus::numeric(16,3);

alter table public.products
  alter column current_stock type numeric(18,6) using current_stock::numeric(18,6);

alter table public.inventory_transactions
  alter column quantity_delta type numeric(18,6) using quantity_delta::numeric(18,6);

commit;
