import { build } from "esbuild";
import http from "node:http";
const fixture = process.env.TRADEOS_FIXTURE_NAME === "entry-navigation" ? "entry-navigation" : "sales-access";
const bundle = await build({ entryPoints: [new URL(`./fixtures/${fixture}.tsx`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://fixture.supabase.co"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"fixture-public-key"' } });
http.createServer((request, response) => {
  if (request.url.startsWith("/bundle.js")) { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
  else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
}).listen(Number(process.env.TRADEOS_FIXTURE_PORT || 4319), "127.0.0.1", () => console.log(`Sales access fixture: http://127.0.0.1:${process.env.TRADEOS_FIXTURE_PORT || 4319}`));
