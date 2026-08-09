-- Staff & Permissions: section-level access grants
--
-- Adds a text[] column to staff_permissions so the owner can grant access to
-- ANY owner sidebar section per employee (e.g. Customer Credit, Supplier
-- Ledger, Business Settings, Employees, Territories, Routes, Live Tracking).
-- Values are SectionId strings from the owner navigation.
--
-- Run in the Supabase SQL editor. The column is nullable with an empty-array
-- default so existing rows and the legacy boolean columns keep working.

alter table public.staff_permissions
  add column if not exists granted_sections text[] not null default '{}';
