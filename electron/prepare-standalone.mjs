// Copies .next/static and public/ into .next/standalone, which the Next.js
// standalone server needs at runtime (the trace does not include them).
// Run after `next build`, before electron-builder (see desktop:build).
import { cp } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const standalone = path.join(root, ".next", "standalone");

await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), {
  recursive: true,
});
await cp(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
});

console.log("Standalone assets copied: .next/static + public/ -> .next/standalone");
