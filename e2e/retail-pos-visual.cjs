(async () => {
  const { default: fs } = await import('node:fs');
  const { default: path } = await import('node:path');
  const { default: http } = await import('node:http');
  const { build } = await import('esbuild');
  const { default: postcss } = await import('postcss');
  const { default: tailwind } = await import('@tailwindcss/postcss');
  const { chromium } = await import('@playwright/test');
  const { default: assert } = await import('node:assert/strict');
  const root = path.resolve(__dirname, '..');
  const mode = process.argv[2] === 'before' ? 'before' : 'after';
  const output = path.join(root, 'validation-reports');
  fs.mkdirSync(output, { recursive: true });
  const bundle = await build({
    entryPoints: [path.join(__dirname, 'fixtures/retail-pos.tsx')], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'fixture-boundaries', setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /lib\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
        loader: 'js',
        contents: args.path === 'next/navigation'
          ? 'export const usePathname=()=>"/sales";export const useRouter=()=>({push:(url)=>location.assign(url)});'
          : args.path === 'supabase'
            ? 'export const supabase={auth:{signOut:async()=>{}}};'
            : 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children);}',
        resolveDir: root,
      }));
    }}],
  });
  const css = await postcss([tailwind({ base: root })]).process(
    fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'),
    { from: path.join(root, 'src/app/globals.css') },
  );
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/bundle.js')) {
      response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);
    } else if (request.url.startsWith('/styles.css')) {
      response.setHeader('Content-Type', 'text/css'); response.end(css.css);
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.POS_CHROME_PATH ? { executablePath: process.env.POS_CHROME_PATH } : {}) });
    for (const width of [360, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 850 }, isMobile: width < 640, hasTouch: width < 640 });
      const errors = [];
      let mobileRow;
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?long=1`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('heading', { name: 'Retail POS test' }).waitFor();
      const helpClose = page.getByRole('button', { name: 'Close help' });
      if (await helpClose.isVisible().catch(() => false)) await helpClose.click();
      const viewport = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }));
      if (mode === 'after') {
        assert.ok(viewport.documentWidth <= viewport.width + 1, `page overflows at ${width}px`);
        if (width < 640) {
          assert.equal(await page.locator('[data-pos-mobile-row]:visible').count(), 12, 'mobile basket rows are visible');
          assert.equal(await page.locator('[data-pos-desktop-table]:visible').count(), 0, 'desktop table is hidden on phones');
          mobileRow = page.locator('[data-pos-mobile-row]').first();
          const rowOverflow = await mobileRow.evaluate(element => element.scrollWidth > element.clientWidth + 1);
          assert.equal(rowOverflow, false, 'mobile basket row has no horizontal scroll');
        } else {
          assert.equal(await page.locator('[data-pos-desktop-table]:visible').count(), 1, 'desktop table remains visible');
          assert.equal(await page.locator('[data-pos-mobile-row]:visible').count(), 0, 'mobile rows are hidden');
        }
      }
      const screenshot = path.join(output, `pos-${mode}-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      console.log(`${mode} ${width}px: ${JSON.stringify(viewport)} screenshot=${screenshot}`);
      assert.deepEqual(errors, [], `${width}px browser errors`);

      if (mode === 'after' && mobileRow) {
          await mobileRow.locator('details').locator('summary').click();
          const row = mobileRow;
          for (const label of ['Unit for Test Box 1', 'Price for Test Box 1', 'Discount for Test Box 1']) {
            assert.ok(await row.getByRole(label.startsWith('Unit') ? 'combobox' : 'spinbutton', { name: label }).isVisible(), `${label} is available`);
          }
          assert.ok(await row.getByRole('button', { name: 'Remove Test Box 1' }).isVisible(), 'remove action is available');
          const productSearch = page.getByRole('combobox', { name: 'Product' });
          await productSearch.fill('SKU-12');
          const option = page.getByRole('option', { name: /Test Box 12/ });
          assert.ok(await option.evaluate(element => element.getBoundingClientRect().height >= 44), 'search suggestion meets the phone target');
          await productSearch.press('ArrowDown');
          await productSearch.press('Enter');
          await page.waitForFunction(() => document.activeElement?.getAttribute('data-pos-quantity') === '12');
          assert.equal(await page.locator('[data-pos-mobile-row]:visible').count(), 13, 'keyboard selection adds the product to the phone basket');
      }

      if (width <= 768) {
        const quantity = page.getByRole('spinbutton', { name: 'Quantity for Test Box 12' }).last();
        await quantity.focus();
        await page.setViewportSize({ width, height: 420 });
        await quantity.scrollIntoViewIfNeeded();
        const focusMetrics = await page.evaluate(() => {
          const focused = document.activeElement.getBoundingClientRect();
          const bar = (document.querySelector('[data-pos-payment-bar]') ?? document.querySelector('.sticky.bottom-2'))?.getBoundingClientRect();
          const overlap = bar ? Math.max(0, Math.min(focused.bottom, bar.bottom) - Math.max(focused.top, bar.top)) : 0;
          return { focusedTop: focused.top, focusedBottom: focused.bottom, viewportHeight: innerHeight, barTop: bar?.top ?? null, overlap };
        });
        console.log(`${mode} focused ${width}x420 keyboard-height simulation: ${JSON.stringify(focusMetrics)}`);
        if (mode === 'after') {
          assert.ok(focusMetrics.focusedTop >= 0 && focusMetrics.focusedBottom <= focusMetrics.viewportHeight, `${width}px focused quantity stays in the reduced viewport`);
          assert.equal(focusMetrics.overlap, 0, `${width}px payment bar does not cover the focused quantity`);
        }
        if (mode === 'after' && width === 360) await page.screenshot({ path: path.join(output, 'pos-after-360-keyboard-height.png') });
      }
      await page.close();
    }

    if (mode === 'after') {
      const page = await browser.newPage({ viewport: { width: 390, height: 850 }, isMobile: true, hasTouch: true });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForLoadState('networkidle');
      const helpClose = page.getByRole('button', { name: 'Close help' });
      if (await helpClose.isVisible().catch(() => false)) await helpClose.click();
      const barcode = page.getByRole('textbox', { name: 'Barcode' });
      await barcode.fill('001201');
      await barcode.press('Enter');
      const payment = page.getByRole('spinbutton', { name: 'Cash received' });
      const save = page.getByRole('button', { name: 'Pay & Save' });
      const totalText = await page.locator('[data-pos-payment-bar] .text-3xl').innerText();
      const total = Number(totalText.replace(/[^\d.]/g, ''));
      assert.ok(Number.isFinite(total) && total > 0, `displayed total is usable: ${totalText}`);
      const formatMoney = value => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR' }).format(value);
      assert.ok(await page.getByText(`Change due: ${new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR' }).format(0)}`).isVisible(), 'blank cash defaults to exact payment');
      assert.equal(await save.isDisabled(), false, 'blank cash can save at the exact total');
      await payment.fill('0');
      assert.equal(await save.isDisabled(), true, 'zero cash is insufficient');
      assert.ok(await page.getByText(/Cash short by/).isVisible(), 'zero cash shows a shortfall');
      assert.equal(await page.getByText(/Return to customer/).count(), 0, 'shortfall is never labeled as customer change');
      const insufficientCash = Math.max(0.01, total / 2);
      await payment.fill(String(insufficientCash));
      assert.equal(await save.isDisabled(), true, 'insufficient cash cannot save');
      assert.ok(await page.getByText(`Cash short by ${formatMoney(total - insufficientCash)}.`).isVisible(), 'insufficient cash displays the matching shortfall');
      await payment.fill(String(total));
      assert.equal(await save.isDisabled(), false, 'exact cash can save');
      assert.ok(await page.getByText(`Change due: ${formatMoney(0)}`).isVisible(), 'exact cash has zero change');
      await save.click();
      const dialog = page.getByRole('dialog', { name: /Receipt S-TEST-1/ });
      await dialog.waitFor();
      const receivedRow = dialog.getByText('Cash received', { exact: true }).locator('xpath=..');
      const changeRow = dialog.getByText('Change', { exact: true }).locator('xpath=..');
      assert.ok((await receivedRow.innerText()).includes(totalText), 'receipt cash received matches the exact cash input');
      assert.ok((await dialog.getByText('Total', { exact: true }).locator('xpath=..').innerText()).includes(totalText), 'receipt total matches the POS total');
      assert.ok((await changeRow.innerText()).includes(formatMoney(0)), 'receipt change matches the POS summary');
      for (const button of await dialog.getByRole('button').all()) {
        const box = await button.boundingBox();
        assert.ok(box && box.height >= 44 && box.width >= 44, 'receipt dialog controls meet the mobile target');
      }
      await page.screenshot({ path: path.join(output, 'pos-after-390-receipt.png') });
      await dialog.getByRole('button', { name: 'Close' }).click();
      await barcode.fill('001202');
      await barcode.press('Enter');
      const excessTotalText = await page.locator('[data-pos-payment-bar] .text-3xl').innerText();
      const excessTotal = Number(excessTotalText.replace(/[^\d.]/g, ''));
      const excessCash = excessTotal + 30;
      const excessSave = page.getByRole('button', { name: 'Pay & Save' });
      await page.getByRole('spinbutton', { name: 'Cash received' }).fill(String(excessCash));
      assert.ok(await page.getByText(`Change due: ${formatMoney(30)}`).isVisible(), 'excess cash displays change due');
      await excessSave.click();
      const excessDialog = page.getByRole('dialog', { name: /Receipt S-TEST-2/ });
      await excessDialog.waitFor();
      assert.ok((await excessDialog.getByText('Total', { exact: true }).locator('xpath=..').innerText()).includes(excessTotalText), 'excess receipt total matches the POS total');
      assert.ok((await excessDialog.getByText('Cash received', { exact: true }).locator('xpath=..').innerText()).includes(formatMoney(excessCash)), 'excess receipt amount matches the input');
      assert.ok((await excessDialog.getByText('Change', { exact: true }).locator('xpath=..').innerText()).includes(formatMoney(30)), 'receipt change matches the excess cash input');
      await page.close();
      console.log('after cash UI: blank, zero, insufficient, exact, excess, receipt totals/change, and receipt targets passed');
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
