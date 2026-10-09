/* eslint-disable @typescript-eslint/no-require-imports */

(async () => {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const http = require('node:http');
  const { build } = require('esbuild');
  const postcss = require('postcss');
  const tailwind = require('@tailwindcss/postcss');
  const { chromium } = require('@playwright/test');
  const root = path.resolve(__dirname, '..');
  const output = path.join(os.tmpdir(), 'tradeos-pos-receipt-browser');
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(__dirname, '.pw-browsers');
  fs.mkdirSync(output, { recursive: true });

  const bundle = await build({
    entryPoints: [path.join(__dirname, 'fixtures/pos-receipt.tsx')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'receipt-fixture-boundaries', setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /lib\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
        loader: 'js',
        contents: args.path === 'next/navigation'
          ? 'export const usePathname=()=>"/sales";export const useRouter=()=>({push:(url)=>location.assign(url)});'
          : args.path === 'supabase'
            ? 'export const supabase={auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>{}}};'
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
      response.setHeader('Content-Type', 'text/javascript');
      response.end(bundle.outputFiles[0].text);
    } else if (request.url.startsWith('/styles.css')) {
      response.setHeader('Content-Type', 'text/css');
      response.end(css.css);
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.POS_CHROME_PATH
        ? { executablePath: process.env.POS_CHROME_PATH }
        : {}),
    });
    for (const width of [58, 80]) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.route('**/api/print-templates**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ templates: [{ is_default: true, config: { receiptWidthMm: width } }] }),
      }));
      await page.addInitScript(() => {
        window.__posPrintCalls = [];
        window.__posPrintEvents = [];
        window.addEventListener('beforeprint', () => window.parent.__posPrintEvents.push('beforeprint'));
        window.addEventListener('afterprint', () => window.parent.__posPrintEvents.push('afterprint'));
        window.print = function () {
          if (!window.frameElement) return;
          window.dispatchEvent(new Event('beforeprint'));
          window.parent.__posPrintCalls.push({
            title: document.title,
            text: document.body.innerText,
            html: '<!doctype html>' + document.documentElement.outerHTML,
          });
          window.parent.__posPrintFrame = window;
        };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/?width=${width}`);
      await page.getByRole('heading', { name: 'POS receipt browser fixture' }).waitFor();
      const openReceipt = page.getByRole('button', { name: 'Receipt for S-SYNTH-001', exact: true });
      await openReceipt.waitFor();
      await openReceipt.click();
      const dialog = page.getByRole('dialog', { name: 'Receipt S-SYNTH-001' });
      await dialog.waitFor();
      const preview = dialog.locator('[data-receipt-paper-width]');
      await page.waitForFunction(() => document.querySelector('[data-receipt-paper-width]')?.getAttribute('data-receipt-paper-width') === `${document.querySelector('[data-testid="receipt-fixture"]')?.getAttribute('data-requested-width')}`);
      assert.equal(await preview.getAttribute('data-receipt-paper-width'), `${width}mm`, `${width}mm preview uses requested paper width`);
      assert.ok((await dialog.innerText()).includes('0.125 Piece'), 'fractional quantity is rendered from the synthetic confirmed sale');
      assert.ok((await dialog.innerText()).includes('99,999,999,900.00'), 'large line amount is rendered');
      assert.ok((await dialog.innerText()).includes('99,999,999,910.08'), 'first receipt total matches its confirmed amount');

      const printButton = dialog.locator('button').nth(1);
      await printButton.waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('Print receipt'));
        return button && !button.disabled;
      });
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('[role="dialog"] button')].find(item => item.textContent?.includes('Print receipt'));
        if (!button) throw new Error('Print button not found');
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await page.waitForFunction(() => window.__posPrintCalls.length === 1);
      assert.equal(await printButton.isDisabled(), true, 'printing locks repeated actions until afterprint cleanup');
      let print = await page.evaluate(() => window.__posPrintCalls[0]);
      assert.match(print.title, /S-SYNTH-001/);
      await savePdfAndInspect(browser, print.html, width, 'first-sale', output);
      await page.evaluate(() => window.__posPrintFrame.dispatchEvent(new Event('afterprint')));
      await page.waitForFunction(() => window.__posPrintEvents.includes('afterprint'));
      await page.waitForFunction(() => !document.querySelector('iframe[title^="Print receipt"]'));
      assert.equal(await printButton.isDisabled(), false, 'mocked cancel/afterprint restores the print action');

      await printButton.click();
      await page.waitForFunction(() => window.__posPrintCalls.length === 2);
      print = await page.evaluate(() => window.__posPrintCalls[1]);
      assert.match(print.title, /S-SYNTH-001/, 'reprint still targets the first receipt');
      await page.evaluate(() => window.__posPrintFrame.dispatchEvent(new Event('afterprint')));
      await page.waitForFunction(() => !document.querySelector('iframe[title^="Print receipt"]'));

      await dialog.getByRole('button', { name: 'Close' }).click();
      await page.getByRole('button', { name: 'Select second synthetic sale' }).click();
      await page.getByRole('button', { name: 'Receipt for S-SYNTH-002', exact: true }).click();
      const secondDialog = page.getByRole('dialog', { name: 'Receipt S-SYNTH-002' });
      await secondDialog.waitFor();
      assert.equal(await secondDialog.locator('tbody tr').count(), 40, 'long receipt has all 40 lines');
      assert.ok((await secondDialog.innerText()).includes('100,000,000,293.12'), 'second sale has its distinct large confirmed total');
      await secondDialog.getByRole('button', { name: 'Print receipt' }).click();
      await page.waitForFunction(() => window.__posPrintCalls.length === 3);
      print = await page.evaluate(() => window.__posPrintCalls[2]);
      assert.match(print.title, /S-SYNTH-002/, 'switching sales prints the second receipt');
      assert.ok(print.text.includes('S-SYNTH-002') && !print.text.includes('S-SYNTH-001'), 'generated document contains no stale first-sale content');
      assert.equal((print.html.match(/data-receipt-line=/g) || []).length, 40, 'generated long document includes every receipt line');
      await savePdfAndInspect(browser, print.html, width, 'second-sale-long', output);
      await page.evaluate(() => window.__posPrintFrame.dispatchEvent(new Event('afterprint')));
      await page.waitForFunction(() => !document.querySelector('iframe[title^="Print receipt"]'));
      assert.deepEqual(errors, [], `${width}mm receipt flow has no browser errors`);
      await page.close();
      console.log(`PASS ${width}mm browser receipt: preview, fractional/large values, 40-line print document, rapid repeated action lock, mocked cancel cleanup, reprint, and second-sale switch.`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log(`Browser PDFs and screenshots: ${output}`);
})().catch(error => { console.error(error); process.exitCode = 1; });

async function savePdfAndInspect(browser, html, width, label, output) {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const http = require('node:http');
  const page = await browser.newPage({ viewport: { width: width === 58 ? 220 : 303, height: 320 } });
  page.setDefaultTimeout(10000);
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: 'print' });
    const metrics = await page.evaluate(() => {
      const body = document.body;
      const width = body.getBoundingClientRect().width;
      const rows = [...document.querySelectorAll('tbody tr')].map(row => {
        const rect = row.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      const last = document.body.lastElementChild.getBoundingClientRect();
      return {
        width,
        height: Math.max(body.scrollHeight, document.documentElement.scrollHeight),
        rows,
        lastBottom: last.bottom,
        text: body.innerText,
        lineCount: rows.length,
      };
    });
    assert.ok(Math.abs(metrics.width - width * 96 / 25.4) < 1, `${width}mm document CSS width`);
    assert.ok(metrics.rows.every(row => row.left >= -1 && row.right <= metrics.width + 1), `${width}mm line cells fit page width`);
    assert.ok(metrics.lastBottom <= metrics.height + 1, 'summary/footnote remain within document content height');
    const screenshot = path.join(output, `${width}mm-${label}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    const heightMm = Math.ceil((metrics.height + 2) * 25.4 / 96);
    const pdf = await page.pdf({
      width: `${width}mm`,
      height: `${heightMm}mm`,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
    });
    const pdfPath = path.join(output, `${width}mm-${label}.pdf`);
    fs.writeFileSync(pdfPath, pdf);
    const pdfText = pdf.toString('latin1');
    const boxes = [...pdfText.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map(match => match[1].trim().split(/\s+/).map(Number));
    assert.ok(pdf.length > 1000 && pdfText.startsWith('%PDF-'), 'Chromium produced a non-empty PDF');
    assert.ok(boxes.length > 0, 'PDF contains a page media box');
    const expectedWidthPt = width * 72 / 25.4;
    assert.ok(Math.abs(boxes[0][2] - expectedWidthPt) < 1.5, `${width}mm PDF page width is ${boxes[0][2]}pt`);
    assert.ok(boxes[0][3] * 96 / 72 >= metrics.height - 3, 'PDF page height contains the full document');
    assert.ok(metrics.text.includes('Thank you for your business.'), 'rendered document retains its final footnote');
    const pdfViewerServer = http.createServer((request, response) => {
      response.setHeader('Content-Type', 'application/pdf');
      response.setHeader('Content-Disposition', 'inline; filename="receipt.pdf"');
      response.end(fs.readFileSync(pdfPath));
    });
    await new Promise(resolve => pdfViewerServer.listen(0, '127.0.0.1', resolve));
    const viewer = await browserTypeForPdf();
    try {
      const viewerPage = await viewer.newPage({ viewport: { width: 1280, height: 1000 } });
      await viewerPage.goto(`http://127.0.0.1:${pdfViewerServer.address().port}/receipt.pdf`, { waitUntil: 'domcontentloaded' });
      await viewerPage.waitForTimeout(1200);
      assert.ok(viewerPage.frames().some(frame => frame.url().startsWith('chrome-extension://')), 'Chrome PDF viewer loaded the generated PDF');
      const pdfTop = path.join(output, `${width}mm-${label}-pdf-top.png`);
      const pdfBottom = path.join(output, `${width}mm-${label}-pdf-bottom.png`);
      await viewerPage.screenshot({ path: pdfTop });
      await viewerPage.mouse.move(800, 800);
      await viewerPage.mouse.wheel(0, 10000);
      await viewerPage.waitForTimeout(300);
      await viewerPage.screenshot({ path: pdfBottom });
      console.log(`PASS PDF ${width}mm ${label}: ${metrics.lineCount} rows, content ${metrics.width}x${metrics.height}px, page box ${boxes[0].join(' ')}pt, PDF ${pdf.length} bytes; print-layout=${screenshot}; Chrome PDF viewer top/bottom=${pdfTop},${pdfBottom}`);
    } finally {
      await viewer.close();
      await new Promise(resolve => pdfViewerServer.close(resolve));
    }
  } finally {
    await page.close();
  }
}

async function browserTypeForPdf() {
  const { chromium } = require('@playwright/test');
  return chromium.launch({ channel: 'chrome', headless: true });
}
