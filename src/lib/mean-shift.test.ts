import { describe, it, expect } from "vitest";
import { meanShift, estimateBandwidth, type Point3 } from "./mean-shift";

describe("estimateBandwidth", () => {
  it("returns a positive bandwidth for a non-degenerate sample", () => {
    const points: Point3[] = [
      [0, 0, 0],
      [10, 10, 10],
      [20, 20, 20],
      [5, 5, 5],
      [15, 15, 15],
    ];
    expect(estimateBandwidth(points, 0.3)).toBeGreaterThan(0);
  });
  it("returns a smaller bandwidth for tighter data", () => {
    const tight: Point3[] = Array.from({ length: 20 }, (_, i) => [i / 10, 0, 0]);
    const loose: Point3[] = Array.from({ length: 20 }, (_, i) => [i, 0, 0]);
    expect(estimateBandwidth(tight, 0.3)).toBeLessThan(
      estimateBandwidth(loose, 0.3),
    );
  });
});

describe("meanShift", () => {
  it("recovers 3 distinct cluster centers from 3 flat blobs", () => {
    const blobs: Point3[] = [];
    // 3 blobs each with 50 points around a center, jitter ±0.5
    const centers: Point3[] = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
    ];
    for (const c of centers) {
      for (let i = 0; i < 50; i++) {
        blobs.push([
          c[0] + Math.random() * 0.5,
          c[1] + Math.random() * 0.5,
          c[2] + Math.random() * 0.5,
        ]);
      }
    }
    const result = meanShift(blobs, { bandwidth: 2 });
    expect(result.length).toBe(3);
    // Each known center should be near at least one returned cluster
    for (const known of centers) {
      const nearest = result.reduce((best, c) => {
        const d = Math.hypot(c[0] - known[0], c[1] - known[1], c[2] - known[2]);
        return d < best.d ? { d, c } : best;
      }, { d: Infinity, c: [0, 0, 0] as Point3 });
      expect(nearest.d).toBeLessThan(1);
    }
  });
  it("returns a single cluster when all points are identical", () => {
    const points: Point3[] = Array.from({ length: 30 }, () => [5, 5, 5]);
    const result = meanShift(points, { bandwidth: 1 });
    expect(result.length).toBe(1);
    expect(result[0][0]).toBeCloseTo(5, 3);
  });
  it("returns an empty array for empty input", () => {
    expect(meanShift([], { bandwidth: 1 })).toEqual([]);
  });
  it("respects minBinFreq to skip sparse seeds", () => {
    const points: Point3[] = [
      ...Array.from({ length: 20 }, () => [0, 0, 0] as Point3),
      [50, 50, 50], // single outlier
    ];
    const result = meanShift(points, { bandwidth: 1, minBinFreq: 5 });
    expect(result.length).toBe(1);
  });
});
