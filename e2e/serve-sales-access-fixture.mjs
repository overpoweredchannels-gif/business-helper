import { build } from "esbuild";
import http from "node:http";
import { readdirSync, readFileSync } from "node:fs";
const fixture = ["entry-navigation", "meeting-followup", "tutorial-barcode", "setup-import", "retail-pos"].includes(process.env.TRADEOS_FIXTURE_NAME) ? process.env.TRADEOS_FIXTURE_NAME : "sales-access";
const bundle = await build({ entryPoints: [new URL(`./fixtures/${fixture}.tsx`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://fixture.supabase.co"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"fixture-public-key"' } });
const stylesDirectory = new URL("../.next/static/chunks/", import.meta.url);
const css = ["tutorial-barcode", "setup-import", "retail-pos"].includes(fixture) ? readdirSync(stylesDirectory).filter(name => name.endsWith(".css")).map(name => readFileSync(new URL(name, stylesDirectory), "utf8")).join("\n").replace(/@font-face\{[^}]*\}/g, "") : "";
http.createServer((request, response) => {
  if (fixture === "setup-import" && request.url.startsWith("/api/data-quality")) {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "PATCH") {
      let body = ""; request.on("data", chunk => { body += chunk; });
      request.on("end", () => { const data = JSON.parse(body); setTimeout(() => response.end(JSON.stringify({ ok: true, requested: data.ids.length, updated: data.ids.length })), 1500); });
    } else response.end(JSON.stringify({ ok: true, options: {}, rows: Array.from({ length: 55 }, (_, index) => ({ id: String(index + 1), label: `Fixture product ${index + 1}`, missing: [{ key: "reorder_level", label: "Reorder level" }] })) }));
    return;
  }
  if (fixture === "setup-import" && request.url === "/api/import-export/import") {
    request.resume();
    setTimeout(() => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ ok: false, error: "Synthetic preview validation error" })); }, 3000);
    return;
  }
  if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
  else if (request.url.startsWith("/bundle.js")) { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
  else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
}).listen(Number(process.env.TRADEOS_FIXTURE_PORT || 4319), "127.0.0.1", () => console.log(`Sales access fixture: http://127.0.0.1:${process.env.TRADEOS_FIXTURE_PORT || 4319}`));
