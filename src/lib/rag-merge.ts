import type { Point3 } from "./mean-shift";

/**
 * Region Adjacency Graph (RAG) merge pass.
 *
 * Post-processes SLIC superpixel output by iteratively merging adjacent
 * segments whose mean OKLab colors are within `mergeThreshold` of each other.
 * Uses a min-heap so the cheapest (most similar) pair is always merged first.
 *
 * Stops when:
 *   - the cheapest remaining edge weight >= mergeThreshold, AND
 *   - targetSegments is null OR the current segment count <= targetSegments
 *
 * Returns renumbered labels (0..N-1) and updated per-segment mean colors.
 */
export function ragMerge(
  labels: Int32Array,
  points: Point3[],
  W: number,
  H: number,
  mergeThreshold: number,
  targetSegments?: number,
): { labels: Int32Array; points: Point3[] } {
  const N = W * H;
  const numSeg = points.length;

  if (numSeg === 0 || N === 0) {
    return { labels: new Int32Array(labels), points: [...points] };
  }

  // ── Union-Find with path compression and union-by-rank ──────────────────
  const parent = new Int32Array(numSeg);
  const rank = new Int32Array(numSeg);
  for (let i = 0; i < numSeg; i++) parent[i] = i;

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  }

  // Per-segment pixel counts (needed for weighted mean updates).
  const pixelCount = new Int32Array(numSeg);
  for (let i = 0; i < N; i++) {
    const s = labels[i];
    if (s >= 0 && s < numSeg) pixelCount[s]++;
  }

  // Working copy of segment means (L, a, b stored flat for cache efficiency).
  const meanL = new Float64Array(numSeg);
  const meanA = new Float64Array(numSeg);
  const meanB = new Float64Array(numSeg);
  for (let s = 0; s < numSeg; s++) {
    meanL[s] = points[s][0];
    meanA[s] = points[s][1];
    meanB[s] = points[s][2];
  }

  // ── Build initial adjacency set ─────────────────────────────────────────
  // Use a Set<string> with "min,max" keys to avoid duplicate edges.
  // We store edges in a min-heap keyed by OKLab distance.

  function okDist(a: number, b: number): number {
    const dL = meanL[a] - meanL[b];
    const da = meanA[a] - meanA[b];
    const db = meanB[a] - meanB[b];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  // edge = [weight, segA, segB] — canonical form: segA < segB
  type Edge = [number, number, number];

  // Min-heap operations
  const heap: Edge[] = [];

  function heapPush(e: Edge) {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }

  function heapPop(): Edge | undefined {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < heap.length && heap[l][0] < heap[smallest][0]) smallest = l;
        if (r < heap.length && heap[r][0] < heap[smallest][0]) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  // Collect unique adjacent pairs by scanning horizontal + vertical neighbors.
  // Use a flat adjacency bit-set (or Set<number> encoding pair as a*numSeg+b).
  // For large numSeg encode as BigInt key or use a Set<string>.
  // We'll use a Set<number> with packed encoding (only valid if numSeg < 2^16).
  const adjSeen = new Set<number>();

  function addEdge(sa: number, sb: number) {
    if (sa === sb) return;
    const lo = sa < sb ? sa : sb;
    const hi = sa < sb ? sb : sa;
    const key = lo * numSeg + hi;
    if (adjSeen.has(key)) return;
    adjSeen.add(key);
    heapPush([okDist(lo, hi), lo, hi]);
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const s = labels[i];
      if (s < 0) continue;
      // right neighbor
      if (x + 1 < W) {
        const sr = labels[i + 1];
        if (sr >= 0 && sr !== s) addEdge(s, sr);
      }
      // bottom neighbor
      if (y + 1 < H) {
        const sb = labels[i + W];
        if (sb >= 0 && sb !== s) addEdge(s, sb);
      }
    }
  }

  // ── Greedy merge loop ───────────────────────────────────────────────────
  let activeSegments = numSeg;

  // Track which (root, root) edges are still valid — stale edges are those
  // where either endpoint has been absorbed.  We detect stale edges lazily:
  // when we pop an edge, we re-resolve both endpoints via find(); if either
  // changed or they're the same segment now, we skip the edge.

  while (heap.length > 0) {
    const edge = heapPop()!;
    const [w, rawA, rawB] = edge;

    const ra = find(rawA);
    const rb = find(rawB);

    if (ra === rb) continue; // already merged

    // Recompute current distance (means may have been updated).
    const currentDist = okDist(ra, rb);

    // Stop condition: stop if threshold exceeded, OR if we've already
    // reached the targetSegments floor (whichever comes first).
    if (currentDist >= mergeThreshold) break;
    if (targetSegments !== undefined && activeSegments <= targetSegments) break;

    // If the stored weight is stale (much lower than reality), push a fresh
    // edge and continue — lazy re-weighting.
    if (currentDist > w + 1e-9) {
      heapPush([currentDist, ra, rb]);
      continue;
    }

    // Merge rb into ra (union by rank).
    let survivor: number, absorbed: number;
    if (rank[ra] >= rank[rb]) {
      survivor = ra; absorbed = rb;
    } else {
      survivor = rb; absorbed = ra;
    }
    parent[absorbed] = survivor;
    if (rank[survivor] === rank[absorbed]) rank[survivor]++;

    // Weighted mean update.
    const na = pixelCount[survivor];
    const nb = pixelCount[absorbed];
    const total = na + nb;
    if (total > 0) {
      meanL[survivor] = (meanL[survivor] * na + meanL[absorbed] * nb) / total;
      meanA[survivor] = (meanA[survivor] * na + meanA[absorbed] * nb) / total;
      meanB[survivor] = (meanB[survivor] * na + meanB[absorbed] * nb) / total;
    }
    pixelCount[survivor] = total;

    activeSegments--;
  }

  // ── Remap labels to compact 0..K-1 range ───────────────────────────────
  const rootToNew = new Map<number, number>();
  const newPoints: Point3[] = [];
  for (let i = 0; i < N; i++) {
    const s = labels[i];
    if (s < 0) continue;
    const root = find(s);
    if (!rootToNew.has(root)) {
      rootToNew.set(root, newPoints.length);
      newPoints.push([meanL[root], meanA[root], meanB[root]]);
    }
  }

  const newLabels = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const s = labels[i];
    newLabels[i] = s < 0 ? 0 : (rootToNew.get(find(s)) ?? 0);
  }

  return { labels: newLabels, points: newPoints };
}
