// Generate electron/assets/aankh.ico from public/aankh-app-eye.png.
//
// The desktop installer + taskbar + window show the Electron default
// icon without a win.icon — this builds a multi-size ICO (16/32/48/256,
// PNG-in-ICO) from the Aankh eye logo. The eye is NEVER recoloured or
// redrawn here; sharp only resizes the source PNG.
//
// Run: node scripts/generate-desktop-icon.mjs
// Requires sharp (ships with next) — present after `npm ci`.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "public", "aankh-app-eye.png");
const outputPath = path.join(root, "electron", "assets", "aankh.ico");
const SIZES = [16, 32, 48, 256];

function buildIco(images) {
  const headerSize = 6 + images.length * 16;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  for (const [index, image] of images.entries()) {
    const entry = Buffer.alloc(16);
    // A width/height byte of 0 means 256 in the ICO format.
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2); // palette colours (0 = none)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.png.length;
    header.set(entry, 6 + index * 16);
  }
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

async function main() {
  const source = sharp(sourcePath);
  const metadata = await source.metadata();
  if (metadata.width !== 512 || metadata.height !== 512) {
    throw new Error(`expected the 512x512 eye logo, got ${metadata.width}x${metadata.height}`);
  }
  const images = [];
  for (const size of SIZES) {
    images.push({
      size,
      png: await sharp(sourcePath).resize(size, size).png().toBuffer(),
    });
  }
  const ico = buildIco(images);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, ico);
  // Self-check: parse the header back and confirm every entry.
  const check = fs.readFileSync(outputPath);
  const count = check.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, index) => {
    const width = check.readUInt8(6 + index * 16);
    return width === 0 ? 256 : width;
  });
  if (count !== SIZES.length || JSON.stringify(sizes) !== JSON.stringify(SIZES)) {
    throw new Error(`ICO self-check failed: got ${count} entries (${sizes.join(",")})`);
  }
  console.log(`wrote ${outputPath} (${ico.length} bytes, sizes ${sizes.join(", ")})`);
}

main().catch((error) => {
  console.error(`generate-desktop-icon: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
