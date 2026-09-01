import { expect, test } from "@playwright/test";
import { authFiles } from "./support/auth-files";
import { visitHealthy } from "./support/health";

test.use({ storageState: authFiles.employee });

test("employee dashboard and assigned work load", async ({ page }) => {
  await visitHealthy(page, "/salesman", /New Sale|My assigned customers/i);
  await visitHealthy(page, "/salesman/routes", /My Routes/i);
  await visitHealthy(page, "/salesman/visits", /Today's Visits/i);
  await visitHealthy(page, "/salesman/attendance", /Attendance/i);
});

test("employee can open a new sale form without submitting it", async ({ page }) => {
  await visitHealthy(page, "/salesman/drafts?new=1", /New Sale/i);
  await expect(page.getByText(/assigned customer|Customer/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit|Send.*approval|Create Draft/i })).toBeVisible();
});
