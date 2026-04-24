import { describe, it, expect } from "vitest";
import { buildAdjacency, computeMBD } from "./mbd";
import type { Point3 } from "./mean-shift";

// ── buildAdjacency ────────────────────────────────────────────────────────────

describe("buildAdjacency", () => {
  it("returns an array of length numSeg", () => {
    const labels = new Int32Array([0, 1, 2, 3]);
    const adj = buildAdjacency(labels, 2, 2, 4);
    expect(adj.length).toBe(4);
  });

  it("connects horizontally adjacent different segments", () => {
    // 1×2 image: pixel 0 = seg 0, pixel 1 = seg 1
    const labels = new Int32Array([0, 1]);
    const adj = buildAdjacency(labels, 2, 1, 2);
    expect(adj[0].has(1)).toBe(true);
    expect(adj[1].has(0)).toBe(true);
  });

  it("connects vertically adjacent different segments", () => {
    // 2×1 image: pixel 0 = seg 0, pixel 1 = seg 1
    const labels = new Int32Array([0, 1]);
    const adj = buildAdjacency(labels, 1, 2, 2);
    expect(adj[0].has(1)).toBe(true);
    expect(adj[1].has(0)).toBe(true);
  });

  it("does not connect pixels in the same segment", () => {
    const labels = new Int32Array([0, 0, 0, 0]);
    const adj = buildAdjacency(labels, 2, 2, 1);
    expect(adj[0].size).toBe(0);
  });

  it("only records each neighbour pair once per segment (Set dedup)", () => {
    // 2×2 all-different: each corner segment has 2 neighbours
    const labels = new Int32Array([0, 1, 2, 3]);
    const adj = buildAdjacency(labels, 2, 2, 4);
    // 0↔1 (horizontal), 0↔2 (vertical), 1↔3 (vertical), 2↔3 (horizontal)
    expect(adj[0].has(1)).toBe(true);
    expect(adj[0].has(2)).toBe(true);
    expect(adj[0].size).toBe(2);
    expect(adj[3].has(1)).toBe(true);
    expect(adj[3].has(2)).toBe(true);
  });

  it("skips out-of-range label values (-1 and >= numSeg)", () => {
    const labels = new Int32Array([0, -1, 0, 99]);
    const adj = buildAdjacency(labels, 2, 2, 2);
    // only label 0 is valid; no valid adjacency pairs exist
    expect(adj[0].size).toBe(0);
    expect(adj[1].size).toBe(0);
  });

  it("handles a realistic 3-segment linear chain", () => {
    // 1×3: seg0 — seg1 — seg2
    const labels = new Int32Array([0, 1, 2]);
    const adj = buildAdjacency(labels, 3, 1, 3);
    expect(adj[0].has(1)).toBe(true);
    expect(adj[0].has(2)).toBe(false); // not directly adjacent
    expect(adj[1].has(0)).toBe(true);
    expect(adj[1].has(2)).toBe(true);
    expect(adj[2].has(1)).toBe(true);
    expect(adj[2].has(0)).toBe(false);
  });
});

// ── computeMBD ────────────────────────────────────────────────────────────────

describe("computeMBD", () => {
  it("returns a typed array of length numSeg", () => {
    const colors: Point3[] = [[0, 0, 0], [0, 0, 0]];
    const adj = [new Set([1]), new Set([0])];
    const dist = computeMBD(new Set([0]), adj, colors);
    expect(dist).toBeInstanceOf(Float64Array);
    expect(dist.length).toBe(2);
  });

  it("assigns 0 distance to seed nodes", () => {
    const colors: Point3[] = [[0, 0, 0], [1, 0, 0]];
    const adj = [new Set([1]), new Set([0])];
    const dist = computeMBD(new Set([0]), adj, colors);
    expect(dist[0]).toBe(0);
  });

  it("assigns Infinity to unreachable nodes", () => {
    // seg 2 is isolated — not connected to 0 or 1
    const colors: Point3[] = [[0, 0, 0], [1, 0, 0], [0.5, 0.5, 0.5]];
    const adj = [new Set([1]), new Set([0]), new Set<number>()];
    const dist = computeMBD(new Set([0]), adj, colors);
    expect(dist[2]).toBe(Infinity);
  });

  it("linear chain: barrier is the single-edge cost (max of one edge)", () => {
    // seg0 (seed) — seg1 — seg2
    // edge 0↔1: L diff=1, so cost=1
    // edge 1↔2: L diff=2, so cost=2
    // MBD to seg1 = max(0,1) = 1
    // MBD to seg2 = max(max(0,1), 2) = 2
    const colors: Point3[] = [[0, 0, 0], [1, 0, 0], [3, 0, 0]];
    const adj = [new Set([1]), new Set([0, 2]), new Set([1])];
    const dist = computeMBD(new Set([0]), adj, colors);
    expect(dist[0]).toBe(0);
    expect(dist[1]).toBeCloseTo(1, 5);
    expect(dist[2]).toBeCloseTo(2, 5);
  });

  it("minimax picks the path with smallest maximum edge, not shortest sum", () => {
    // Two paths from seed (0) to target (3):
    //   Path A: 0→1→3, edges: cost(0,1)=10, cost(1,3)=10  → barrier = max(10,10)=10
    //   Path B: 0→2→3, edges: cost(0,2)=3, cost(2,3)=3    → barrier = max(3,3)=3
    // MBD should choose Path B → dist[3]=3
    const colors: Point3[] = [
      [0, 0, 0],   // 0 (seed)
      [10, 0, 0],  // 1  (10 away from 0 and 3)
      [3, 0, 0],   // 2  (3 away from 0)
      [6, 0, 0],   // 3  (3 away from 2)
    ];
    const adj = [
      new Set([1, 2]),  // 0
      new Set([0, 3]),  // 1
      new Set([0, 3]),  // 2
      new Set([1, 2]),  // 3
    ];
    const dist = computeMBD(new Set([0]), adj, colors);
    // Path B max-edge = 3, so barrier = 3
    expect(dist[3]).toBeCloseTo(3, 5);
  });

  it("multiple seeds: each node gets the minimum barrier to its closest seed", () => {
    // Seeds: 0 and 4 at opposite ends of a linear chain of 5
    // chain: 0—1—2—3—4, each edge cost = 1 (uniform color)
    const colors: Point3[] = Array.from({ length: 5 }, (_, i) => [i, 0, 0] as Point3);
    const adj = Array.from({ length: 5 }, (_, i) => {
      const s = new Set<number>();
      if (i > 0) s.add(i - 1);
      if (i < 4) s.add(i + 1);
      return s;
    });
    const dist = computeMBD(new Set([0, 4]), adj, colors);
    // node 2 is equidistant: barrier via 0→1→2 = max(1,1)=1, via 4→3→2 = max(1,1)=1 → 1
    expect(dist[0]).toBe(0);
    expect(dist[4]).toBe(0);
    expect(dist[2]).toBeCloseTo(1, 5);
  });

  it("same-color chain has near-zero barrier (models uniform background gap)", () => {
    // This is the key background-detection scenario: a chain of same-color
    // segments between two border seeds should have MBD≈0.
    const color: Point3 = [0.7, -0.05, 0.08]; // OKLab "light yellow"
    const n = 10;
    const colors: Point3[] = Array.from({ length: n }, () => [...color] as Point3);
    const adj = Array.from({ length: n }, (_, i) => {
      const s = new Set<number>();
      if (i > 0) s.add(i - 1);
      if (i < n - 1) s.add(i + 1);
      return s;
    });
    // Seed both ends — models border segments on left and right
    const dist = computeMBD(new Set([0, n - 1]), adj, colors);
    // All internal nodes should have MBD ≈ 0 (same color, so edgeW ≈ 0)
    for (let i = 1; i < n - 1; i++) {
      expect(dist[i]).toBeCloseTo(0, 3);
    }
  });

  it("foreground ball scenario: interior node requires crossing a high-cost edge", () => {
    // Background seeds: 0, 1 (adjacent, same color, low cost path between them)
    // Foreground node 3 connects to the background only through high-cost edge 2→3
    // Layout: 0(seed)—1(seed)—2—3(foreground)
    // Colors:  yellow     yellow  yellow  red  (high contrast at 2↔3)
    const colors: Point3[] = [
      [0.7, -0.05, 0.1],   // 0 (seed, yellow)
      [0.7, -0.05, 0.1],   // 1 (seed, yellow)
      [0.7, -0.04, 0.1],   // 2 (yellow, near-identical)
      [0.5,  0.15, 0.0],   // 3 (foreground red-ish)
    ];
    const adj = [
      new Set([1]),        // 0
      new Set([0, 2]),     // 1
      new Set([1, 3]),     // 2
      new Set([2]),        // 3
    ];
    const dist = computeMBD(new Set([0, 1]), adj, colors);
    // Node 2 should have low MBD (same-color neighbour of seeds)
    expect(dist[2]).toBeLessThan(0.05);
    // Node 3 must cross the high-contrast edge — its MBD should be > 0.3
    const expectedEdgeCost = Math.sqrt(
      (0.7 - 0.5) ** 2 + (-0.04 - 0.15) ** 2 + (0.1 - 0.0) ** 2
    );
    expect(dist[3]).toBeCloseTo(expectedEdgeCost, 4);
    expect(dist[3]).toBeGreaterThan(0.2);
  });

  it("handles an empty seed set without crashing (all Infinity)", () => {
    const colors: Point3[] = [[0, 0, 0], [1, 0, 0]];
    const adj = [new Set([1]), new Set([0])];
    const dist = computeMBD(new Set<number>(), adj, colors);
    expect(dist[0]).toBe(Infinity);
    expect(dist[1]).toBe(Infinity);
  });

  it("handles out-of-range seed indices gracefully", () => {
    const colors: Point3[] = [[0, 0, 0]];
    const adj = [new Set<number>()];
    // seed index 99 is out of range — should be silently skipped
    expect(() => computeMBD(new Set([99]), adj, colors)).not.toThrow();
  });

  it("3D OKLab distance is computed correctly for diagonal color jump", () => {
    // seed=0, colors: 0=[0,0,0], 1=[0.3, 0.4, 0] → dist=sqrt(0.09+0.16)=0.5
    const colors: Point3[] = [[0, 0, 0], [0.3, 0.4, 0]];
    const adj = [new Set([1]), new Set([0])];
    const dist = computeMBD(new Set([0]), adj, colors);
    expect(dist[1]).toBeCloseTo(0.5, 4);
  });
});
