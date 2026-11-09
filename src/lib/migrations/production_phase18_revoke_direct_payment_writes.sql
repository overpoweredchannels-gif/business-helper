-- Phase 18 — revoke direct payment-table writes (access change).
--
-- Apply AFTER phase 17, in that order. This file is a SEPARATE batch
-- from phase 17 per the repo rule (never batch destructive/access-
-- removing changes with additive ones). Nothing here applies to
-- production by itself.
--
-- What it does: removes INSERT / UPDATE / DELETE / TRUNCATE on the four
-- payment tables from anon and authenticated. SELECT stays: every read
-- path (history, reports, AI summary, brain loader) keeps working.
-- The only writers left are the SECURITY DEFINER RPCs (running as the
-- table owner) and service_role (draft approval, imports — both
-- server-side and permission-checked at their routes). The payment
-- forms, the void/edit/correct RPCs and the sales/collections RPCs are
-- unaffected: they never wrote through these grants.
--
-- Rollback (separate approved step if ever needed): re-grant the four
-- privileges to authenticated. No data is touched by this file.
begin;

revoke insert, update, delete, truncate on public.customer_payments from anon, authenticated;
revoke insert, update, delete, truncate on public.supplier_payments from anon, authenticated;
revoke insert, update, delete, truncate on public.customer_payment_allocations from anon, authenticated;
revoke insert, update, delete, truncate on public.supplier_payment_allocations from anon, authenticated;

notify pgrst, 'reload schema';
commit;
