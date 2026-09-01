import { test } from "@playwright/test";
import { authFiles } from "./support/auth-files";
import { visitHealthy } from "./support/health";

test.use({ storageState: authFiles.manager });

test("manager operational workspace loads", async ({ page }) => {
  await visitHealthy(page, "/manager", /Manager|Pending draft approvals/i);
  await visitHealthy(page, "/manager/team", /Field Team/i);
  await visitHealthy(page, "/manager/customers", /Customers/i);
  await visitHealthy(page, "/manager/collections", /Collections/i);
});

test("manager route and tracking views load", async ({ page }) => {
  await visitHealthy(page, "/manager/routes", /Route Dashboard/i);
  await visitHealthy(page, "/manager/live", /Live Tracking|Workforce/i);
});
