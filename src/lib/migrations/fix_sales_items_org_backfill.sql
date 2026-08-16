-- TradeOS ERP — Sales invoice print fix: backfill sales_items.organization_id
-- and sales_transactions.total_amount.
--
-- WHY
--   The app fetches sales_items filtered by organization_id
--   (src/app/page.tsx fetchSalesItems). Rows written before the item-side
--   organization column existed, or written by the AI draft path (which
--   omitted organization_id), keep a NULL organization_id. Those rows are
--   excluded from the app query, so the Sales Invoice print preview shows
--   zero line items / zero totals. This mirrors the purchase-side backfill
--   (4.8 in production_upgrade_consolidated.sql) that already exists.
--
-- Safe to re-run: guarded DO blocks, only touches NULL rows.

do $$
begin
  if to_regclass('public.sales_items') is not null
     and to_regclass('public.sales_transactions') is not null then

    update public.sales_items si
    set organization_id = st.organization_id
    from public.sales_transactions st
    where si.organization_id is null
      and st.id = si.sales_transaction_id
      and st.organization_id is not null;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'sales_transactions'
        and column_name = 'total_amount'
    ) then
      update public.sales_transactions st
      set total_amount = coalesce((
        select sum(si.quantity * si.selling_price - coalesce(si.discount, 0))
        from public.sales_items si
        where si.sales_transaction_id = st.id
      ), 0)
      where st.total_amount is null;
    end if;
  end if;
end $$;

-- Post-apply verification (run manually to confirm):
--   select count(*) from public.sales_items
--     where organization_id is null and sales_transaction_id is not null;