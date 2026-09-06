// Component fixtures exercise the actual shared layouts without bypassing production authentication.
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
  const output = path.join(__dirname, 'test-results', 'responsive');
  fs.mkdirSync(output, { recursive: true });
  const bundle = await build({ entryPoints: [path.join(__dirname,'fixtures/responsive.tsx')], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV':'"development"' },
    plugins: [{ name: 'fixture-boundaries', setup(b) {
      b.onResolve({filter: /^next\/(link|navigation)$/}, args => ({path:args.path,namespace:'fixture'}));
      b.onResolve({filter: /lib\/supabase\/client$/}, () => ({path:'supabase',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'}, args => ({loader:'js',contents:args.path==='next/navigation'
        ? 'export const usePathname=()=>"/salesman";export const useRouter=()=>({push:(url)=>location.assign(url)});'
        : args.path==='supabase' ? 'export const supabase={auth:{signOut:async()=>{}}};'
        : 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children);}',resolveDir:root}));
    }}] });
  const css = await postcss([tailwind({base:root})]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')});
  const server = http.createServer((req,res) => {
    if(req.url.startsWith('/bundle.js')) {res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
    else if(req.url.startsWith('/styles.css')) {res.setHeader('Content-Type','text/css');res.end(css.css);}
    else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true});
  try {
    for(const role of ['owner','employee','manager','supervisor']) {
      for(const width of [320,360,390,768,1440]) {
        const page=await browser.newPage({viewport:{width,height:850}});
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/?role=${role}`);
        await page.getByRole('heading',{name:'dashboard',exact:true}).waitFor();
        const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
        assert.ok(fits,`${role} layout must fit ${width}px without horizontal page scrolling`);
        if(width<1024) {
          await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();
          await page.getByRole('dialog',{name:'Navigation menu'}).waitFor();
          await page.getByRole('button',{name:'Close navigation menu'}).click();
          assert.equal(await page.getByRole('dialog').isVisible(),false);
          await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();
          await page.keyboard.press('Escape');
          assert.equal(await page.getByRole('dialog').isVisible(),false);
          if(role==='owner') {
            await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();
            await page.getByRole('dialog').getByRole('button',{name:'Products',exact:true}).click();
            await page.getByRole('heading',{name:'products',exact:true}).waitFor();
            assert.equal(await page.getByRole('dialog').isVisible(),false);
            await page.getByRole('button',{name:'Notifications',exact:true}).click();
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
          }
        }
        if(width===390 || width===1440) await page.screenshot({path:path.join(output,`${role}-${width}.png`),fullPage:true});
        assert.deepEqual(errors,[],`${role} runtime errors`);
        await page.close();
        console.log(`PASS ${role} ${width}px: viewport, navigation, Escape, runtime`);
      }
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
