# Evidence for Codex — redeployed QA candidate `d1bd245` (Option B complete)

**Deployment ID:** `dpl_3omNBFWdAhkQR9PqBQyXyVD9YC47`
**Full SHA:** `d1bd245d6986061c073681f834e97743bb238b88` (verified character-for-character)
**URL:** `https://tradeos-nu3scr876-overpoweredchannels-7830s-projects.vercel.app`
  (also serves `tradeos-qa.vercel.app`)
**Created:** 15 Oct 2026, 02:14:54 GMT+5 · **Status:** Ready, Latest, Current Production
**Branch:** `review/tradeos-search-security-integration`
**How produced:** dashboard Redeploy of the approved `d1bd245` deployment, build cache
  disabled, after the key update below. No other project touched.
**Verified by:** OPPRESSO · **When:** 2026-10-15, 02:14–02:28 PKT
**Sources:** Vercel dashboard (read-only, except the authorized redeploy); live
  JavaScript bundle inspection on the exact deployment; application source at `d1bd245`;
  live Chromium baseline on the deployment as owner. No migration, no rollback,
  no business-helper deployment, no env changes by the verifier. Sanitized: no key
  material. Production never touched.

## 1. Key-source confirmation (provenance by construction)

- **Owner statement (private action, recorded here without the value):** UMAIR copied
  the *existing* `service_role` key from the Supabase dashboard of project
  `rtfowunsyrdygyvubnvs` (Project Settings → API, Reveal → Copy; no regeneration)
  into tradeos-qa's `SUPABASE_SERVICE_ROLE_KEY`, all existing environment scopes
  (Production, Preview, Development). Completed ~01:58 PKT. No other variable
  changed; deployment protection unchanged (Standard, Require Log In).
- **Dashboard verification (read-only):** `SUPABASE_SERVICE_ROLE_KEY` shows
  "Last updated 15 Oct 2026 01:58:16 AM GMT+5" (Production), "01:57:57 AM" (Preview).
  The new deployment was created 02:14:54 — **after** the key update — so it resolves
  the newly saved value. Vercel deployments are immutable; the value cannot be
  revealed afterward (write-only Secret), which is why this construction was used.
- **Behavioral confirmation:** the server successfully executed service_role-gated
  operations on this deployment after the redeploy — `auth.admin.createUser` during
  the T1 invite flow (new Auth/profile rows created for the synthetic employee) and
  service-client profile writes (W4, T4). A key belonging to any other project would
  be rejected against `https://rtfowunsyrdygyvubnvs.supabase.co`.

## 2. Client/server targets (deployment-resolved)

- **Client:** the exact deployment's JS bundle instantiates the Supabase client with
  `https://rtfowunsyrdygyvubnvs.supabase.co` (verbatim); exactly one `*.supabase.co`
  hostname in page + chunks.
- **Server:** source at `d1bd245` — `src/lib/supabase/server.ts` reads the URL from
  `NEXT_PUBLIC_SUPABASE_URL` (not `SUPABASE_URL`) and the key from
  `SUPABASE_SERVICE_ROLE_KEY`; `src/lib/supabase/client.ts` uses
  `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Server URL therefore
  equals the bundle-verified client URL: `rtfowunsyrdygyvubnvs`.

## 3. Synthetic baseline results (owner session, disposable project only)

| Test | Result | Evidence |
|------|--------|----------|
| W4 owner staff edit | **PASS** | QA111 renamed "QA Employee A v3" → "QA Employee A v4"; persisted after staff-list reload. |
| T1 invite reuse (c8af1bb fix) | **PASS** | New synthetic employee "QA Reuse Staff" (`qa-reuse-20251015@example.com`, Salesman). "Copy Link" clicked twice (both succeeded server-side). Staff & Permissions shows **exactly one** "QA Reuse Staff" profile (QA12, role salesman) — the second invite reused the pending invite; zero additional Auth/profile rows, no suffixed duplicate. |
| T2 accepted rejection | **PASS** | "Copy Link" on accepted fixture "QA Employee A" → message "This employee has already accepted their invitation." No link generated; profile count unchanged (14). No new rows. |
| T3 expired renewal | **NOT PERFORMED** | No expired synthetic invite fixture exists; expiry is not UI-editable; nothing manipulated. |
| T4 import matched UPDATE | **PARTIAL — new finding** | CSV row with the fixture's real profile login email matched: preview "Update: 1 — Matches an existing Staff & Permissions record (e41dc563-9871-40ab-ac70-c36c38d7bbd6). Only supplied fields will be updated." Result: Created: 0, Updated: 0, Skipped: 0, **Failed: 1** — verbatim row error: "Row 2: Could not find the 'can_manage_ai_assistant' column of 'staff_permissions' in the schema cache". Post-check: QA111 **did** persist the update (display name "QA Employee A imported v2", role salesman, Active). So matching now works, the profile write persisted, but the row is marked Failed on a `staff_permissions` upsert against a column missing from the PostgREST schema cache — non-atomic row handling plus app/DB schema drift on `can_manage_ai_assistant`. |
| T5 import contact-email mismatch | **PASS (rejected)** | Preview Errors: 1 — "No staff profile matches this login email in your organization. Use Employees → Invite to provision". Import disabled; staff (14) and employee lists reloaded — nothing created. |
| T6 import unmatched email | **PASS (rejected)** | Same as T5: preview Error, import disabled, nothing created. Unsupported creation rejected without writes. |

New synthetic fixtures created and **preserved** (not cleaned): employee "QA Reuse Staff"
+ profile QA12 (role salesman). Prior fixtures (QA10/QA101/QA11/QA111, stray
"QA Import Staff" employee) untouched.

## 4. Notes for the binding + preflight

- Suggested runner binding: deployment `dpl_3omNBFWdAhkQR9PqBQyXyVD9YC47`,
  SHA `d1bd245d6986061c073681f834e97743bb238b88`,
  URL `https://tradeos-nu3scr876-overpoweredchannels-7830s-projects.vercel.app`.
- The T4 `can_manage_ai_assistant` schema-cache failure is new at this revision and
  needs your read — the import's matched-UPDATE path is otherwise functional.
- Evidence freshness: baseline completed 02:28 PKT; re-verify within your one-hour
  window before preflight.
