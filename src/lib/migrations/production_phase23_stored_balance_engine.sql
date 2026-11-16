-- Phase 23 — Stored-balance engine: Single Source of Truth for customer
-- outstanding balances (2026-11-16, UMAIR-approved).
--
-- Problem: the stored customers.outstanding_balance drifted from the ledger
-- (production: AL FAZL stored 0.00 vs ledger 97.14, plus four more
-- customers). Four root causes, all in the write paths:
--   * credit-sale create never writes the stored column at all (the atomic
--     sale RPC has no stored-balance update; the TS draft path increments
--     it ad hoc), so a credit sale raises the derived balance but not
--     stored;
--   * payment create/edit subtract the FULL payment amount from stored
--     (collections-path rule), even when the payment is unallocated or
--     allocated to a non-credit invoice, so stored falls faster than the
--     derived balance;
--   * void restores stored to the previous_outstanding_balance recorded
--     when the payment was created, which is stale if anything else moved
--     the balance in between;
--   * return confirm/cancel never touches stored, so a confirmed return
--     lowers the derived balance but not stored.
-- The UI already shows the DERIVED engine value everywhere (receivables,
-- history, ledgers), so users see the right number — but the stored column
-- is what other paths (credit-limit checks, the reconcile report) read,
-- and it silently disagrees.
--
-- Fix (UMAIR-approved 2026-11-16, permanent for EVERY customer in EVERY
-- organization): the stored balance is ALWAYS the Single Source of Truth
-- formula, computed atomically from the ledger — never ad-hoc plus/minus:
--
--   outstanding = Credit Sales − Confirmed Returns − Non-Voided Payments
--
--   * Credit Sales: credit invoices only (payment_type = 'credit'),
--     status not 'cancelled' / 'void'. Cash/card sales are Paid by
--     construction and contribute 0. Invoice total is total_amount, with
--     the same line-total fallback the payment derivation already uses
--     when total_amount <= 0.
--   * Confirmed Returns: returns with status <> 'cancelled' linked to the
--     invoice. A return's value is quantity × unit_price − discount per
--     line, floored at 0 per return.
--   * Non-Voided Payments: payments with voided_at IS NULL. A voided
--     payment — and its allocation rows — cover nothing. Unallocated
--     payments apply FIFO to the customer's oldest open credit invoices
--     (after returns and explicit allocations). Remaining is floored at 0
--     per invoice.
--
-- What this file does:
--   1. customer_derived_outstanding(p_customer_id) — the canonical SQL
--      implementation of the formula. It matches the TypeScript engine in
--      src/lib/accounting/customer-balance.ts AND the customer branch of
--      the existing payment_derived_outstanding('customer', …) exactly.
--      The TS and SQL sides must stay in sync — any change to the formula
--      changes both, and both test suites must stay green. (One known
--      edge, theoretical only: a NULL invoice/return status is treated as
--      OPEN by the TS engine but excluded by the SQL `NOT IN` / `<>`
--      checks. Status is never NULL in practice — the sale RPC always
--      writes confirmed/paid/partially_paid and returns are inserted
--      confirmed — so the two agree on all real data. This file follows
--      the existing SQL convention so it agrees with the live reconcile
--      report.)
--   2. recompute_customer_outstanding_balance(p_customer_id) — locks the
--      customer row, derives the balance, and sets the stored column to
--      it atomically (one transaction). Returns stored_before /
--      stored_after / derived / changed. No audit row: triggers call this
--      on every ledger write, and an audit row per write would flood
--      audit_logs. Explicit, owner-approved corrections still go through
--      correct_outstanding_balance_atomic (audit-logged).
--   3. sync_customer_outstanding_balance() + triggers on the five ledger
--      tables (sales_transactions, customer_payments,
--      customer_payment_allocations, sales_returns, sales_return_items)
--      and on customers (UPDATE OF outstanding_balance). Any write that
--      changes what a customer owes — or any ad-hoc write to the stored
--      column itself — recomputes that customer's stored balance from the
--      formula before the transaction commits. The existing RPCs' ad-hoc
--      plus/minus updates are left in place (removing them is a separate,
--      riskier cleanup of live RPCs); the triggers override them with the
--      derived value in the same transaction, so the final stored value is
--      always the formula's value.
--   4. The 5-customer correction (OP TRADERS org): AL FAZL → 97.14,
--      amir → 34.01, maaz → 1.59, MUBEEN → 46.63,
--      QA-20260826-CustomerB → 2.59 (RE-APPROVED 2026-11-16 ~20:19 by UMAIR;
--      the 2026-11-16 ~20:14 run failed as designed: derived was 2.59, not
--      the originally approved 1.94 — data moved since the target was approved.
--      The other 4 targets were verified exact by that run.)
--      The old stored value is logged (RAISE NOTICE + audit_logs row)
--      BEFORE updating. The derived value is computed first and MUST equal
--      the approved target — if it does not, the whole migration FAILS
--      LOUDLY (raise exception) and nothing is written, so a stale target
--      can never be stored. If that happens, send the derived values back
--      for re-approval.
--   5. A verification SELECT listing the five customers with stored,
--      derived and status.
--
-- Apply order: run this on production AFTER the stored-balance-engine code
-- slice deploys (the TS lib + audit script + tests are code-only and do
-- not depend on this file, but the triggers are the enforcement). Safe to
-- re-run: every object is CREATE OR REPLACE / DROP IF EXISTS + CREATE, and
-- the correction skips customers that are already correct.
-- Supplier balances are NOT covered by this file (same drift class, same
-- pattern — a supplier_derived_outstanding + triggers can follow the same
-- shape in a later slice; payment_derived_outstanding('supplier', …)
-- already exists for the supplier reconcile path).
-- Do NOT run this on the disposable QA database: the correction targets
-- production customer names in the OP TRADERS org.

begin;

-- 1. Canonical derivation for ONE customer. Pure function (no writes):
-- the same FIFO derivation payment_derived_outstanding('customer', …)
-- performs, but resolving the organization from the customer row instead
-- of from auth.uid(), so triggers and service-role callers can use it.
-- Returns 0 when the customer has no open credit invoices.
create or replace function public.customer_derived_outstanding(p_customer_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_pool numeric := 0;
  v_invoice record;
  v_invoice_total numeric;
  v_line_total numeric;
  v_returned numeric;
  v_explicit numeric;
  v_remaining_after numeric;
  v_fallback numeric;
  v_remaining numeric;
  v_total numeric := 0;
begin
  if p_customer_id is null then
    return 0;
  end if;
  select organization_id into v_org from public.customers where id = p_customer_id;
  if v_org is null then
    return 0;
  end if;

  select greatest(
    coalesce((select sum(cp.amount) from public.customer_payments cp
      where cp.organization_id = v_org and cp.customer_id = p_customer_id and cp.voided_at is null), 0)
    - coalesce((select sum(a.amount) from public.customer_payment_allocations a
      join public.sales_transactions st on st.id = a.sales_transaction_id
      where a.organization_id = v_org and st.organization_id = v_org and st.customer_id = p_customer_id
        and not exists (select 1 from public.customer_payments cp2 where cp2.id = a.customer_payment_id and cp2.voided_at is not null)), 0),
    0
  ) into v_pool;

  for v_invoice in
    select st.id, st.total_amount, st.discount_amount, st.tax_amount,
      coalesce(st.sale_date, st.created_at::date) as sort_date, st.created_at
    from public.sales_transactions st
    where st.organization_id = v_org and st.customer_id = p_customer_id
      and st.payment_type = 'credit' and st.status not in ('cancelled', 'void')
    order by coalesce(st.sale_date, st.created_at::date), st.created_at, st.id
  loop
    v_invoice_total := coalesce(v_invoice.total_amount, 0);
    if v_invoice_total <= 0 then
      select coalesce(sum(si.quantity * si.selling_price - si.discount), 0)
        into v_line_total from public.sales_items si
        where si.sales_transaction_id = v_invoice.id;
      v_invoice_total := greatest(0, v_line_total - coalesce(v_invoice.discount_amount, 0))
        + coalesce(v_invoice.tax_amount, 0);
    end if;
    select coalesce(sum(greatest(0, (
      select coalesce(sum(sri.quantity * sri.unit_price - sri.discount), 0)
      from public.sales_return_items sri where sri.sales_return_id = sr.id
    ))), 0) into v_returned
    from public.sales_returns sr
    where sr.sales_transaction_id = v_invoice.id and sr.organization_id = v_org
      and sr.status <> 'cancelled';
    select coalesce(sum(a.amount), 0) into v_explicit
    from public.customer_payment_allocations a
    where a.organization_id = v_org and a.sales_transaction_id = v_invoice.id
      and not exists (select 1 from public.customer_payments cp2 where cp2.id = a.customer_payment_id and cp2.voided_at is not null);
    v_remaining_after := greatest(0, v_invoice_total - v_returned - v_explicit);
    v_fallback := least(v_pool, v_remaining_after);
    v_remaining := v_remaining_after - v_fallback;
    v_pool := greatest(0, v_pool - v_fallback);
    v_total := v_total + v_remaining;
  end loop;

  return greatest(0, v_total);
end;
$$;
revoke all on function public.customer_derived_outstanding(uuid) from public, anon;
grant execute on function public.customer_derived_outstanding(uuid) to authenticated;
-- 2. Atomically set ONE customer's stored balance to its derived value.
-- Serialized per customer (advisory lock) so concurrent writes for the
-- same customer cannot interleave a stale recompute. Returns the
-- before/after so callers (and the correction block below) can log it.
-- No audit row here: triggers call this on every ledger write, and an
-- audit row per write would flood audit_logs. Explicit, owner-approved
-- corrections still go through correct_outstanding_balance_atomic.
create or replace function public.recompute_customer_outstanding_balance(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_stored numeric;
  v_derived numeric;
  v_name text;
begin
  if p_customer_id is null then
    raise exception 'Customer id is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('stored-balance:' || p_customer_id::text, 0));

  select organization_id, customer_name, coalesce(outstanding_balance, 0)
    into v_org, v_name, v_stored from public.customers
    where id = p_customer_id for update;
  if not found then
    raise exception 'Customer is unavailable' using errcode = '22023';
  end if;

  v_derived := public.customer_derived_outstanding(p_customer_id);

  if v_stored is distinct from v_derived then
    update public.customers
    set outstanding_balance = v_derived, updated_at = now()
    where id = p_customer_id and organization_id = v_org;
  end if;

  return jsonb_build_object(
    'customer_id', p_customer_id, 'customer_name', v_name,
    'stored_before', v_stored, 'stored_after', v_derived,
    'derived', v_derived, 'changed', v_stored is distinct from v_derived
  );
end;
$$;
revoke all on function public.recompute_customer_outstanding_balance(uuid) from public, anon;
grant execute on function public.recompute_customer_outstanding_balance(uuid) to authenticated;

-- 3. Trigger function: after any write to a ledger table (or to the stored
-- column itself), recompute the affected customer's stored balance from
-- the formula. A missing/orphan row is skipped (a payment for a deleted
-- customer cannot owe anything); a genuine database error still
-- propagates so a broken derivation fails loudly instead of silently
-- leaving a stale balance.
create or replace function public.sync_customer_outstanding_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_id uuid;
  v_tx_id uuid;
  v_return_id uuid;
begin
  if TG_TABLE_NAME = 'customers' then
    -- AFTER UPDATE OF outstanding_balance: an ad-hoc write to the stored
    -- column (RPC plus/minus, TS increment, direct edit) is corrected to
    -- the derived value. The guard inside recompute (only updates when
    -- stored <> derived) stops recursion: the corrective UPDATE fires this
    -- trigger again, finds stored = derived, and does nothing.
    v_customer_id := NEW.id;
  elsif TG_TABLE_NAME = 'sales_transactions' then
    v_customer_id := coalesce(NEW.customer_id, OLD.customer_id);
  elsif TG_TABLE_NAME = 'customer_payments' then
    v_customer_id := coalesce(NEW.customer_id, OLD.customer_id);
  elsif TG_TABLE_NAME = 'customer_payment_allocations' then
    v_tx_id := coalesce(NEW.sales_transaction_id, OLD.sales_transaction_id);
    if v_tx_id is not null then
      select customer_id into v_customer_id from public.sales_transactions where id = v_tx_id;
    end if;
  elsif TG_TABLE_NAME = 'sales_returns' then
    v_tx_id := coalesce(NEW.sales_transaction_id, OLD.sales_transaction_id);
    if v_tx_id is not null then
      select customer_id into v_customer_id from public.sales_transactions where id = v_tx_id;
    end if;
  elsif TG_TABLE_NAME = 'sales_return_items' then
    v_return_id := coalesce(NEW.sales_return_id, OLD.sales_return_id);
    if v_return_id is not null then
      select st.customer_id into v_customer_id
      from public.sales_returns sr
      join public.sales_transactions st on st.id = sr.sales_transaction_id
      where sr.id = v_return_id;
    end if;
  end if;

  if v_customer_id is not null then
    perform public.recompute_customer_outstanding_balance(v_customer_id);
  end if;

  return coalesce(NEW, OLD);
end;
$$;
-- 4. The triggers. One function, six triggers — every write that can move
-- what a customer owes, plus any direct write to the stored column.
-- Note the ordering inside one transaction: a ledger trigger may recompute
-- before a later statement in the same RPC inserts its payment/allocation
-- rows (the intermediate value is never visible outside the transaction),
-- and an RPC's own ad-hoc UPDATE to customers afterwards is corrected by
-- the customers trigger — so the value at commit is always the formula's.
drop trigger if exists sync_customer_outstanding_on_sale on public.sales_transactions;
create trigger sync_customer_outstanding_on_sale
  after insert or update or delete on public.sales_transactions
  for each row execute function public.sync_customer_outstanding_balance();

drop trigger if exists sync_customer_outstanding_on_payment on public.customer_payments;
create trigger sync_customer_outstanding_on_payment
  after insert or update or delete on public.customer_payments
  for each row execute function public.sync_customer_outstanding_balance();

drop trigger if exists sync_customer_outstanding_on_allocation on public.customer_payment_allocations;
create trigger sync_customer_outstanding_on_allocation
  after insert or update or delete on public.customer_payment_allocations
  for each row execute function public.sync_customer_outstanding_balance();

drop trigger if exists sync_customer_outstanding_on_return on public.sales_returns;
create trigger sync_customer_outstanding_on_return
  after insert or update or delete on public.sales_returns
  for each row execute function public.sync_customer_outstanding_balance();

drop trigger if exists sync_customer_outstanding_on_return_item on public.sales_return_items;
create trigger sync_customer_outstanding_on_return_item
  after insert or update or delete on public.sales_return_items
  for each row execute function public.sync_customer_outstanding_balance();

drop trigger if exists sync_customer_outstanding_on_stored_write on public.customers;
create trigger sync_customer_outstanding_on_stored_write
  after update of outstanding_balance on public.customers
  for each row execute function public.sync_customer_outstanding_balance();

-- 5. The 5-customer correction (OP TRADERS org, UMAIR-approved 2026-11-16).
-- The derived value is computed FIRST and MUST equal the approved target.
-- If it does not, the migration FAILS LOUDLY (raise exception) and nothing
-- is written — a stale target is never stored. If that happens, send the
-- derived values back for re-approval.
-- The old stored value is logged (RAISE NOTICE + audit_logs row) BEFORE
-- updating. Re-running is safe: customers already at their derived value
-- are skipped (no duplicate audit row).
do $$
declare
  v_org uuid;
  v_org_name text := 'OP TRADERS';
  v_org_count integer;
  v_actor uuid;
  v_targets record;
  v_name_count integer;
  v_customer_id uuid;
  v_customer_name text;
  v_stored numeric;
  v_derived numeric;
  v_result jsonb;
begin
  select count(*) into v_org_count from public.organizations where name = v_org_name;
  if v_org_count <> 1 then
    raise exception 'Expected exactly one organization named %, found % — refusing to guess', v_org_name, v_org_count;
  end if;
  select id into v_org from public.organizations where name = v_org_name;

  -- Audit actor: the org owner (the person running this migration); falls
  -- back to the earliest active profile in the org if no owner role row
  -- exists. If neither exists the audit insert uses NULL.
  select id into v_actor from public.profiles
  where organization_id = v_org and role = 'owner' and is_active is distinct from false
  order by created_at asc limit 1;
  if v_actor is null then
    select id into v_actor from public.profiles
    where organization_id = v_org and is_active is distinct from false
    order by created_at asc limit 1;
  end if;

  for v_targets in
    select * from (values
      ('AL FAZL', 97.14::numeric),
      ('amir', 34.01::numeric),
      ('maaz', 1.59::numeric),
      ('MUBEEN', 46.63::numeric),
      ('QA-20260826-CustomerB', 2.59::numeric)
    ) as t(customer_name, target_balance)
  loop
    select count(*) into v_name_count from public.customers
    where organization_id = v_org and customer_name = v_targets.customer_name;
    if v_name_count <> 1 then
      raise exception 'Expected exactly one customer named % in organization %, found % — refusing to guess', v_targets.customer_name, v_org_name, v_name_count;
    end if;
    select id, customer_name, coalesce(outstanding_balance, 0)
      into v_customer_id, v_customer_name, v_stored
      from public.customers
      where organization_id = v_org and customer_name = v_targets.customer_name;

    v_derived := public.customer_derived_outstanding(v_customer_id);

    raise notice 'Stored-balance correction: % stored_before=% derived=% target=%',
      v_customer_name, v_stored, v_derived, v_targets.target_balance;

    if v_derived <> v_targets.target_balance then
      raise exception 'Derived balance for % is % but the approved target is % — data moved since the target was approved; NOT writing a stale target. Send the derived value back for re-approval.',
        v_customer_name, v_derived, v_targets.target_balance;
    end if;

    if v_stored = v_derived then
      raise notice 'Stored-balance correction: % already correct at % — skipping.', v_customer_name, v_derived;
      continue;
    end if;

    v_result := public.recompute_customer_outstanding_balance(v_customer_id);

    insert into public.audit_logs (
      organization_id, actor_profile_id, action, entity_type, entity_id,
      entity_label, description, new_values
    ) values (
      v_org, v_actor, 'balance_corrected', 'customer', v_customer_id, v_customer_name,
      'Corrected stored outstanding balance for ' || v_customer_name || ' to the derived balance (Phase 23 stored-balance engine)',
      jsonb_build_object('request_key', gen_random_uuid(),
        'fingerprint', md5(jsonb_build_object('kind', 'customer', 'party_id', v_customer_id, 'reason', 'Phase 23 stored-balance engine correction (UMAIR-approved 2026-11-16)')::text),
        'stored_before', v_stored, 'stored_after', v_derived, 'derived', v_derived,
        'reason', 'Phase 23 stored-balance engine correction (UMAIR-approved 2026-11-16)')
    );

    raise notice 'Stored-balance correction: % stored % -> % (derived %).', v_customer_name, v_stored, v_derived, v_derived;
  end loop;
end $$;

-- 6. Verification: the five customers must now show stored = derived = target.
select c.customer_name, coalesce(c.outstanding_balance, 0) as stored_balance,
  public.customer_derived_outstanding(c.id) as derived_balance,
  case when coalesce(c.outstanding_balance, 0) = public.customer_derived_outstanding(c.id)
    then 'IN SYNC' else 'OUT OF SYNC' end as status
from public.customers c
where c.organization_id = (select id from public.organizations where name = 'OP TRADERS')
  and c.customer_name in ('AL FAZL', 'amir', 'maaz', 'MUBEEN', 'QA-20260826-CustomerB')
order by c.customer_name;

commit;
