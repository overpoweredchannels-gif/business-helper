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
  const bundle = await build({ entryPoints: [path.join(__dirname, 'fixtures/owner-home.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') });
  const output = path.join(__dirname, 'test-results/owner-home');
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((_req, res) => {
    if (_req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (_req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.POS_CHROME_PATH ? { executablePath: process.env.POS_CHROME_PATH } : {}) });
    for (const width of [360, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.addInitScript(() => localStorage.setItem('tradeos_dashboard_widgets_owner-home-synthetic', JSON.stringify({ hidden: [], added: [] })));
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const mode = process.argv[2] === 'before' ? 'before' : 'after';
      await page.goto(`http://127.0.0.1:${server.address().port}/?${mode}`);
      await page.getByText("Today's Sales", { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `${mode}-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px has no horizontal overflow`);
      if (mode === 'before') {
        assert.ok((await page.locator('[data-dashboard-widget="setup-import"]').boundingBox()).y < (await page.locator('[data-dashboard-widget="kpi-today-sales"]').boundingBox()).y, 'baseline captures the original setup-first order');
      } else {
        assert.ok((await page.locator('[data-dashboard-widget="kpi-today-sales"]').boundingBox()).y < (await page.locator('[data-dashboard-widget="setup-import"]').boundingBox()).y, 'business figures precede completed setup reminders');
        const kpiY = (await page.locator('[data-dashboard-widget="kpi-today-sales"]').boundingBox()).y;
        const attentionY = (await page.locator('[data-dashboard-widget="needs-attention"]').boundingBox()).y;
        const quickActionsY = (await page.locator('[data-dashboard-widget="quick-actions"]').boundingBox()).y;
        assert.ok(quickActionsY < kpiY && kpiY < attentionY, 'New Sale is offered first, followed by daily figures and current alerts');
        assert.ok(await page.getByText(/today.s sales and estimated profit/i).isVisible(), 'daily date range and current balance meaning are disclosed');
        assert.ok(await page.getByText(/current pending task, unpaid purchase, or stock alert/i).isVisible(), 'alert meanings are distinguished from daily totals');
        const actions = page.locator('[data-dashboard-widget="quick-actions"]');
        assert.equal(await actions.locator('button.bg-primary').count(), 1, 'New Sale is the only primary quick action');
        const todaySales = page.locator('[data-dashboard-widget="kpi-today-sales"] button');
        assert.ok((await todaySales.getAttribute('class')).includes('focus-visible:ring-2'), 'clickable business figures show a keyboard focus ring');
        await todaySales.focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.getByTestId('destination').textContent(), 'Destination: sales', 'the daily sales card works from the keyboard');
        for (const [label, destination] of [['New Sale', 'sales'], ['View Inventory', 'inventory'], ['New Purchase', 'purchases'], ['Record Payment', 'customer-payments']]) {
          const button = actions.getByRole('button', { name: label, exact: true });
          await button.focus();
          if (label === 'New Sale') await page.keyboard.press('Enter');
          else await button.click();
          assert.equal(await page.getByTestId('destination').textContent(), `Destination: ${destination}`, `${label} opens ${destination}`);
        }
        const alerts = page.locator('[data-dashboard-widget="needs-attention"]');
        for (const [label, destination] of [['Pending Approvals', 'sales:orders/pending-approval'], ['Collection Tasks', 'task-manager:all'], ['Unpaid Purchases', 'supplier-payments'], ['Urgent Reorders', 'inventory'], ['Customer Follow-ups', 'task-manager:all'], ['Expiring Stock Checks', 'task-manager:all']]) {
          await alerts.getByRole('button').filter({ hasText: label }).click();
          assert.equal(await page.getByTestId('destination').textContent(), `Destination: ${destination}`, `${label} opens ${destination}`);
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Owner home ${mode} ${width}px captured`);
    }
    const empty = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await empty.goto(`http://127.0.0.1:${server.address().port}/?after&empty=1`);
    await empty.getByRole('button', { name: 'New Sale', exact: true }).waitFor();
    assert.equal(await empty.locator('[data-dashboard-widget="needs-attention"]').count(), 0, 'empty data does not fabricate action alerts');
    assert.equal(await empty.locator('[data-dashboard-widget="kpi-today-sales"]').count(), 0, 'unavailable figures are omitted instead of shown as zero');
    await empty.close();

    const saved = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await saved.addInitScript(() => {
      const key = 'tradeos_dashboard_widgets_owner-home-synthetic';
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ hidden: ['kpi-today-profit'], added: ['products'] }));
    });
    await saved.goto(`http://127.0.0.1:${server.address().port}/?after`);
    assert.equal(await saved.locator('[data-dashboard-widget="kpi-today-profit"]').count(), 0, 'a saved hidden card stays hidden with the new default order');
    assert.ok(await saved.locator('[data-dashboard-widget="section:products"]').isVisible(), 'a saved section card remains on the dashboard');
    await saved.reload();
    assert.equal(await saved.locator('[data-dashboard-widget="kpi-today-profit"]').count(), 0, 'the saved hidden choice persists after reload');
    assert.ok(await saved.locator('[data-dashboard-widget="section:products"]').isVisible(), 'the saved section card persists after reload');
    await saved.getByRole('button', { name: 'Edit home' }).click();
    const edit = saved.getByRole('region', { name: 'Edit home dashboard' });
    await edit.getByRole('button', { name: "Today's Profit" }).click();
    assert.equal(await saved.locator('[data-dashboard-widget="kpi-today-profit"]').count(), 1, 'a saved card can be restored');
    await saved.reload();
    assert.equal(await saved.locator('[data-dashboard-widget="kpi-today-profit"]').count(), 1, 'the restored layout persists after reload');
    assert.ok(await saved.locator('[data-dashboard-widget="section:products"]').isVisible(), 'added section preferences persist after reload');
    await saved.close();
    console.log('Owner home shortcuts, alerts, empty data, and saved-layout restoration passed');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
