/**
 * Runs all segmentation methods against yarn-cubbies.jpg and saves debug PNGs.
 * Run with: npx tsx scripts/compare-segmentation.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { extractPalette, type SegmentMethod } from "../src/lib/mean-shift.worker";

// Minimal ImageData polyfill for Node
class ImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace: "srgb" = "srgb";
  constructor(data: Uint8ClampedArray, width: number, _height?: number) {
    this.data = data; this.width = width;
    this.height = _height ?? data.length / 4 / width;
  }
}
(globalThis as unknown as Record<string, unknown>).ImageData = ImageData;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "../public/fixtures");
const OUT = resolve(__dirname, "../segmentation-compare");
mkdirSync(OUT, { recursive: true });

function loadJpeg(name: string): ImageData {
  const buf = readFileSync(resolve(FIXTURES, name));
  const { width, height, data } = jpeg.decode(buf, { useTArray: true });
  return new ImageData(new Uint8ClampedArray(data), width, height);
}

function savePng(segPixels: Uint8ClampedArray, w: number, h: number, name: string) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h * 4; i++) png.data[i] = segPixels[i];
  const buf = PNG.sync.write(png);
  const out = resolve(OUT, name);
  writeFileSync(out, buf);
  console.log(`  saved ${out}`);
}

const METHODS: Array<{ method: SegmentMethod; label: string; opts?: object }> = [
  { method: "slic",              label: "1-slic" },
  { method: "slic",              label: "1-slic-rag0.10",     opts: { ragMergeThreshold: 0.10 } },
  { method: "felzenszwalb",      label: "2-felzenszwalb-k500" },
  { method: "felzenszwalb",      label: "2-felzenszwalb-k200", opts: { fhK: 200, fhMinSize: 200 } },
  { method: "spatial-meanshift", label: "3-spatial-meanshift" },
  { method: "spatial-meanshift", label: "3-spatial-meanshift-wide", opts: { spatialBandwidth: 32, colorBandwidth: 0.18 } },
  { method: "spatial-kmeans",    label: "4-spatial-kmeans-k20" },
  { method: "spatial-kmeans",    label: "4-spatial-kmeans-k10", opts: { kmeansK: 10 } },
];

const image = loadJpeg("yarn-cubbies.jpg");
console.log(`Image: ${image.width}×${image.height}`);
console.log(`Output dir: ${OUT}\n`);

for (const { method, label, opts } of METHODS) {
  process.stdout.write(`Running ${label}… `);
  const t0 = Date.now();
  const result = await extractPalette(image, undefined, { segmentMethod: method, ...opts });
  const ms = Date.now() - t0;
  const { segPixels, segWidth, segHeight } = result.debug;
  console.log(`${ms}ms — ${result.hexes.length} colors: ${result.hexes.join(" ")}`);
  savePng(segPixels, segWidth, segHeight, `${label}.png`);
}

console.log("\nDone. Open the PNG files in segmentation-compare/ to compare.");
