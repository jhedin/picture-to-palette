/**
 * Minimum Barrier Distance (MBD) for superpixel-based background detection.
 *
 * Background Connectivity Prior: background regions are typically large,
 * homogeneous, and connected to the image boundary.  For each interior
 * superpixel we compute the MBD to the border — the path from that node to
 * any border seed that *minimises the maximum single-edge cost* along the
 * path (where each edge cost is the OKLab Euclidean distance between two
 * adjacent segment means).
 *
 * This avoids the "accumulating penalty" of geodesic (sum-of-edges) distance:
 * a long, uniform background gap between yarn balls has MBD ≈ 0 because a
 * continuous same-colour path meanders around the balls.  A foreground ball
 * has a high MBD because any path to the border must cross the high-contrast
 * yarn-boundary edge.
 *
 * Reference: Zhang et al., "Minimum Barrier Salient Object Detection at
 * 80 FPS", ICCV 2015.
 */

import type { Point3 } from "./mean-shift";

/**
 * Build a compact adjacency list for SLIC segments.
 * Two segments are adjacent if any of their pixels share an edge in the
 * image grid (4-connectivity: right + down).
 */
export function buildAdjacency(
  labels: Int32Array,
  W: number,
  H: number,
  numSeg: number,
): Set<number>[] {
  const adj: Set<number>[] = Array.from({ length: numSeg }, () => new Set<number>());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const si = labels[i];
      if (si < 0 || si >= numSeg) continue;

      if (x + 1 < W) {
        const sj = labels[i + 1];
        if (sj >= 0 && sj < numSeg && si !== sj) {
          adj[si].add(sj); adj[sj].add(si);
        }
      }
      if (y + 1 < H) {
        const sj = labels[i + W];
        if (sj >= 0 && sj < numSeg && si !== sj) {
          adj[si].add(sj); adj[sj].add(si);
        }
      }
    }
  }
  return adj;
}

/**
 * Compute the Minimum Barrier Distance from every superpixel to the set of
 * border seed superpixels, using a minimax-Dijkstra (priority-queue).
 *
 * Returns a Float64Array of length numSeg where dist[i] is the OKLab
 * barrier cost from superpixel i to the nearest border seed.
 *
 * Float64 (not Float32) is used internally because the stale-entry guard
 * `barrier > dist[u]` would misfire with Float32: JS heap values are float64,
 * while Float32 storage rounds 0.01 down to 0.009999…, making the guard
 * incorrectly treat a freshly-pushed entry as stale.
 */
export function computeMBD(
  bgSeeds: Set<number>,
  adj: Set<number>[],
  segColors: Point3[],
): Float64Array {
  const n = segColors.length;
  const dist = new Float64Array(n).fill(Infinity);

  // Min-heap: [barrierCost, segIndex]
  const heap: [number, number][] = [];

  const heapPush = (b: number, i: number) => {
    let j = heap.length;
    heap.push([b, i]);
    while (j > 0) {
      const p = (j - 1) >> 1;
      if (heap[p][0] <= heap[j][0]) break;
      [heap[p], heap[j]] = [heap[j], heap[p]];
      j = p;
    }
  };

  const heapPop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[i], heap[s]] = [heap[s], heap[i]];
        i = s;
      }
    }
    return top;
  };

  for (const b of bgSeeds) {
    if (b < 0 || b >= n) continue;
    dist[b] = 0;
    heapPush(0, b);
  }

  while (heap.length > 0) {
    const [barrier, u] = heapPop();
    if (barrier > dist[u]) continue;   // stale entry
    const cu = segColors[u];

    for (const v of adj[u]) {
      const cv = segColors[v];
      const dL = cu[0] - cv[0], da = cu[1] - cv[1], db = cu[2] - cv[2];
      const edgeW = Math.sqrt(dL * dL + da * da + db * db);
      const newBarrier = Math.max(barrier, edgeW);
      if (newBarrier < dist[v]) {
        dist[v] = newBarrier;
        heapPush(newBarrier, v);
      }
    }
  }

  return dist;
}
