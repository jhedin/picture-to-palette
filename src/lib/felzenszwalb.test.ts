import { describe, it, expect } from "vitest";
import { felzenszwalb } from "./felzenszwalb";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build an ImageData from a flat RGB spec (no alpha needed — filled to 255). */
function makeImageData(width: number, height: number, rgbFn: (x: number, y: number) => [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b] = rgbFn(x, y);
      data[idx]     = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("felzenszwalb", () => {
  it("labels array length equals width × height", () => {
    const W = 8, H = 6;
    const img = makeImageData(W, H, () => [128, 64, 32]);
    const { labels } = felzenszwalb(img, 0.5, 500, 1);
    expect(labels.length).toBe(W * H);
  });

  it("uniform-color image produces exactly 1 segment", () => {
    // Every pixel is identical → all edges have weight 0 → everything merges.
    const img = makeImageData(8, 8, () => [200, 100, 50]);
    const { points, labels } = felzenszwalb(img, 0.5, 500, 1);
    expect(points.length).toBe(1);
    const uniq = new Set(Array.from(labels));
    expect(uniq.size).toBe(1);
  });

  it("4×4 image with two distinct color halves produces exactly 2 segments", () => {
    // Left 2 columns: red-ish;  right 2 columns: blue-ish.
    // With k=50 and minSize=1, the FH algorithm keeps them separate because
    // the cross-edge weight is large while internal edges are 0.
    const img = makeImageData(4, 4, (x) => x < 2 ? [220, 30, 30] : [30, 30, 220]);
    const { points, labels } = felzenszwalb(img, 0.5, 50, 1);
    expect(points.length).toBe(2);
    const uniq = new Set(Array.from(labels));
    expect(uniq.size).toBe(2);
    // All left-half pixels must have the same label
    const leftLabel  = labels[0];
    const rightLabel = labels[2];
    expect(leftLabel).not.toBe(rightLabel);
    for (let y = 0; y < 4; y++) {
      expect(labels[y * 4 + 0]).toBe(leftLabel);
      expect(labels[y * 4 + 1]).toBe(leftLabel);
      expect(labels[y * 4 + 2]).toBe(rightLabel);
      expect(labels[y * 4 + 3]).toBe(rightLabel);
    }
  });

  it("small segments below minSize get merged into neighbors", () => {
    // 6×1 image: 5 red pixels then 1 blue pixel.
    // With minSize=3, the lone blue pixel (size 1) must merge into the red region.
    const img = makeImageData(6, 1, (x) => x < 5 ? [220, 30, 30] : [30, 30, 220]);
    const { points, labels } = felzenszwalb(img, 0.5, 500, 3);
    // After min-size enforcement, only 1 component remains.
    expect(points.length).toBe(1);
    const uniq = new Set(Array.from(labels));
    expect(uniq.size).toBe(1);
  });

  it("returns correct points array length matching unique labels", () => {
    // 4×2 checkerboard of two very different colors
    const img = makeImageData(4, 2, (x, y) =>
      (x + y) % 2 === 0 ? [250, 10, 10] : [10, 10, 250],
    );
    const { points, labels } = felzenszwalb(img, 0.5, 500, 1);
    const numUniqueLabels = new Set(Array.from(labels)).size;
    expect(points.length).toBe(numUniqueLabels);
  });

  it("returns weights array with one entry per segment summing to N", () => {
    const W = 5, H = 5;
    const img = makeImageData(W, H, (x) => x < 3 ? [200, 10, 10] : [10, 10, 200]);
    const { weights, points } = felzenszwalb(img, 0.5, 500, 1);
    expect(weights.length).toBe(points.length);
    const total = weights.reduce((s, w) => s + w, 0);
    expect(total).toBe(W * H);
  });

  it("backgroundLabels marks corner-touching segments", () => {
    // 8×8 image: large red block surrounded by blue border pixels.
    // The blue border wraps all four corners → should be background.
    const img = makeImageData(8, 8, (x, y) => {
      const onBorder = x === 0 || x === 7 || y === 0 || y === 7;
      return onBorder ? [10, 10, 200] : [200, 10, 10];
    });
    const { labels, backgroundLabels } = felzenszwalb(img, 0.5, 50, 1);
    // The corner pixel labels should all be background
    const corners = [labels[0], labels[7], labels[56], labels[63]];
    for (const lbl of corners) {
      expect(backgroundLabels.has(lbl)).toBe(true);
    }
    // The center pixel should NOT be background
    const center = labels[4 * 8 + 4];
    expect(backgroundLabels.has(center)).toBe(false);
  });
});
