-- TradeOS ERP V2 — Sprint 1: Invoice Management Foundation
-- This file documents the DDL required for atomic, per-organization invoice
-- numbering plus permanent invoice metadata on sales_transactions /
-- purchase_transactions.
--
-- There is no automated migration runner in this project (see
-- src/lib/identity/schema.sql for the established convention). Run every
-- statement below manually, once, in the Supabase SQL editor (or via `psql`)
-- against the target project database.
--
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE / guarded
-- DO blocks, so re-applying this file is a no-op once it has succeeded.

-- ---------------------------------------------------------------------------
-- 1. Invoice sequence counters — one row per (organization, invoice_type).
--    This is the single source of truth for "what is the next number".
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_type text not null check (invoice_type in ('sales', 'purchase', 'sales_return', 'purchase_return')),
  current_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, invoice_type)
);

-- ---------------------------------------------------------------------------
-- 2. Atomic "next number" function.
--
--    A single `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` statement
--    is executed as one atomic unit by Postgres: the row lock acquired by the
--    INSERT/UPDATE is held for the duration of the statement, so concurrent
--    callers are safely serialized by Postgres itself.
--
--    Guarantees this gives us (per Part 1 of the sprint):
--      - No duplicate numbers:   the (organization_id, invoice_type) primary
--        key + row locking prevent two callers from reading the same
--        `current_number` and both incrementing from it.
--      - No skipped numbers:    every call increments by exactly 1; there is
--        no "reserve then maybe fail" step that could burn a number.
--      - No reuse after delete: the counter only ever increases. Invoices are
--        soft-deleted via `status` (see below), never physically removed, and
--        even if a row were removed the sequence itself is never decremented.
-- ---------------------------------------------------------------------------
create or replace function public.next_invoice_number(
  p_organization_id uuid,
  p_invoice_type text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if p_organization_id is null then
    raise exception 'next_invoice_number: p_organization_id is required';
  end if;

  if p_invoice_type not in ('sales', 'purchase', 'sales_return', 'purchase_return') then
    raise exception 'next_invoice_number: unknown invoice_type "%"', p_invoice_type;
  end if;

  insert into public.invoice_sequences (organization_id, invoice_type, current_number, updated_at)
  values (p_organization_id, p_invoice_type, 1, now())
  on conflict (organization_id, invoice_type)
  do update set current_number = public.invoice_sequences.current_number + 1,
                updated_at = now()
  returning current_number into v_next;

  return v_next;
end;
$$;

grant execute on function public.next_invoice_number(uuid, text) to service_role;
grant execute on function public.next_invoice_number(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Invoice metadata columns (Part 4) — additive only, existing rows keep
--    working (defaults preserve current behavior: status = 'confirmed').
-- ---------------------------------------------------------------------------
alter table public.sales_transactions
  add column if not exists status text not null default 'confirmed',
  add column if not exists invoice_type text not null default 'sales',
  add column if not exists created_by_profile_id uuid references public.profiles(id);

alter table public.purchase_transactions
  add column if not exists status text not null default 'confirmed',
  add column if not exists invoice_type text not null default 'purchase',
  add column if not exists created_by_profile_id uuid references public.profiles(id),
  -- Distinct from our own system-generated invoice_number: this preserves the
  -- existing "supplier's own paper invoice number" reference field that the
  -- purchase conversation flow already collects optionally. It must never be
  -- written into invoice_number (see Part 1 — frontend/client-supplied values
  -- are not allowed to become our system invoice number).
  add column if not exists supplier_invoice_number text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_transactions_status_check') then
    alter table public.sales_transactions
      add constraint sales_transactions_status_check
      check (status in ('draft', 'pending_approval', 'confirmed', 'paid', 'partially_paid', 'cancelled', 'void'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sales_transactions_invoice_type_check') then
    alter table public.sales_transactions
      add constraint sales_transactions_invoice_type_check
      check (invoice_type = 'sales');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'purchase_transactions_status_check') then
    alter table public.purchase_transactions
      add constraint purchase_transactions_status_check
      check (status in ('draft', 'pending_approval', 'confirmed', 'paid', 'partially_paid', 'cancelled', 'void'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'purchase_transactions_invoice_type_check') then
    alter table public.purchase_transactions
      add constraint purchase_transactions_invoice_type_check
      check (invoice_type = 'purchase');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Uniqueness + search indexes (Part 1 duplicate-safety, Part 2 fast search)
-- ---------------------------------------------------------------------------
create unique index if not exists sales_transactions_org_invoice_number_uidx
  on public.sales_transactions (organization_id, invoice_number);

create unique index if not exists purchase_transactions_org_invoice_number_uidx
  on public.purchase_transactions (organization_id, invoice_number);

create index if not exists sales_transactions_invoice_number_idx
  on public.sales_transactions (invoice_number);

create index if not exists purchase_transactions_invoice_number_idx
  on public.purchase_transactions (invoice_number);

-- Optional (recommended once volumes grow): trigram index for fast partial
-- ("contains") search on invoice_number via ILIKE '%term%'. Requires the
-- pg_trgm extension:
--   create extension if not exists pg_trgm;
--   create index if not exists sales_transactions_invoice_number_trgm_idx
--     on public.sales_transactions using gin (invoice_number gin_trgm_ops);
--   create index if not exists purchase_transactions_invoice_number_trgm_idx
--     on public.purchase_transactions using gin (invoice_number gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5. Filter-support indexes (Part 3)
-- ---------------------------------------------------------------------------
create index if not exists sales_transactions_sale_date_idx on public.sales_transactions (sale_date);
create index if not exists sales_transactions_customer_idx on public.sales_transactions (customer_id);
create index if not exists sales_transactions_created_by_idx on public.sales_transactions (created_by_profile_id);
create index if not exists sales_transactions_payment_type_idx on public.sales_transactions (payment_type);
create index if not exists sales_transactions_status_idx on public.sales_transactions (status);

create index if not exists purchase_transactions_purchase_date_idx on public.purchase_transactions (purchase_date);
create index if not exists purchase_transactions_supplier_idx on public.purchase_transactions (supplier_id);
create index if not exists purchase_transactions_status_idx on public.purchase_transactions (status);
