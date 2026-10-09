# TradeOS authenticated end-to-end tests

These tests are read-only smoke journeys for owner, manager, and employee workflows. They open sales and import forms but never submit business data.

## One-time setup

From `E:\tradeos\e2e`:

```powershell
npm install
npm run install:browsers
```

Create dedicated test accounts in one isolated TradeOS organization, then set these variables only in your terminal or CI secret store:

```powershell
$env:E2E_OWNER_EMAIL="owner-test@example.com"
$env:E2E_OWNER_PASSWORD="..."
$env:E2E_MANAGER_PROFILE_ID="MANAGER_TEST_ID"
$env:E2E_MANAGER_PASSWORD="..."
$env:E2E_EMPLOYEE_PROFILE_ID="EMPLOYEE_TEST_ID"
$env:E2E_EMPLOYEE_PASSWORD="..."
```

For the deployed application:

```powershell
$env:E2E_BASE_URL="https://business-helper-ten.vercel.app"
npm test
```

Omit `E2E_BASE_URL` to start and test the local Next.js application. Authentication state is written under `.auth/`, which is ignored by Git and must never be committed.

## Home authentication and hook-order regression

`page-auth-transitions.cjs` exercises the actual Home page through logged-out,
authenticated, profile-loading, first-run guide, empty-catalog, logout, and
second-organization states. It requires a locally running app whose
`/api/pos-release-environment` preflight reports only the disposable project
`rtfowunsyrdygyvubnvs`. It also blocks browser requests to every other
Supabase host. The first-run guide is dismissed without changing business data.

Use existing synthetic owner accounts only. The first owner must belong to an
organization with no products or customers; the second owner must belong to a
different organization. The runner verifies each account's existing profile
with its ordinary JWT before returning the sign-in response to the app, and
requires `/api/auth/provision` to report `alreadyProvisioned: true`.

Set these values only in a protected local PowerShell session or CI secret
store; never commit them or print them:

```powershell
$env:E2E_BASE_URL="http://127.0.0.1:3001"
$env:E2E_TEST_PROJECT_REF="rtfowunsyrdygyvubnvs"
$env:E2E_EMPTY_OWNER_EMAIL="<synthetic-owner-email>"
$env:E2E_EMPTY_OWNER_PASSWORD="<synthetic-owner-password>"
$env:E2E_EMPTY_OWNER_ORG_ID="<empty-synthetic-organization-id>"
$env:E2E_SECOND_OWNER_EMAIL="<second-synthetic-owner-email>"
$env:E2E_SECOND_OWNER_PASSWORD="<second-synthetic-owner-password>"
$env:E2E_SECOND_OWNER_ORG_ID="<second-synthetic-organization-id>"
node .\page-auth-transitions.cjs
```

This runner intentionally accepts loopback URLs only. It depends on the
existing isolated app target preflight and does not make the production-disabled
endpoint available in production.
