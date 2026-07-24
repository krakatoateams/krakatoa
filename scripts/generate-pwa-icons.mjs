/**
 * Generate favicon + PWA icons from public/Logo White transparent.svg
 * Run: node scripts/generate-pwa-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SVG_PATH = path.join(ROOT, "public/Logo White transparent.svg");
const BG = { r: 10, g: 10, b: 10, alpha: 1 }; // --ink #0a0a0a

const PUBLIC_ICONS = path.join(ROOT, "public/icons");
const APP_DIR = path.join(ROOT, "app");

async function renderIcon(size, { padding = 0.18, maskable = false } = {}) {
  const inner = maskable ? Math.round(size * 0.52) : Math.round(size * (1 - padding * 2));
  const logo = await sharp(SVG_PATH)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png();
}

async function writePng(pipeline, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline.toFile(dest);
}

async function main() {
  const sizes = [
    { name: "icon-16.png", size: 16 },
    { name: "icon-32.png", size: 32 },
    { name: "icon-48.png", size: 48 },
    { name: "icon-72.png", size: 72 },
    { name: "icon-96.png", size: 96 },
    { name: "icon-128.png", size: 128 },
    { name: "icon-144.png", size: 144 },
    { name: "icon-152.png", size: 152 },
    { name: "icon-192.png", size: 192 },
    { name: "icon-384.png", size: 384 },
    { name: "icon-512.png", size: 512 },
    { name: "apple-touch-icon.png", size: 180, padding: 0.16 },
    { name: "maskable-icon-512.png", size: 512, maskable: true },
  ];

  for (const { name, size, padding, maskable } of sizes) {
    const pipeline = await renderIcon(size, { padding, maskable });
    await writePng(pipeline, path.join(PUBLIC_ICONS, name));
    console.log(`wrote public/icons/${name}`);
  }

  const favicon32 = await renderIcon(32);
  const favicon16 = await renderIcon(16);
  const ico = await pngToIco([
    await favicon16.toBuffer(),
    await favicon32.toBuffer(),
  ]);
  fs.writeFileSync(path.join(APP_DIR, "favicon.ico"), ico);
  console.log("wrote app/favicon.ico");

  await writePng(await renderIcon(32), path.join(APP_DIR, "icon.png"));
  console.log("wrote app/icon.png");

  await writePng(await renderIcon(180, { padding: 0.16 }), path.join(APP_DIR, "apple-icon.png"));
  console.log("wrote app/apple-icon.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
