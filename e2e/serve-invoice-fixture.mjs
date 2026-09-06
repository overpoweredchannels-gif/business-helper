import { build } from "esbuild";
import http from "node:http";
const bundle = await build({ entryPoints: [new URL("./fixtures/invoice-keyboard.tsx", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" });
http.createServer((request, response) => {
  if (request.url.startsWith("/bundle.js")) { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
  else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
}).listen(4318, "127.0.0.1", () => console.log("Invoice keyboard fixture: http://127.0.0.1:4318"));
