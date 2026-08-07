-- TradeOS ERP — Load Form support: add per-line bonus quantity to sales items.
--
-- Bonus (free units granted in a promotion) is printed on the Load Form in the
-- "Bns" column and summed into the "Bonus Value" footer total.
--
-- Safe to re-run: uses IF NOT EXISTS / guarded DO blocks.

alter table public.sales_items
  add column if not exists bonus numeric(14, 2) not null default 0 check (bonus >= 0);

-- Post-apply verification (run manually to confirm):
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'sales_items' and column_name = 'bonus';