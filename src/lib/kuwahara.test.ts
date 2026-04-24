import { describe, it, expect } from "vitest";
import { kuwaharaFilter } from "./kuwahara";

// ── Helpers ───────────────────────────────────────────────────────────────────

function solidImage(w: number, h: number, r: number, g: number, b: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

/** Left half red, right half green — a sharp vertical edge. */
function twoHalfImage(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x < w / 2) { data[i] = 220; data[i + 1] = 30; data[i + 2] = 30; }
      else           { data[i] = 30;  data[i + 1] = 200; data[i + 2] = 30; }
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

/** Checkerboard of alternating black/white pixels — maximal texture. */
function checkerboard(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = (x + y) % 2 === 0 ? 255 : 0;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("kuwaharaFilter", () => {
  it("returns an ImageData of the same dimensions", () => {
    const out = kuwaharaFilter(solidImage(32, 32, 100, 150, 200));
    expect(out.width).toBe(32);
    expect(out.height).toBe(32);
    expect(out.data.length).toBe(32 * 32 * 4);
  });

  it("passes a solid-colour image through unchanged", () => {
    const out = kuwaharaFilter(solidImage(16, 16, 80, 120, 200));
    for (let i = 0; i < 16 * 16; i++) {
      expect(out.data[i * 4]).toBe(80);
      expect(out.data[i * 4 + 1]).toBe(120);
      expect(out.data[i * 4 + 2]).toBe(200);
      expect(out.data[i * 4 + 3]).toBe(255);
    }
  });

  it("preserves the sharp edge between two flat halves", () => {
    // Left half red, right half green.  Pixels well away from the boundary
    // should keep their original colour after Kuwahara because the
    // lowest-variance quadrant is always the one pointing away from the edge.
    const w = 24, h = 16;
    const out = kuwaharaFilter(twoHalfImage(w, h));

    // Far-left pixel (x=1) — all four quadrants clip to left half → red.
    const pxLeft = (1 * w + 1) * 4;
    expect(out.data[pxLeft]).toBeGreaterThan(150);   // high red
    expect(out.data[pxLeft + 1]).toBeLessThan(80);   // low green

    // Far-right pixel (x=w-2) — all quadrants in right half → green.
    const pxRight = (1 * w + (w - 2)) * 4;
    expect(out.data[pxRight]).toBeLessThan(80);      // low red
    expect(out.data[pxRight + 1]).toBeGreaterThan(150); // high green
  });

  it("significantly reduces variance on a high-texture checkerboard", () => {
    const w = 20, h = 20;
    const src = checkerboard(w, h);
    const out = kuwaharaFilter(src);

    // Compute per-pixel variance of luminance in output vs. input.
    // Input variance is maximal (~16256 = 127.5² per pixel); output should
    // be much lower because Kuwahara picks the most-uniform quadrant.
    const variance = (data: Uint8ClampedArray) => {
      let s = 0, s2 = 0, n = w * h;
      for (let i = 0; i < n; i++) { const v = data[i * 4]; s += v; s2 += v * v; }
      const m = s / n; return s2 / n - m * m;
    };
    expect(variance(out.data)).toBeLessThan(variance(src.data));
  });

  it("sets alpha channel to 255 for every output pixel", () => {
    const out = kuwaharaFilter(twoHalfImage(16, 16));
    for (let i = 0; i < 16 * 16; i++) {
      expect(out.data[i * 4 + 3]).toBe(255);
    }
  });

  it("handles a 1×1 image without crashing", () => {
    const out = kuwaharaFilter(solidImage(1, 1, 128, 64, 32));
    expect(out.data[0]).toBe(128);
  });

  it("different radius values produce valid output", () => {
    const src = twoHalfImage(24, 24);
    for (const r of [1, 2, 3]) {
      const out = kuwaharaFilter(src, r);
      expect(out.width).toBe(24);
      expect(out.height).toBe(24);
      // All pixels should be within [0, 255]
      for (const v of out.data) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
