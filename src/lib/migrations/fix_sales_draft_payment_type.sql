-- Add payment intent columns to sales_orders so staff-created drafts
-- preserve their chosen payment type (cash/credit) through approval.
alter table public.sales_orders
  add column if not exists payment_type text not null default 'credit'
    check (payment_type in ('cash', 'credit'));

alter table public.sales_orders
  add column if not exists credit_days int;