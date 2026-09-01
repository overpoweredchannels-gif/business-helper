import { expect, type Page, type Response } from "@playwright/test";

export async function visitHealthy(page: Page, url: string, expectedText: RegExp) {
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  const onPageError = (error: Error) => pageErrors.push(error.message);
  const onResponse = (response: Response) => {
    if (response.url().startsWith(page.url().split("#")[0]) && response.status() >= 500) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  };

  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByText(expectedText).first()).toBeVisible();
    await expect(page.getByText(/Return error 401|Application error|Something went wrong/i)).toHaveCount(0);
    expect(pageErrors, `Uncaught browser errors at ${url}`).toEqual([]);
    expect(failedResponses, `Server failures at ${url}`).toEqual([]);
  } finally {
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  }
}
