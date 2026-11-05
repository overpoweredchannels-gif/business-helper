/* eslint-disable @typescript-eslint/no-require-imports -- Standalone headless-shell screenshot runner. */
/* Quiet Ledger fixture screenshots (isolated, localhost only).
 *
 * Bundles e2e/fixtures/dashboard-data-states.tsx (synthetic data only) with
 * esbuild, compiles src/app/globals.css with Tailwind, serves both on
 * 127.0.0.1, and screenshots the real DashboardView with the cached
 * headless-shell binary (no Playwright package, no network, no Supabase,
 * no sign-in, no production data).
 *
 * Scenarios: loaded (?autoload=success), empty (?empty&autoload=success),
 * failure (?autoload=failure). Widths: 1440 / 768 / 390.
 * Exits non-zero if any viewport has page-level horizontal overflow.
 *
 * Usage (from the repo root, with the node_modules borrow in place):
 *   node e2e/quiet-ledger-shots.cjs [--out e2e/test-results/quiet-ledger]
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');

const HEADLESS_SHELL_CANDIDATES = [
  path.join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell'),
  path.join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell'),
];
const SHELL = HEADLESS_SHELL_CANDIDATES.find((p) => fs.existsSync(p));
if (!SHELL) {
  console.error('No cached headless-shell binary found. Checked:');
  HEADLESS_SHELL_CANDIDATES.forEach((p) => console.error(`  ${p}`));
  process.exit(2);
}

const SCENARIOS = [
  { name: 'loaded', query: '?autoload=success' },
  { name: 'empty', query: '?empty&autoload=success' },
  { name: 'failure', query: '?autoload=failure' },
];
const WIDTHS = [1440, 768, 390];
const HEIGHT = 900;

// Async Chrome runner: the fixture server lives in this same process, so the
// Chrome invocation MUST NOT block the event loop (spawnSync would starve
// the server and Chrome would time out on a blank error page).
const runChrome = (args) => new Promise((resolve, reject) => {
  const child = spawn(SHELL, args);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('chrome timed out after 90s')); }, 90000);
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }); });
});

const outDir = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
  : path.join(__dirname, 'test-results/quiet-ledger');

(async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    entryPoints: [path.join(__dirname, 'fixtures/dashboard-data-states.tsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife',
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
    // The dashboard import chain pulls in the Supabase client module, whose
    // top level reads process.env. Browsers have no `process`, so the bundle
    // throws before React renders. Shim it with dummy, unroutable values
    // (the fixture never calls the client; nothing can reach production).
    banner: { js: 'window.process=window.process||{env:{NODE_ENV:"development",NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:1",NEXT_PUBLIC_SUPABASE_ANON_KEY:"dummy-test-key"}};' },
  });
  const css = await postcss([tailwind({ base: root })]).process(
    fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'),
    { from: path.join(root, 'src/app/globals.css') },
  );
  // The real app also loads workspace.css (dashboard grid, rhythm, phone
  // targets). Without it the fixture renders every card full-width and the
  // metric-span change is invisible. Compile and serve it too.
  const workspaceCss = await postcss([tailwind({ base: root })]).process(
    fs.readFileSync(path.join(root, 'src/app/workspace.css'), 'utf8'),
    { from: path.join(root, 'src/app/workspace.css') },
  );
  fs.mkdirSync(outDir, { recursive: true });
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/workspace.css"></head><body><div id="root"></div><script>window.addEventListener("load",function(){setTimeout(function(){document.body.setAttribute("data-overflow",document.documentElement.scrollWidth>window.innerWidth?"YES":"NO");document.body.setAttribute("data-scrollw",String(document.documentElement.scrollWidth));document.body.setAttribute("data-innerw",String(window.innerWidth));},1200);});</script><script src="/bundle.js"></script></body></html>';
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/bundle.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); }
    else if (req.url === '/workspace.css') { res.setHeader('Content-Type', 'text/css'); res.end(workspaceCss.css); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(html); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const failures = [];
  try {
    for (const scenario of SCENARIOS) {
      for (const width of WIDTHS) {
        const url = `http://127.0.0.1:${port}/${scenario.query}`;
        const shot = path.join(outDir, `${scenario.name}-${width}.png`);
        const shotRun = await runChrome([
          '--headless', '--disable-gpu', '--no-sandbox', '--no-proxy-server',
          '--disable-dev-shm-usage', '--hide-scrollbars',
          `--screenshot=${shot}`, `--window-size=${width},${HEIGHT}`,
          '--virtual-time-budget=8000', '--timeout=15000',
          '--run-all-compositor-stages-before-draw', url,
        ]);
        assert.equal(shotRun.status, 0, `screenshot failed for ${scenario.name}@${width}: status=${shotRun.status} signal=${shotRun.signal} stderr=${(shotRun.stderr || '').slice(-500)}`);
        assert.ok(fs.existsSync(shot), `missing screenshot ${shot}`);
        const domRun = await runChrome([
          '--headless', '--disable-gpu', '--no-sandbox', '--no-proxy-server',
          '--disable-dev-shm-usage',
          '--dump-dom', `--window-size=${width},${HEIGHT}`,
          '--virtual-time-budget=8000', '--timeout=15000', url,
        ]);
        assert.equal(domRun.status, 0, `dump-dom failed for ${scenario.name}@${width}: status=${domRun.status} signal=${domRun.signal} stderr=${(domRun.stderr || '').slice(-500)} stdout_len=${(domRun.stdout || '').length}`);
        const dom = domRun.stdout || '';
        const overflow = /data-overflow="YES"/.test(dom);
        const scrollW = (dom.match(/data-scrollw="(\d+)"/) || [])[1] || '?';
        console.log(`${scenario.name}@${width}px overflow=${overflow ? 'YES' : 'NO'} scrollWidth=${scrollW} innerWidth=${width} -> ${path.basename(shot)}`);
        if (overflow) failures.push(`${scenario.name}@${width}px scrollWidth=${scrollW}`);
      }
    }
  } finally {
    server.close();
  }
  if (failures.length) {
    console.error(`\nOVERFLOW FAILURES:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`\nAll ${SCENARIOS.length * WIDTHS.length} fixture shots written to ${outDir}, no page-level horizontal overflow.`);
})().catch((error) => { console.error(error); process.exit(1); });
