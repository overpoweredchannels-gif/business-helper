-- Run after production_phase6_print_templates.sql. Safe to run repeatedly.
-- Adds the persistent template type used by Retail POS receipts.
begin;

do $$
declare constraint_name text;
begin
  if to_regclass('public.print_templates') is null then
    raise exception 'print_templates is missing. Run production_phase6_print_templates.sql first.';
  end if;
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.print_templates'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%doc_type%';
  if constraint_name is not null then
    execute format('alter table public.print_templates drop constraint %I', constraint_name);
  end if;
  alter table public.print_templates add constraint print_templates_doc_type_check
    check (doc_type in ('sales_invoice', 'load_form', 'retail_receipt'));
end $$;

notify pgrst, 'reload schema';
commit;
