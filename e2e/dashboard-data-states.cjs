/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Windows Chrome browser runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const { chromium } = require('@playwright/test');

const waitForText = async (page, selector, text) => page.waitForFunction(
  ({ selector: target, text: expected }) => document.querySelector(target)?.textContent?.includes(expected) ?? false,
  { selector, text },
  { timeout: 5000 },
);

(async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({ entryPoints: [path.join(__dirname, 'fixtures/dashboard-data-states.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') });
  const output = path.join(__dirname, 'test-results/dashboard-data-states');
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/bundle.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.POS_CHROME_PATH ? { executablePath: process.env.POS_CHROME_PATH } : {}) });
    for (const width of [360, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const salesCard = page.locator('[data-dashboard-widget="kpi-today-sales"]');
      assert.ok((await salesCard.textContent()).includes('Not loaded'), `${width}px begins in not-loaded state`);
      assert.ok(!(await salesCard.textContent()).includes('PKR 0'), 'unread dashboard data is not presented as zero');

      await page.getByRole('button', { name: 'Load with one failure' }).click();
      await page.getByText('Loading…').first().waitFor();
      await waitForText(page, '[data-dashboard-widget="kpi-today-sales"]', 'Unavailable');
      await waitForText(page, '[data-dashboard-widget="kpi-payables"]', 'PKR 200.00');
      assert.ok(!(await salesCard.textContent()).includes('PKR 1,250.00'), 'failed sale dependency masks the stale amount');
      const healthCard = page.locator('[data-dashboard-widget="business-health"]');
      assert.ok((await healthCard.textContent()).includes('Business health is unavailable.'), 'derived health scores are hidden when a source fails');
      assert.ok((await page.locator('[data-dashboard-widget="needs-attention"]').textContent()).includes('Pending Approvals'), 'successful alert source remains actionable');
      await page.screenshot({ path: path.join(output, `partial-failure-${width}.png`), fullPage: true });

      const retrySales = salesCard.getByRole('button', { name: 'Retry dashboard reads' });
      await retrySales.focus();
      await page.keyboard.press('Enter');
      await waitForText(page, '[data-dashboard-widget="kpi-today-sales"]', 'PKR 1,250.00');

      await page.getByRole('button', { name: 'Fail products refresh' }).click();
      const inventoryCard = page.locator('[data-dashboard-widget="kpi-inventory-value"]');
      await waitForText(page, '[data-dashboard-widget="kpi-inventory-value"]', 'Unavailable');
      assert.ok((await inventoryCard.textContent()).includes('Last successful update:'), 'a retained last-good source read is labelled with its timestamp');
      assert.ok(!(await inventoryCard.textContent()).includes('PKR 4,000.00'), 'failed refresh does not show stale inventory as current');
      await inventoryCard.getByRole('button', { name: 'Retry dashboard reads' }).click();
      await waitForText(page, '[data-dashboard-widget="kpi-inventory-value"]', 'PKR 4,000.00');
      assert.equal((await page.locator('[data-testid="retry-count"]').textContent()).trim(), 'Retry count: 2', 'both failed sources recovered through the visible retry actions');

      await page.getByRole('button', { name: 'Switch organization during read' }).click();
      await waitForText(page, '[data-testid="committed-scope"]', 'account-b/org-b');
      assert.equal(await page.locator('[data-testid="committed-scope"]').textContent(), 'Committed scope: account-b/org-b', 'late previous-organization response cannot replace the current result');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px has no horizontal overflow`);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, `recovered-${width}.png`), fullPage: true });
      await page.close();

      const emptyPage = await browser.newPage({ viewport: { width, height: 900 } });
      await emptyPage.goto(`http://127.0.0.1:${server.address().port}/?empty`);
      await emptyPage.getByRole('button', { name: 'Load successful data' }).click();
      await waitForText(emptyPage, '[data-dashboard-widget="kpi-today-sales"]', 'PKR 0.00');
      assert.ok((await emptyPage.locator('[data-dashboard-widget="needs-attention"]').textContent()).includes('No actionable alerts.'), 'successful empty reads are shown as a valid zero state');
      assert.ok(await emptyPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await emptyPage.close();
      console.log(`Dashboard read-state browser checks passed at ${width}px`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
