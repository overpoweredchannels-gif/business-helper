begin isolation level repeatable read read only;
select jsonb_build_object(
 'read_only',current_setting('transaction_read_only'), 'captured_at',current_timestamp,
 'policies',(select jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname) from pg_policies p where coalesce(p.qual,'') ilike '%is_current_user_owner_or_admin%' or coalesce(p.with_check,'') ilike '%is_current_user_owner_or_admin%'),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('function',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid))), '[]'::jsonb) from pg_proc p where p.prokind in ('f','p') and p.prosrc ilike '%is_current_user_owner_or_admin%'),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('view',c.oid::regclass::text,'definition',pg_get_viewdef(c.oid,true))), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('v','m') and n.nspname not in ('pg_catalog','information_schema') and pg_get_viewdef(c.oid,true) ilike '%is_current_user_owner_or_admin%'),
 'dependencies',(select coalesce(jsonb_agg(jsonb_build_object('type',d.classid::regclass::text,'description',pg_describe_object(d.classid,d.objid,d.objsubid))), '[]'::jsonb) from pg_depend d where d.refclassid='pg_proc'::regclass and d.refobjid='public.is_current_user_owner_or_admin()'::regprocedure)
);
rollback;
