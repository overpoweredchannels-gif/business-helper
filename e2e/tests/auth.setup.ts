import { expect, test as setup, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { authFiles } from "./support/auth-files";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. Use dedicated non-production E2E accounts; never commit credentials.`
    );
  }
  return value;
}

async function signIn(page: Page, input: {
  method: "Email" | "Profile ID";
  identifier: string;
  password: string;
  expectedPath: RegExp;
}) {
  await page.goto("/login");
  await page.getByRole("button", { name: input.method, exact: true }).click();
  await page.getByRole("textbox", { name: input.method, exact: true }).fill(input.identifier);
  await page.getByLabel("Password", { exact: true }).fill(input.password);
  await page.getByRole("button", { name: "Sign in to TradeOS" }).click();
  await expect(page).toHaveURL(input.expectedPath, { timeout: 30_000 });
  await expect(page.getByText(/Return error 401|Unauthorized|Sign in failed/i)).toHaveCount(0);
}

setup.beforeAll(async () => {
  await mkdir(path.dirname(authFiles.owner), { recursive: true });
});

setup("authenticate owner", async ({ page }) => {
  await signIn(page, {
    method: "Email",
    identifier: required("E2E_OWNER_EMAIL"),
    password: required("E2E_OWNER_PASSWORD"),
    expectedPath: /\/(?:#.*)?$/,
  });
  await page.context().storageState({ path: authFiles.owner, indexedDB: true });
});

setup("authenticate manager", async ({ page }) => {
  await signIn(page, {
    method: "Profile ID",
    identifier: required("E2E_MANAGER_PROFILE_ID"),
    password: required("E2E_MANAGER_PASSWORD"),
    expectedPath: /\/manager(?:\/|$)/,
  });
  await page.context().storageState({ path: authFiles.manager, indexedDB: true });
});

setup("authenticate employee", async ({ page }) => {
  await signIn(page, {
    method: "Profile ID",
    identifier: required("E2E_EMPLOYEE_PROFILE_ID"),
    password: required("E2E_EMPLOYEE_PASSWORD"),
    expectedPath: /\/salesman(?:\/|$)/,
  });
  await page.context().storageState({ path: authFiles.employee, indexedDB: true });
});
