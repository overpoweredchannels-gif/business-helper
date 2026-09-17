import { build } from "esbuild";
import http from "node:http";
import { readdirSync, readFileSync } from "node:fs";
const fixture = ["entry-navigation", "meeting-followup", "tutorial-barcode", "setup-import", "historical-import", "retail-pos"].includes(process.env.TRADEOS_FIXTURE_NAME) ? process.env.TRADEOS_FIXTURE_NAME : "sales-access";
const bundle = await build({ entryPoints: [new URL(`./fixtures/${fixture}.tsx`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://fixture.supabase.co"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"fixture-public-key"' } });
const stylesDirectory = new URL("../.next/static/chunks/", import.meta.url);
const css = ["tutorial-barcode", "setup-import", "historical-import", "retail-pos"].includes(fixture) ? readdirSync(stylesDirectory).filter(name => name.endsWith(".css")).map(name => readFileSync(new URL(name, stylesDirectory), "utf8")).join("\n").replace(/@font-face\{[^}]*\}/g, "") : "";
http.createServer((request, response) => {
  if (fixture === "historical-import" && request.url.startsWith("/api/import-export/")) {
    response.setHeader("Content-Type","application/json");
    if (request.url.startsWith("/api/import-export/templates")) response.end(JSON.stringify({ok:true,templates:[]}));
    else if (request.url.startsWith("/api/import-export/history")) {
      const params=new URL(request.url,"http://localhost").searchParams;
      const kinds=["sale","purchase","customer_payment","supplier_payment"];
      const records=kinds.filter(kind=>!params.get("kind")||kind===params.get("kind")).map((kind,index)=>({id:String(index),kind,record_number:`TEST-${index+1}`,party_name:kind.includes("supplier")||kind==="purchase"?"Test supplier":"Test customer",record_date:"2025-01-01",total_amount:40,source_system:"Legacy",source_file:"sample.csv",cutover_date:"2026-09-18",payload:{paid_amount:null,lines:kind.includes("payment")?[]:[{product_name:"Test product",quantity:2,unit_mode:"main",unit_price:20,bonus:0,discount:0,source_row:2}]}}));
      response.end(JSON.stringify({records,count:records.length}));
    } else if(request.url==="/api/import-export/import") {
      let raw="";request.on("data",chunk=>raw+=chunk);request.on("end",()=>{
        if(raw.includes('name="mode"\r\n\r\nrun')) response.end(JSON.stringify({ok:true,result:{created:2,updated:0,failed:0,skipped:0,failures:[]}}));
        else response.end(JSON.stringify({ok:true,preview:{fileColumns:["invoice_number","customer","sale_date","line_product"],rows:[2,3].map(rowIndex=>({rowIndex,values:{invoice_number:"S-1",customer:"Test customer",sale_date:"2025-01-01",line_product:"Test product",line_quantity:1,line_price:20},raw:{},errors:[],warnings:["Two source lines retained in one historical invoice; stock unchanged."],status:"new"})),stats:{totalRows:2,newCount:2,updateCount:0,skipCount:0,errorCount:0,warningCount:2},errorRows:[]}}));
      });
    } else response.end(JSON.stringify({ok:true}));
    return;
  }
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
