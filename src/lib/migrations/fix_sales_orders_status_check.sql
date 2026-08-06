-- Fix: sales_orders.status check constraint rejects draft-workflow values like
-- 'pending_approval' / 'rejected' / 'converted'. Replace the narrow constraint
-- with one that accepts the full draft approval + sales lifecycle.
--
-- Run this once in the production (or any affected) database.

alter table public.sales_orders drop constraint if exists sales_orders_status_check;

alter table public.sales_orders
  add constraint sales_orders_status_check
  check (
    status in (
      'draft',
      'pending_approval',
      'approved',
      'rejected',
      'converted',
      'confirmed',
      'delivered',
      'cancelled'
    )
  );

-- Confirm the new constraint exists.
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conname = 'sales_orders_status_check';