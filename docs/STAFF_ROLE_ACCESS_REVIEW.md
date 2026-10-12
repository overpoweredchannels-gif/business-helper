# Staff Role Access Review

Status: code changes prepared; database migration is **not applied**.

## Findings

The inspected disposable project was `rtfowunsyrdygyvubnvs`. Read-only PostgreSQL metadata showed:

- `public.profiles.role` defaulted to `owner`; `role_name` defaulted to `staff`.
- `anon` and `authenticated` had table-level `UPDATE` plus column-level `UPDATE` grants on every `profiles` column, including `role`, `organization_id`, `auth_user_id`, and `is_active`.
- The `profiles_update_same_org_owner_admin_or_self` RLS policy allowed a user to update their own row when `auth_user_id = auth.uid()`. Row policies do not restrict which columns that user can update.

The application’s employee form already defaulted to `salesman`, and employee creation/invitation API routes required an owner. Their server services now also enforce owner authorization. The owner staff editor uses the owner-gated profile API. Staff imports run on the server: staff and employee imports now require owner access in addition to import permission, and staff updates call the owner-checked profile service through a server-supplied callback. A browser fetch helper cannot be used in this server path. Self profile auth linking also goes through the server endpoint. Missing profile roles now display as `staff` and no longer receive owner-only UI treatment. The editable role list now includes existing field employee roles, preventing accidental fallback to `staff` or validation failures when editing them.

## Prepared database change

[`20261011_staff_profile_role_access.sql`](../src/lib/migrations/20261011_staff_profile_role_access.sql) changes only future `role` defaults and profile write privileges/policy. It does not update existing profile rows. It revokes table and per-column `UPDATE` from `anon` and `authenticated`; server-side service-role writes remain available. Review and apply it through the normal migration process before relying on the direct-table write restriction.

## Verification evidence and limits

- Restricted synthetic employee requests to `POST /api/identity/employees` with `designation: owner` and `POST /api/identity/staff/invite` returned HTTP 403 from the isolated app, with no write path reached.
- The direct Supabase table-write gap was established from the isolated project's policy and ACL metadata. No row mutation was attempted. Until the prepared migration is reviewed and applied, a restricted caller may still attempt a direct REST update to their own profile.
- The 2026-10-13 continuation passed synthetic Chromium receipt tests and generated PDFs for 58/80 mm, including Close/Escape during preparation, failures, timeout, reopen, simulated cancel and reprint. It used the existing Playwright installation and Chromium binaries under `E:/tradeos/e2e`; no dependency files were changed.
- The earlier HTTP and metadata evidence above was inherited from this document, not rerun in the continuation. Authenticated QA, direct-table denial after migration, and physical printing remain unverified. No migration was applied.

## Migration review requirements

The SQL is a privilege-restricting cutover and must be reviewed separately from additive migrations. Deploy the server profile writers first. Verify `service_role` retains its required access, inspect inherited/PUBLIC grants and any SECURITY DEFINER profile-writing functions, and inspect INSERT policies as well as UPDATE policies. This migration addresses the recorded UPDATE gap; it does not prove the absence of other privileged write paths. It does not repair existing owner assignments: review those manually before release. The restricted future profile default is `staff`; employee onboarding explicitly uses the restricted `salesman` role.
