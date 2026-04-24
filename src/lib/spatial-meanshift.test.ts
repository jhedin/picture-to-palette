import { describe, it, expect } from "vitest";
import { spatialMeanShift } from "./spatial-meanshift";

/** Build a W×H image where the left half is one solid color and the right half another. */
function twoHalves(W: number, H: number, colorA: [number, number, number], colorB: [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b] = x < W / 2 ? colorA : colorB;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return new ImageData(data, W, H);
}

/** Build a W×H uniform solid-color image. */
function uniform(W: number, H: number, r: number, g: number, b: number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return new ImageData(data, W, H);
}

describe("spatialMeanShift", () => {
  it("labels array length equals W × H", () => {
    const W = 16, H = 16;
    const img = twoHalves(W, H, [255, 0, 0], [0, 0, 255]);
    const { labels } = spatialMeanShift(img, { spatialBandwidth: 4, colorBandwidth: 0.15, minRegionSize: 4 });
    expect(labels.length).toBe(W * H);
  });

  it("all pixel labels are valid indices into points array", () => {
    const W = 16, H = 16;
    const img = twoHalves(W, H, [255, 0, 0], [0, 0, 255]);
    const { labels, points } = spatialMeanShift(img, { spatialBandwidth: 4, colorBandwidth: 0.15, minRegionSize: 4 });
    for (let i = 0; i < labels.length; i++) {
      expect(labels[i]).toBeGreaterThanOrEqual(0);
      expect(labels[i]).toBeLessThan(points.length);
    }
  });

  it("two distinct color halves produce at most 3 segments", () => {
    const W = 16, H = 16;
    // Well-separated colors (red vs blue in OKLab)
    const img = twoHalves(W, H, [255, 0, 0], [0, 0, 255]);
    const { points } = spatialMeanShift(img, {
      spatialBandwidth: 4,
      colorBandwidth: 0.15,
      minRegionSize: 4,
    });
    expect(points.length).toBeGreaterThanOrEqual(1);
    expect(points.length).toBeLessThanOrEqual(3);
  });

  it("uniform-color image produces exactly 1 segment", () => {
    const W = 16, H = 16;
    const img = uniform(W, H, 128, 80, 40);
    const { points } = spatialMeanShift(img, {
      spatialBandwidth: 8,
      colorBandwidth: 0.15,
      minRegionSize: 1,
    });
    expect(points.length).toBe(1);
  });

  it("no segment index in points is out of range relative to labels", () => {
    const W = 16, H = 16;
    const img = twoHalves(W, H, [200, 100, 50], [50, 100, 200]);
    const { labels, points } = spatialMeanShift(img, { spatialBandwidth: 4, colorBandwidth: 0.15, minRegionSize: 4 });
    const maxLabel = Math.max(...Array.from(labels));
    expect(maxLabel).toBeLessThan(points.length);
  });

  it("handles a 1×1 image without throwing", () => {
    const img = uniform(1, 1, 255, 128, 0);
    const { points, labels, backgroundLabels } = spatialMeanShift(img);
    expect(labels.length).toBe(1);
    expect(points.length).toBeGreaterThanOrEqual(1);
    expect(backgroundLabels).toBeInstanceOf(Set);
  });
});
