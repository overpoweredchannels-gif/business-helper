import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
const useLocalServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: useLocalServer
    ? {
        command: "npm --prefix .. run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    { name: "auth", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["auth"],
    },
  ],
});
