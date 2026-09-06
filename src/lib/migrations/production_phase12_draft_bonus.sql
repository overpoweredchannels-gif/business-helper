-- Run the complete script in Supabase SQL Editor. Safe to run again.
begin;
alter table public.sales_order_items
  add column if not exists bonus numeric(14, 2) not null default 0 check (bonus >= 0);
alter table public.sales_items
  add column if not exists bonus numeric(14, 2) not null default 0 check (bonus >= 0);
notify pgrst, 'reload schema';
commit;

select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('sales_order_items', 'sales_items')
  and column_name = 'bonus'
order by table_name;
