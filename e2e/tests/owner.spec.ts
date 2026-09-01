import { expect, test } from "@playwright/test";
import { authFiles } from "./support/auth-files";
import { visitHealthy } from "./support/health";

test.use({ storageState: authFiles.owner });

test("owner dashboard and core business sections load", async ({ page }) => {
  await visitHealthy(page, "/#dashboard", /Today's Sales|Business Health/i);
  await visitHealthy(page, "/#customers", /Customer Management|Customers/i);
  await visitHealthy(page, "/#products", /Product Management|Products/i);
  await visitHealthy(page, "/#customer-payments", /Customer Payments/i);
});

test("sales invoice and import preview entry point open without changing data", async ({ page }) => {
  await visitHealthy(page, "/#sales", /Sales Invoice/i);
  await page.getByRole("button", { name: "Import", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Import Sales Invoices" })).toBeVisible();
  await expect(page.getByText(/Upload|Choose.*file|CSV|Excel/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import Sales Invoices" })).toHaveCount(0);
});

test("owner routes, territories, and live tracking load", async ({ page }) => {
  await visitHealthy(page, "/#territories", /Territories/i);
  await visitHealthy(page, "/#routes", /Sales Routes/i);
  await visitHealthy(page, "/#live-tracking", /Live Tracking|Live Workforce Tracking/i);
});
