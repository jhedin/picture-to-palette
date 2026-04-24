/**
 * Validate all DMC fixture images after preprocessing.
 *
 * For each image in public/fixtures/dmc/ this script:
 *   1. Loads the image (JPEG or PNG)
 *   2. Runs extractPalette
 *   3. Maps to DMC threads
 *   4. Computes paletteQuality metrics
 *   5. Reports results and exits non-zero if any fixture is degenerate
 *
 * Usage:
 *   npm run check-fixtures
 *   # or directly:
 *   ./node_modules/.bin/vite-node scripts/check-fixtures.ts
 */
// ImageData is a browser API; polyfill it for Node.js.
if (typeof globalThis.ImageData === "undefined") {
  // Minimal implementation that satisfies the extractPalette contract.
  (globalThis as Record<string, unknown>).ImageData = class ImageData {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data;
      this.width = width;
      this.height = height ?? data.length / 4 / width;
    }
  };
}

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import jpeg from "jpeg-js";
import { extractPalette } from "../src/lib/mean-shift.worker";
import { matchToDmc } from "../src/lib/dmc-match";
import { paletteQuality } from "../src/lib/color";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "../public/fixtures/dmc");

function loadImage(filePath: string): ImageData {
  const buf = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    const { width, height, data } = jpeg.decode(buf, { useTArray: true });
    return new ImageData(new Uint8ClampedArray(data), width, height);
  } else if (ext === ".png") {
    const png = PNG.sync.read(buf);
    const rgba = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
    return new ImageData(rgba, png.width, png.height);
  }
  throw new Error(`Unsupported format: ${ext}`);
}

const files = readdirSync(FIXTURES_DIR)
  .filter((f) => /\.(jpe?g|png)$/i.test(f))
  .sort();

if (files.length === 0) {
  console.error(`No fixture images found in ${FIXTURES_DIR}`);
  process.exit(1);
}

let anyDegenerate = false;

console.log(`\nChecking ${files.length} fixture(s) in ${FIXTURES_DIR}\n`);
console.log(
  "  file".padEnd(25) +
  "colors".padStart(7) +
  "chromaMax".padStart(11) +
  "lRange".padStart(8) +
  "hueSpread".padStart(11) +
  "  status"
);
console.log("  " + "-".repeat(65));

for (const file of files) {
  const img = loadImage(resolve(FIXTURES_DIR, file));
  const { hexes } = extractPalette(img);
  const dmc = matchToDmc(hexes);
  const dmcHexes = dmc.map((c) => c.hex);
  const q = paletteQuality(dmcHexes);

  const status = q.isDegenerate ? "DEGENERATE ✗" : "ok ✓";
  if (q.isDegenerate) anyDegenerate = true;

  console.log(
    "  " + file.padEnd(23) +
    String(q.distinctCount).padStart(7) +
    q.chromaMax.toFixed(3).padStart(11) +
    q.lRange.toFixed(3).padStart(8) +
    q.hueSpread.toFixed(3).padStart(11) +
    "  " + status
  );
}

console.log();

if (anyDegenerate) {
  console.error("One or more fixtures have degenerate palettes. Re-export or replace them.");
  process.exit(1);
} else {
  console.log("All fixtures passed quality check.");
}
