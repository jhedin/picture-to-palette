import { describe, it, expect } from "vitest";
import { ragMerge } from "./rag-merge";
import type { Point3 } from "./mean-shift";

// Helper: build a labels array and points array for a simple 4×4 image.
// segmentMap is a 2D array (row-major) of segment IDs.
function buildLabels(segmentMap: number[][]): Int32Array {
  const H = segmentMap.length;
  const W = segmentMap[0].length;
  const labels = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      labels[y * W + x] = segmentMap[y][x];
    }
  }
  return labels;
}

describe("ragMerge", () => {
  /**
   * 4×4 image with 4 segments, all very similar colors.
   * Segments:
   *   0 0 1 1
   *   0 0 1 1
   *   2 2 3 3
   *   2 2 3 3
   *
   * Colors are all nearly identical OKLab values → should all merge into 1.
   */
  it("merges similar adjacent segments down correctly", () => {
    const W = 4, H = 4;
    const segmentMap = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const labels = buildLabels(segmentMap);

    // Nearly identical light-gray OKLab colors
    const points: Point3[] = [
      [0.80, 0.001, 0.001],
      [0.81, 0.001, 0.001],
      [0.80, 0.002, 0.001],
      [0.81, 0.002, 0.001],
    ];

    const threshold = 0.05; // easily covers the ~0.01 distance between these
    const { labels: newLabels, points: newPoints } = ragMerge(labels, points, W, H, threshold);

    // All 4 should merge into 1
    expect(newPoints.length).toBe(1);

    // All pixel labels should be the same value
    const firstLabel = newLabels[0];
    expect([...newLabels].every((l) => l === firstLabel)).toBe(true);

    // Label must be in range [0, numSegments-1]
    expect(firstLabel).toBeGreaterThanOrEqual(0);
    expect(firstLabel).toBeLessThanOrEqual(newPoints.length - 1);
  });

  /**
   * 4×4 image with 2 color halves (left = near-black, right = near-white).
   * A low merge threshold should NOT merge them.
   *
   *   0 0 1 1
   *   0 0 1 1
   *   0 0 1 1
   *   0 0 1 1
   */
  it("does NOT merge very different color halves with a low threshold", () => {
    const W = 4, H = 4;
    const segmentMap = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 1],
    ];
    const labels = buildLabels(segmentMap);

    // Near-black vs near-white in OKLab: distance ≈ 0.98
    const points: Point3[] = [
      [0.05, 0.0, 0.0],
      [0.95, 0.0, 0.0],
    ];

    const threshold = 0.05; // much less than 0.90 distance
    const { labels: newLabels, points: newPoints } = ragMerge(labels, points, W, H, threshold);

    // Should still have 2 segments
    expect(newPoints.length).toBe(2);

    // Left pixels should have a different label than right pixels
    const leftLabel = newLabels[0];  // pixel (0,0)
    const rightLabel = newLabels[2]; // pixel (0,2)
    expect(leftLabel).not.toBe(rightLabel);
  });

  /**
   * Total pixel count is preserved after merge.
   */
  it("preserves total pixel count after merge", () => {
    const W = 4, H = 4;
    const N = W * H;
    const segmentMap = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const labels = buildLabels(segmentMap);

    const points: Point3[] = [
      [0.50, 0.01, 0.01],
      [0.52, 0.01, 0.01],
      [0.51, 0.01, 0.01],
      [0.53, 0.01, 0.01],
    ];

    const { labels: newLabels } = ragMerge(labels, points, W, H, 0.10);

    // Every pixel should still have a valid label (none missing)
    expect(newLabels.length).toBe(N);

    // Count pixels per new segment — total must equal N
    const counts = new Map<number, number>();
    for (const l of newLabels) {
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(N);
  });

  /**
   * All labels in result are in range [0, numSegments-1].
   */
  it("produces labels in range [0, numSegments-1]", () => {
    const W = 4, H = 4;
    const segmentMap = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const labels = buildLabels(segmentMap);

    const points: Point3[] = [
      [0.60, 0.00, 0.00],
      [0.61, 0.00, 0.00],
      [0.20, 0.10, 0.05],  // noticeably different
      [0.21, 0.10, 0.05],
    ];

    const threshold = 0.05;
    const { labels: newLabels, points: newPoints } = ragMerge(labels, points, W, H, threshold);

    const numSeg = newPoints.length;
    for (const l of newLabels) {
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(numSeg - 1);
    }
  });

  /**
   * targetSegments cap: even if threshold is large, stop once we reach
   * the target number of segments.
   */
  it("respects targetSegments cap and stops early", () => {
    const W = 4, H = 4;
    const segmentMap = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const labels = buildLabels(segmentMap);

    // All very similar — would normally merge into 1
    const points: Point3[] = [
      [0.80, 0.001, 0.001],
      [0.81, 0.001, 0.001],
      [0.80, 0.002, 0.001],
      [0.81, 0.002, 0.001],
    ];

    // High threshold would merge all, but targetSegments=2 should stop at 2
    const { points: newPoints } = ragMerge(labels, points, W, H, 1.0, 2);
    expect(newPoints.length).toBe(2);
  });

  /**
   * When threshold is 0 nothing should merge (all distances > 0 unless
   * identical colors, which shouldn't happen between distinct segments).
   */
  it("merges nothing when threshold is 0", () => {
    const W = 4, H = 4;
    const segmentMap = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const labels = buildLabels(segmentMap);

    const points: Point3[] = [
      [0.80, 0.001, 0.001],
      [0.81, 0.002, 0.003],
      [0.50, 0.100, 0.050],
      [0.60, 0.050, 0.020],
    ];

    const { points: newPoints } = ragMerge(labels, points, W, H, 0);
    // No merges; all 4 segments remain
    expect(newPoints.length).toBe(4);
  });
});
