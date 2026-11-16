-- Slice S2 (Tier-1 Offline) — provisional receipt number on the cloud invoice.
--
-- PURPOSE: an offline sale gets a local provisional number on the receipt
-- (L-000123, allocated per device from the desktop SQLite queue). When the
-- sale syncs, the server assigns the real invoice number (S-100xxx) — but
-- the paper receipt the customer walked away with says L-000123, so the
-- cloud invoice must ALSO carry that provisional number, or the bill is
-- unfindable by the number on the receipt. This column is that link
-- (UMAIR's decision 2, 2026-11-17: the provisional number IS saved/linked
-- in the cloud invoice, searchable by it too).
--
-- WHAT CHANGES: one nullable text column + one partial index. ADDITIVE
-- ONLY — no column is dropped or altered, no data is rewritten, no
-- function is replaced. Safe to run while the app is live.
--
-- WHO WRITES IT: the S3 sync engine (not this slice) — after
-- create_sales_invoice_atomic confirms a sale, the sync records the local
-- provisional number on the confirmed row (UPDATE by the returned
-- transaction id). Until S3 lands, the column stays NULL; nothing reads it.
--
-- RUN ORDER: run this file on the DISPOSABLE Supabase project first, then
-- on production (project "trade os"). Run by UMAIR in the Supabase SQL
-- editor; never by an agent.
--
-- VERIFICATION (after running, either project):
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'sales_transactions'
--     and column_name = 'provisional_receipt_number';
--   -- expect one row: provisional_receipt_number | text | YES
--   select indexname from pg_indexes
--   where schemaname = 'public' and tablename = 'sales_transactions'
--     and indexname = 'sales_transactions_provisional_receipt_number_idx';
--   -- expect one row.
--
-- FULL SQL (plain text — copy the block below into the SQL editor):
--
--   begin;
--   alter table public.sales_transactions
--     add column if not exists provisional_receipt_number text;
--   create index if not exists sales_transactions_provisional_receipt_number_idx
--     on public.sales_transactions (organization_id, provisional_receipt_number)
--     where provisional_receipt_number is not null;
--   commit;

begin;
alter table public.sales_transactions
  add column if not exists provisional_receipt_number text;
create index if not exists sales_transactions_provisional_receipt_number_idx
  on public.sales_transactions (organization_id, provisional_receipt_number)
  where provisional_receipt_number is not null;
commit;
