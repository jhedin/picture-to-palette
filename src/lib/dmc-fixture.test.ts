/**
 * Fixture-based end-to-end tests for the DMC pipeline:
 *   extractPalette → matchToDmc
 *
 * Each test loads a real nature photo, extracts the colour palette, maps it
 * to DMC thread colours, and asserts the expected colour families are present.
 * Tests use perceptual hue/lightness ranges, not exact thread numbers, so
 * minor algorithm changes don't break them without a genuine regression.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
// pngjs ships a CommonJS module; use createRequire for compatibility
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

import { describe, it, expect, beforeAll } from "vitest";
import { extractPalette } from "./mean-shift.worker";
import { matchToDmc } from "./dmc-match";
import { hexToOklab } from "./color";
import type { DmcColor } from "./dmc-colors";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "../../public/fixtures/dmc");

function loadJpeg(name: string): ImageData {
  const buf = readFileSync(resolve(FIXTURES, name));
  const { width, height, data } = jpeg.decode(buf, { useTArray: true });
  return new ImageData(new Uint8ClampedArray(data), width, height);
}

function loadPng(name: string): ImageData {
  const buf = readFileSync(resolve(FIXTURES, name));
  const png = PNG.sync.read(buf);
  // pngjs data is RGBA; convert to Uint8ClampedArray for ImageData
  const rgba = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
  return new ImageData(rgba, png.width, png.height);
}

/** OKLCH hue in degrees [0, 360) from OKLab a/b coords */
function hue(a: number, b: number): number {
  return (Math.atan2(b, a) * (180 / Math.PI) + 360) % 360;
}

function chroma(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

/** True if any DMC color falls in the hue range with sufficient chroma */
function dmcHasHue(
  colors: DmcColor[],
  minH: number,
  maxH: number,
  minChroma = 0.05,
): boolean {
  return colors.some((c) => {
    const { a, b } = hexToOklab(c.hex);
    if (chroma(a, b) < minChroma) return false;
    const h = hue(a, b);
    return minH <= maxH ? h >= minH && h <= maxH : h >= minH || h <= maxH;
  });
}

/** True if any DMC color is dark (L below threshold) */
function dmcHasDark(colors: DmcColor[], maxL = 0.3): boolean {
  return colors.some((c) => hexToOklab(c.hex).L < maxL);
}

/** True if any DMC color is light (L above threshold) */
function dmcHasLight(colors: DmcColor[], minL = 0.75): boolean {
  return colors.some((c) => hexToOklab(c.hex).L >= minL);
}

/** True if any DMC color is neutral (chroma below threshold) within a lightness band */
function dmcHasNeutral(
  colors: DmcColor[],
  minL: number,
  maxL: number,
  maxC = 0.07,
): boolean {
  return colors.some((c) => {
    const { L, a, b } = hexToOklab(c.hex);
    return chroma(a, b) <= maxC && L >= minL && L <= maxL;
  });
}

// ─── starling.jpg ─────────────────────────────────────────────────────────────
// European Starling on bare winter branches with red crabapple berries.
// Colors: iridescent black/teal body, buff/tan feather edges, yellow beak,
// red berries, pinkish-grey branches, white overcast background.
describe("starling.jpg", { timeout: 30_000 }, () => {
  let dmc: DmcColor[];
  beforeAll(() => {
    const { hexes } = extractPalette(loadJpeg("starling.jpg"));
    dmc = matchToDmc(hexes);
  });

  it("produces at least 3 distinct DMC threads", () => {
    expect(dmc.length).toBeGreaterThanOrEqual(3);
  });
  it("finds a dark/black thread for the iridescent body", () => {
    expect(dmcHasDark(dmc, 0.32)).toBe(true);
  });
  it("finds a light thread for the white/overcast background", () => {
    expect(dmcHasLight(dmc, 0.8)).toBe(true);
  });
  it("finds a warm buff/tan thread for feather edges (hue ~50–100°)", () => {
    expect(dmcHasHue(dmc, 50, 100, 0.03)).toBe(true);
  });
  it("finds a red thread for the crabapple berries (hue ~0–45°)", () => {
    expect(dmcHasHue(dmc, 0, 45, 0.08)).toBe(true);
  });
});

// ─── robin.jpg ────────────────────────────────────────────────────────────────
// American Robin standing on mulch ground.
// Colors: orange-red breast, dark grey/black head, brown wings,
// yellow beak, warm brown mulch/soil.
describe("robin.jpg", { timeout: 30_000 }, () => {
  let dmc: DmcColor[];
  beforeAll(() => {
    const { hexes } = extractPalette(loadJpeg("robin.jpg"));
    dmc = matchToDmc(hexes);
  });

  it("produces at least 3 distinct DMC threads", () => {
    expect(dmc.length).toBeGreaterThanOrEqual(3);
  });
  it("finds a dark thread for the head/back (L < 0.35)", () => {
    expect(dmcHasDark(dmc, 0.35)).toBe(true);
  });
  it("finds an orange-red thread for the breast (hue ~15–55°, high chroma)", () => {
    expect(dmcHasHue(dmc, 15, 55, 0.09)).toBe(true);
  });
  it("finds a warm brown thread for the mulch ground (hue ~35–80°)", () => {
    expect(dmcHasHue(dmc, 35, 80, 0.03)).toBe(true);
  });
});

// ─── mountain.png ─────────────────────────────────────────────────────────────
// Winter mountain landscape — snow-covered foreground, evergreen tree line,
// snow-capped peaks, bright blue sky. (Source: Instagram screenshot)
describe("mountain.png", { timeout: 30_000 }, () => {
  let dmc: DmcColor[];
  beforeAll(() => {
    const { hexes } = extractPalette(loadPng("mountain.png"));
    dmc = matchToDmc(hexes);
  });

  it("produces at least 2 distinct DMC threads", () => {
    expect(dmc.length).toBeGreaterThanOrEqual(2);
  });
  it("finds a light/white thread for the snow (L > 0.85)", () => {
    expect(dmcHasLight(dmc, 0.85)).toBe(true);
  });
  it("finds a blue thread for the sky (hue ~210–260°)", () => {
    expect(dmcHasHue(dmc, 210, 260, 0.04)).toBe(true);
  });
});

// ─── flicker.jpg ──────────────────────────────────────────────────────────────
// Northern Flicker (woodpecker) perched on a branch, showing back.
// Colors: brown/tan barred back, orange-red tail feathers, black markings,
// grey building wall background.
describe("flicker.jpg", { timeout: 30_000 }, () => {
  let dmc: DmcColor[];
  beforeAll(() => {
    const { hexes } = extractPalette(loadJpeg("flicker.jpg"));
    dmc = matchToDmc(hexes);
  });

  it("produces at least 3 distinct DMC threads", () => {
    expect(dmc.length).toBeGreaterThanOrEqual(3);
  });
  it("finds a warm brown thread for the barred back (hue ~35–75°)", () => {
    expect(dmcHasHue(dmc, 35, 75, 0.03)).toBe(true);
  });
  it("finds an orange thread for the tail feathers (hue ~20–60°, high chroma)", () => {
    expect(dmcHasHue(dmc, 20, 60, 0.08)).toBe(true);
  });
  it("finds a neutral grey/beige thread for the building background", () => {
    expect(dmcHasNeutral(dmc, 0.5, 0.85, 0.07)).toBe(true);
  });
});

// ─── magpie.jpg ───────────────────────────────────────────────────────────────
// Black-billed Magpie on leaf-covered ground.
// Colors: iridescent blue tail, black head/body, white belly/wing patches,
// warm brown dead leaves.
describe("magpie.jpg", { timeout: 30_000 }, () => {
  let dmc: DmcColor[];
  beforeAll(() => {
    const { hexes } = extractPalette(loadJpeg("magpie.jpg"));
    dmc = matchToDmc(hexes);
  });

  it("produces at least 3 distinct DMC threads", () => {
    expect(dmc.length).toBeGreaterThanOrEqual(3);
  });
  it("finds a dark/black thread for the body (L < 0.3)", () => {
    expect(dmcHasDark(dmc, 0.3)).toBe(true);
  });
  it("finds a blue thread for the iridescent tail (hue ~215–270°)", () => {
    expect(dmcHasHue(dmc, 215, 270, 0.06)).toBe(true);
  });
  it("finds a warm brown thread for the leaf litter (hue ~35–75°)", () => {
    expect(dmcHasHue(dmc, 35, 75, 0.03)).toBe(true);
  });
});

// ─── chickadee.png ────────────────────────────────────────────────────────────
// Black-capped Chickadee on a bird feeder in winter.
// Colors: black cap/bib, white cheeks, grey wings, buff belly, brown branches.
describe("chickadee.png", { timeout: 30_000 }, () => {
  let dmc: DmcColor[];
  beforeAll(() => {
    const { hexes } = extractPalette(loadPng("chickadee.png"));
    dmc = matchToDmc(hexes);
  });

  it("produces at least 2 distinct DMC threads", () => {
    expect(dmc.length).toBeGreaterThanOrEqual(2);
  });
  it("finds a dark/black thread for the cap (L < 0.3)", () => {
    expect(dmcHasDark(dmc, 0.3)).toBe(true);
  });
  it("finds a light/neutral thread for the white cheeks or snowy background", () => {
    expect(dmcHasLight(dmc, 0.8)).toBe(true);
  });
});

// ─── penguins.jpg ─────────────────────────────────────────────────────────────
// King Penguins walking on ice/ground.
// Colors: black back/head, white belly, yellow-orange neck patches, grey-blue ice.
describe("penguins.jpg", { timeout: 30_000 }, () => {
  let dmc: DmcColor[];
  beforeAll(() => {
    const { hexes } = extractPalette(loadJpeg("penguins.jpg"));
    dmc = matchToDmc(hexes);
  });

  it("produces at least 3 distinct DMC threads", () => {
    expect(dmc.length).toBeGreaterThanOrEqual(3);
  });
  it("finds a dark/black thread for the back/head (L < 0.3)", () => {
    expect(dmcHasDark(dmc, 0.3)).toBe(true);
  });
  it("finds a light thread for the white belly (L > 0.8)", () => {
    expect(dmcHasLight(dmc, 0.8)).toBe(true);
  });
  it("finds a cool blue-grey thread for the icy ground (hue ~210–250° or neutral)", () => {
    // The neck patches are too small at 128 px to survive downsampling;
    // the icy ground (~18% of pixels, cool blue-grey) is the third dominant color.
    const hasCoolHue = dmcHasHue(dmc, 210, 250, 0.03);
    const hasCoolNeutral = dmcHasNeutral(dmc, 0.35, 0.8, 0.07);
    expect(hasCoolHue || hasCoolNeutral).toBe(true);
  });
});

// ─── hummingbird.jpg ──────────────────────────────────────────────────────────
// Hummingbird hovering at a glass nectar feeder.
// Colors: iridescent green body, red feeder ports, blue-grey building siding,
// warm red-brown house siding in background.
describe("hummingbird.jpg", { timeout: 30_000 }, () => {
  let dmc: DmcColor[];
  beforeAll(() => {
    const { hexes } = extractPalette(loadJpeg("hummingbird.jpg"));
    dmc = matchToDmc(hexes);
  });

  it("produces at least 3 distinct DMC threads", () => {
    expect(dmc.length).toBeGreaterThanOrEqual(3);
  });
  it("finds a cool neutral/blue thread for the building (hue ~200–260° or low chroma)", () => {
    const hasCoolHue = dmcHasHue(dmc, 200, 260, 0.03);
    const hasCoolNeutral = dmcHasNeutral(dmc, 0.4, 0.85, 0.07);
    expect(hasCoolHue || hasCoolNeutral).toBe(true);
  });
  it("finds a red or warm thread for the feeder/siding (hue ~5–45°)", () => {
    expect(dmcHasHue(dmc, 5, 45, 0.06)).toBe(true);
  });
});
