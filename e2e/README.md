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
