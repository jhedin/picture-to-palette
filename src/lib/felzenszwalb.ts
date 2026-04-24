import { hexToOklab } from "./color";
import type { Point3 } from "./mean-shift";

/**
 * Felzenszwalb-Huttenlocher graph-based image segmentation.
 *
 * Builds a minimum spanning forest over the 4-connected pixel grid, merging
 * components when the edge weight is below the internal threshold plus k/|C|.
 * This produces large, perceptually-coherent regions that follow actual object
 * boundaries — much better than SLIC for big uniform areas like wool balls.
 *
 * Reference: P. Felzenszwalb and D. Huttenlocher, "Efficient Graph-Based Image
 * Segmentation", IJCV 2004.
 *
 * @param img     Input image (will be segmented at its native resolution)
 * @param sigma   Pre-blur sigma — not applied here; caller should pre-blur if
 *                desired.  Kept as a parameter for API symmetry.
 * @param k       Scale constant: higher → larger components (500 good for wool)
 * @param minSize Minimum component size in pixels; small components are merged
 *                into their cheapest neighbor.
 */
export function felzenszwalb(
  img: ImageData,
  _sigma = 0.5,
  k = 500,
  minSize = 500,
): { points: Point3[]; weights: number[]; labels: Int32Array; backgroundLabels: Set<number> } {
  const { width: W, height: H, data } = img;
  const N = W * H;

  if (N === 0) {
    return {
      points: [],
      weights: [],
      labels: new Int32Array(0),
      backgroundLabels: new Set(),
    };
  }

  // ── 1. Pre-convert all pixels to OKLab (same approach as slic.ts) ──────────
  const labL = new Float32Array(N);
  const labA = new Float32Array(N);
  const labB = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    const lab = hexToOklab(hex);
    labL[i] = lab.L;
    labA[i] = lab.a;
    labB[i] = lab.b;
  }

  // ── 2. Build 4-connected edge list ──────────────────────────────────────────
  // Each undirected edge is stored once (right-neighbor + down-neighbor).
  // Maximum number of edges: (W-1)*H  +  W*(H-1)
  const maxEdges = (W - 1) * H + W * (H - 1);
  const edgeSrc = new Int32Array(maxEdges);
  const edgeDst = new Int32Array(maxEdges);
  const edgeW   = new Float32Array(maxEdges);
  let eCount = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // Right neighbor
      if (x + 1 < W) {
        const j = i + 1;
        const dL = labL[i] - labL[j], dA = labA[i] - labA[j], dBv = labB[i] - labB[j];
        edgeSrc[eCount] = i;
        edgeDst[eCount] = j;
        // Scale by 255 so k follows the original paper's convention (RGB 0-255 units).
        edgeW[eCount]   = 255 * Math.sqrt(dL * dL + dA * dA + dBv * dBv);
        eCount++;
      }
      // Down neighbor
      if (y + 1 < H) {
        const j = i + W;
        const dL = labL[i] - labL[j], dA = labA[i] - labA[j], dBv = labB[i] - labB[j];
        edgeSrc[eCount] = i;
        edgeDst[eCount] = j;
        edgeW[eCount]   = 255 * Math.sqrt(dL * dL + dA * dA + dBv * dBv);
        eCount++;
      }
    }
  }

  // ── 3. Sort edges by weight ascending ────────────────────────────────────────
  // Build an index array and sort it by weight.
  const order = new Int32Array(eCount);
  for (let e = 0; e < eCount; e++) order[e] = e;
  // Radix-like: use typed array sort for Float32 values
  order.sort((a, b) => edgeW[a] - edgeW[b]);

  // ── 4. Union-Find with per-component MInt tracking ──────────────────────────
  // parent[i]: component representative
  // rank[i]:   union-by-rank heuristic
  // size[i]:   number of pixels in component
  // mint[i]:   maximum internal edge weight (MInt) for component
  const parent = new Int32Array(N);
  const rank   = new Uint8Array(N);
  const size   = new Int32Array(N);
  const mint   = new Float32Array(N);   // MInt(C) per component root

  for (let i = 0; i < N; i++) {
    parent[i] = i;
    size[i]   = 1;
    mint[i]   = 0;
  }

  function find(x: number): number {
    // Path compression
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number, w: number): void {
    // Union by rank; update MInt and size on the new root.
    if (rank[a] < rank[b]) { const t = a; a = b; b = t; }
    parent[b] = a;
    size[a]  += size[b];
    mint[a]   = Math.max(mint[a], Math.max(mint[b], w));
    if (rank[a] === rank[b]) rank[a]++;
  }

  // FH merge condition: w(e) < MInt(C1) + k/|C1|  AND  MInt(C2) + k/|C2|
  // i.e. w < min( MInt(C1)+k/|C1|, MInt(C2)+k/|C2| )
  // which is equivalent to: w < Int(C1, C2)  where Int = min of both thresholds
  for (let ei = 0; ei < eCount; ei++) {
    const e = order[ei];
    const w = edgeW[e];
    const ra = find(edgeSrc[e]);
    const rb = find(edgeDst[e]);
    if (ra === rb) continue;
    const thresh_a = mint[ra] + k / size[ra];
    const thresh_b = mint[rb] + k / size[rb];
    if (w <= thresh_a && w <= thresh_b) {
      union(ra, rb, w);
    }
  }

  // ── 5. Enforce minimum component size ────────────────────────────────────────
  // Process edges in sorted order again; merge any component smaller than
  // minSize into its neighbor regardless of the FH threshold.
  for (let ei = 0; ei < eCount; ei++) {
    const e = order[ei];
    const ra = find(edgeSrc[e]);
    const rb = find(edgeDst[e]);
    if (ra === rb) continue;
    if (size[ra] < minSize || size[rb] < minSize) {
      union(ra, rb, edgeW[e]);
    }
  }

  // ── 6. Build compact label map ───────────────────────────────────────────────
  // Assign a sequential 0-based index to each unique component root.
  const rootToLabel = new Int32Array(N).fill(-1);
  let numSegments = 0;
  for (let i = 0; i < N; i++) {
    const r = find(i);
    if (rootToLabel[r] === -1) {
      rootToLabel[r] = numSegments++;
    }
  }

  const labels = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    labels[i] = rootToLabel[find(i)];
  }

  // ── 7. Compute per-segment mean OKLab colors and pixel counts ───────────────
  const sumL   = new Float64Array(numSegments);
  const sumA   = new Float64Array(numSegments);
  const sumBv  = new Float64Array(numSegments);
  const counts = new Int32Array(numSegments);

  for (let i = 0; i < N; i++) {
    const si = labels[i];
    sumL[si]  += labL[i];
    sumA[si]  += labA[i];
    sumBv[si] += labB[i];
    counts[si]++;
  }

  const points: Point3[] = [];
  const weights: number[] = [];
  for (let si = 0; si < numSegments; si++) {
    const n = counts[si];
    points.push([sumL[si] / n, sumA[si] / n, sumBv[si] / n]);
    weights.push(n);
  }

  // ── 8. Background detection (same logic as slic.ts) ─────────────────────────
  // Segments touching two adjacent image borders (corner-adjacent) are
  // background.  Border = ≥8% of the perimeter each side uses that segment.
  const touchesTop    = new Set<number>();
  const touchesBottom = new Set<number>();
  const touchesLeft   = new Set<number>();
  const touchesRight  = new Set<number>();

  for (let x = 0; x < W; x++) {
    touchesTop.add(labels[x]);
    touchesBottom.add(labels[(H - 1) * W + x]);
  }
  for (let y = 0; y < H; y++) {
    touchesLeft.add(labels[y * W]);
    touchesRight.add(labels[y * W + W - 1]);
  }

  const backgroundLabels = new Set<number>();
  const allBorderLabels = new Set([
    ...touchesTop, ...touchesBottom, ...touchesLeft, ...touchesRight,
  ]);
  for (const lbl of allBorderLabels) {
    const tTop    = touchesTop.has(lbl);
    const tBottom = touchesBottom.has(lbl);
    const tLeft   = touchesLeft.has(lbl);
    const tRight  = touchesRight.has(lbl);
    if ((tTop && tLeft) || (tTop && tRight) || (tBottom && tLeft) || (tBottom && tRight)) {
      backgroundLabels.add(lbl);
    }
  }

  return { points, weights, labels, backgroundLabels };
}
