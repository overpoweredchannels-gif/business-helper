# Staff import investigation and containment — 2026-10-15

## Preflight: PASS, independently of the failed application baseline

Fresh guarded read-only preflight passed on 2026-10-15 between 02:32 and 02:35 PKT against disposable rtfowunsyrdygyvubnvs, using verify-full TLS and the pinned official CA. Exact deployment: dpl_3omNBFWdAhkQR9PqBQyXyVD9YC47, revision d1bd245d6986061c073681f834e97743bb238b88, URL https://tradeos-nu3scr876-overpoweredchannels-7830s-projects.vercel.app. Metadata guards and database artifact hashes passed. No migration or rollback ran.

Source report: C:/Users/Usman Laptops/OneDrive/Documents/evidence.md, identical SHA256 to EVIDENCE_FOR_CODEX_d1bd245.md: acbe355d4c2d8a1367c31775f958d7d5718332632faa2c0219d58e87a0b3aa3e. The report's verification interval is 02:14–02:28 PKT; runner evidence conservatively uses 02:14, not the later file timestamp or Codex review time. No freshness refresh was needed for this run. Future runs must satisfy the one-hour limit again.

Evidence assessment: accepts the authorized Option B operator statement that the existing disposable key was privately copied into unchanged QA scopes, the dashboard save time before redeployment, the exact deployed SHA/ID, and client bundle observation plus inspected common NEXT_PUBLIC_SUPABASE_URL usage. Individual Auth Admin calls are inferred from reviewed source and observed workflow results, not captured network requests. Codex did not decode or retrieve the hidden key. This is trusted operator provenance by construction, not independent secret inspection. The QA project's Vercel Production environment is not the production business-helper app.

## Hosted baseline and exact fixture

Muse reports owner edit, pending invite reuse, accepted rejection, and unmatched/contact-email preview rejection passed. Expired renewal was NOT RUN. These invite/import T1–T6 labels are not the release plan's direct REST authorization tests. Matched import FAILED with a partial profile write; no overall baseline pass is claimed.

Read-only database inspection confirmed QA111 UUID e41dc563-9871-40ab-ac70-c36c38d7bbd6, organization 6d428742-236b-41fb-82d2-60115e0272d8, login email qa111_6d4287422@staff.tradeos.internal. Current display_name is QA Employee A imported v2, role salesman, role_name staff, is_active true. No rows were repaired or cleaned up.

Audit ea64eebf-768b-49a0-aa31-c23760e52447 at 2026-10-14 21:22:38.608596 UTC records owner edit from QA Employee A v3/staff/active to QA Employee A v4/staff/active. Muse reports the later import changed the name and role. Current state agrees. Profiles has no updated_at column; the initial inspection referencing it failed and the read-only connection closed without writes, then a corrected read succeeded.

Import record 5e015d14-77f5-4d55-9d01-269040aaa0b2 ran 21:26:02.249–21:26:03.532 UTC: total 1, created 0, updated 0, failed 1; row 2 error PGRST204, missing can_manage_ai_assistant. The counters represent completed callbacks, not committed profile writes. No separate fixture-specific import audit with old/new permission values exists in the inspected deployment test interval.

Permission row 14435884-727e-4b4d-a677-421fb4b5cf25 remains timestamped 2026-10-09 19:31:41.459 UTC. True booleans: can_manage_products, can_manage_customers, can_create_sales. Other permission booleans are false. granted_sections is [products, sales, customers, sales:configured, sales:invoice, sales:history]. This is consistent with a rejected permission upsert; no captured pre-import permission snapshot exists, so timestamp alone is not proof of historical equality. PostgREST rejected the malformed statement before its permission write. The independently committed profile write is established by source, report and current state.

## Root causes: absent columns, incorrect mapping, non-atomic writes

Live staff_permissions has id, organization_id, profile_id, created_at, updated_at, granted_sections and these boolean columns: can_manage_products, can_manage_customers, can_manage_suppliers, can_create_purchases, can_create_sales, can_manage_payments, can_manage_expenses, can_view_profit, can_view_reports, can_manage_tasks, can_manage_settings, can_manage_inventory. Unique key is (organization_id, profile_id); both foreign keys exist. No non-internal triggers were found on this table.

can_manage_ai_assistant is absent in PostgreSQL itself. A schema-cache refresh cannot create it. The deployed importer generates can_manage_<section> for every import section, not the actual legacy mapping. This also invents columns such as can_manage_sales, can_manage_purchases, can_manage_reports and can_manage_staff, while existing sales/purchases/report booleans are can_create_sales/can_create_purchases/can_view_reports. The UI derives explicit columns from sectionPermissionMap. Several CSV section IDs also differ from canonical UI IDs (ai_assistant versus ai-assistant, settings versus business-settings, tasks versus task-manager). Thus adding only can_manage_ai_assistant is not a justified repair.

Exact browser CSV/body and outbound server upsert were not supplied. Payload field names are reconstructed from the exact deployed source; the PGRST204 field is confirmed by the import record. Source always constructs all can_manage_<section> fields, even when permission input is omitted.

applyUpdate awaited the independently committed owner-authorized profile update, then issued a separate permission upsert. The latter failed. The processor caught the error and counted the row as failed, without undoing the profile. A redundant postImportHook repeated permission upserts for successful rows and ignored returned errors. Omitted role/active fields also default in buildUpsertPayload, and omitted permissions build an empty list, contrary to the preview's supplied-fields-only wording. These are additional reasons to avoid re-enabling the existing write sequence unchanged.

## Prepared smallest containment fix (local, not deployed)

Matched staff updates are marked as preview errors before the HTTP route creates its import audit or writes profiles/permissions. Execution also throws the same actionable error if preview is bypassed. The obsolete two-request writer and duplicate permission post-hook are removed as a unit; no individual failing field is silently dropped. Matching lookup, error propagation, unsupported creation denial, skip mode and export remain available. Existing Staff & Permissions individual edit flows remain the alternative.

Expanded behavior is explicit: matched staff import updates are temporarily unavailable. This is containment, not a restored successful import baseline. No new database column or schema change is required for containment. It does not alter any existing fixture, and it does not change the approved d1bd245 deployment until a separately assessed app revision is deployed.

## Scoped follow-up for review before restoring matched imports

Prepare a separate additive database function (outside the existing reviewed profile-authorization package) to update one matched profile and its permissions in a single transaction. Do not change the existing migration or its hashes. Required contract:

- Accept exact actor/organization/target identifiers only through an owner-authorized server path; restrict EXECUTE to its intended server role, revoke PUBLIC/anon/authenticated access, and recheck active explicit owner and organization inside the function. Use SECURITY INVOKER with a pinned search_path; no privilege expansion or arbitrary table/column input.
- Lock the organization-scoped target, preserve existing self-deactivation/self-demotion checks, reject missing targets rather than treating zero affected rows as success, and validate allowed profile fields/roles/types.
- Use one explicit reviewed mapping of CSV section aliases to canonical UI section IDs and existing legacy booleans. Preserve owner-only semantics, sales subfeature markers and unspecified permission values. Reject ambiguous/unsupported aliases. Never derive column names by concatenation. No new can_manage_ai_assistant column is proposed.
- Preserve unspecified profile fields; distinguish omitted permission input from explicit permission revocation. Do not let role defaults or an empty generated permission list overwrite omitted values.
- Within the same function, update profile, upsert permissions and write a scoped before/after audit; raise on any failure so all effects roll back. Return the verified target/result once. Remove client-side duplicate post-writes. Do not use a compensating REST write, which can fail or overwrite concurrent edits.
- Local database tests must inject permission and audit failures after the profile statement and assert unchanged profile, permissions and audit; cover new/existing permission rows, absent target, wrong org, inactive/restricted caller, self-demotion, omitted fields, explicit revocation, concurrency and successful resulting state. Test application handling of missing RPC/schema errors with zero preceding writes. Exact SQL and grants require a separate review before application; none is applied here.

This plan deliberately does not broaden the current profile-authorization release. Migration approval remains unauthorized; containment deployment, future atomic function and any new application candidate require their own review.
