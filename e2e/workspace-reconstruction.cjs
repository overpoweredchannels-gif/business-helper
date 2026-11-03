/* eslint-disable @typescript-eslint/no-require-imports -- Browser verification runner. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const { chromium } = require('@playwright/test');

(async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({ entryPoints: [path.join(__dirname, 'fixtures/workspace-reconstruction.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': JSON.stringify({ NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-only' }) } });
  const styles = await postcss([tailwind({ base: root })]).process(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src/app/workspace.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') });
  const server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(styles.css); }
    else if (req.url.startsWith('/aankh-')) { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(path.join(root, 'public', req.url))); }
    else res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.POS_CHROME_PATH ? { executablePath: process.env.POS_CHROME_PATH } : {}) });
  const output = path.join(root, 'e2e/test-results/reconstruction');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [320, 390, 768, 1366, 1920]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByRole('heading', { name: 'Quick sale', exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: dashboard fits`);
      if (width >= 1024) assert.ok(await page.locator('aside:visible nav').evaluate(el => el.scrollHeight <= el.clientHeight + 2), 'primary navigation fits without scrolling');
      const quickSaleY = await page.locator('[data-dashboard-widget="quick-sale"]').evaluate(el => el.getBoundingClientRect().top);
      const chartY = await page.locator('[data-dashboard-widget="chart-revenue"]').evaluate(el => el.getBoundingClientRect().top);
      assert.ok(quickSaleY < chartY, 'quick sale precedes analytics');
      await page.getByRole('button', { name: 'Edit home', exact: true }).click();
      const before = await page.locator('.dashboard-grid > [data-dashboard-widget]').evaluateAll(els => els.map(el => el.dataset.dashboardWidget));
      await page.getByRole('button', { name: 'Move Quick sale up', exact: true }).click();
      const after = await page.locator('.dashboard-grid > [data-dashboard-widget]').evaluateAll(els => els.map(el => el.dataset.dashboardWidget));
      assert.equal(after.indexOf('quick-sale'), before.indexOf('quick-sale') - 1);
      await page.reload();
      await page.getByRole('heading', { name: 'Quick sale', exact: true }).waitFor();
      assert.deepEqual(await page.locator('.dashboard-grid > [data-dashboard-widget]').evaluateAll(els => els.map(el => el.dataset.dashboardWidget)), after, 'saved order survives reload');
      await page.keyboard.press('Control+Home');
      await page.screenshot({ path: path.join(output, `dashboard-${width}.png`), fullPage: true });
      if (width < 1024) await page.locator('header button[aria-expanded]').first().click();
      const sidebar = page.locator('aside:visible');
      await sidebar.getByRole('searchbox', { name: 'Find a page' }).fill('sales');
      await sidebar.getByRole('button', { name: 'Sales', exact: true }).click();
      assert.equal(await page.locator('[data-testid="records"]').count(), 0, 'history starts closed');
      await page.getByRole('button', { name: 'View history', exact: true }).click();
      assert.equal(await page.locator('[data-testid="records"] li').count(), 10);
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      assert.equal(await page.locator('[data-testid="records"] li').first().textContent(), 'S-011');
      await page.getByRole('textbox', { name: 'History filter' }).fill('023');
      assert.equal(await page.locator('[data-testid="records"] li').count(), 1);
      assert.equal(await page.locator('[data-testid="records"] li').first().textContent(), 'S-023');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: filtered history fits`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.deepEqual(errors, []);
      console.log(`Workspace reconstruction passed at ${width}px: navigation, ordering persistence, history disclosure and paging.`);
      await page.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
