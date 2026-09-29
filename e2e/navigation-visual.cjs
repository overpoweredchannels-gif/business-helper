/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS browser runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const { chromium } = require('@playwright/test');

(async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({ entryPoints: [path.join(__dirname, 'fixtures/navigation.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') });
  const output = path.join(__dirname, 'test-results/navigation');
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.POS_CHROME_PATH ? { executablePath: process.env.POS_CHROME_PATH } : {}) });
    for (const width of [360, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const nav = page.getByRole('navigation', { name: 'Main navigation' });
      await nav.waitFor();
      assert.equal(await nav.locator('summary:visible').count(), 6);
      assert.equal(await nav.locator('[data-nav-id]:visible').count(), 1, 'only Dashboard is exposed before choosing a task');
      const stock = nav.locator('summary').filter({ hasText: /^Stock$/ });
      await stock.focus();
      await page.keyboard.press('Enter');
      await nav.getByRole('button', { name: 'Inventory', exact: true }).click();
      assert.equal(await nav.getByRole('button', { name: 'Inventory', exact: true }).getAttribute('aria-current'), 'page');
      assert.equal(await nav.locator('[data-nav-id="brands"]').count(), 0);
      const search = page.getByRole('searchbox', { name: 'Find a page' });
      await search.fill('Business Settings');
      await nav.getByRole('button', { name: 'Business Settings', exact: true }).click();
      await search.fill('');
      assert.ok(await nav.getByRole('button', { name: 'Business Settings', exact: true }).isVisible(), 'selected group is open after clearing search');
      await search.fill('no-such-page');
      assert.ok(await nav.getByRole('status').isVisible());
      await search.fill('');
      await page.getByRole('button', { name: 'Reorder or hide menu sections' }).click();
      assert.equal(await nav.locator('summary').count(), 0);
      assert.ok(await nav.locator('[data-nav-id="brands"]').isVisible(), 'hidden permitted pages remain customizable');
      await page.getByRole('button', { name: 'Done customizing' }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
      for (const summary of await nav.locator('summary').all()) assert.ok((await summary.boundingBox()).height >= 44);
      await page.screenshot({ path: path.join(output, `navigation-${width}.png`), fullPage: true });
      await page.goto(`http://127.0.0.1:${server.address().port}/?restricted=1`);
      await page.getByRole('searchbox', { name: 'Find a page' }).fill('settings');
      assert.equal(await page.locator('[data-nav-id="business-settings"]').count(), 0, 'search never adds an ungranted destination');
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Navigation ${width}px passed`);
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
