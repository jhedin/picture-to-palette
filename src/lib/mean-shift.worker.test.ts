import { describe, it, expect } from "vitest";
import { extractPalette } from "./mean-shift.worker";

function buildSyntheticImageData(): ImageData {
  // 32x32 image, half pure red, half pure green, third pure blue stripe.
  const w = 32, h = 32;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (x < 11) {
        data[idx] = 255; data[idx + 1] = 0; data[idx + 2] = 0;
      } else if (x < 22) {
        data[idx] = 0; data[idx + 1] = 255; data[idx + 2] = 0;
      } else {
        data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 255;
      }
      data[idx + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

describe("extractPalette (worker payload function)", () => {
  it("extracts ~3 clusters from a 3-stripe image", () => {
    const { hexes } = extractPalette(buildSyntheticImageData());
    expect(hexes.length).toBeGreaterThanOrEqual(3);
    expect(hexes.length).toBeLessThanOrEqual(5);
    expect(hexes.every((hex) => /^#[0-9A-F]{6}$/.test(hex))).toBe(true);
  });
  it("returns hex strings normalized via normalizeHex", () => {
    const { hexes } = extractPalette(buildSyntheticImageData());
    for (const hex of hexes) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
  it("returns debug data with correct dimensions and cluster sizes", () => {
    const { debug, hexes } = extractPalette(buildSyntheticImageData());
    expect(debug.segWidth).toBeGreaterThan(0);
    expect(debug.segHeight).toBeGreaterThan(0);
    expect(debug.segPixels.length).toBe(debug.segWidth * debug.segHeight * 4);
    expect(debug.clusterSizes.length).toBe(hexes.length);
    expect(debug.bandwidth).toBeGreaterThan(0);
  });
});
