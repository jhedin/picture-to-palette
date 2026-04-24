import { meanShift, estimateBandwidth, type Point3 } from "./mean-shift";
import { hexToOklab, oklabToHex } from "./color";
import { slicSuperpixels } from "./slic";

export interface DebugData {
  segPixels: Uint8ClampedArray;
  segWidth: number;
  segHeight: number;
  clusterSizes: number[];
  bandwidth: number;
}

export interface ExtractResult {
  hexes: string[];
  debug: DebugData;
}

export interface ExtractRequest {
  type: "extract";
  imageData: ImageData;
}

export interface ExtractResponse {
  type: "result";
  hexes: string[];
  debug: DebugData;
}

// Performance cap for SLIC.  256 px gives ~33 segments on a typical photo;
// each yarn ball ends up as 1-3 segments.  Quality is much better than the
// old 128 px direct-pixel mean-shift: SLIC preserves small regions as their
// own segments regardless of resolution.
const SLIC_MAX_DIM = 256;

function capSize(src: ImageData): ImageData {
  if (src.width <= SLIC_MAX_DIM && src.height <= SLIC_MAX_DIM) return src;
  const scale = SLIC_MAX_DIM / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  const stepX = src.width / w;
  const stepY = src.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x * stepX));
      const sy = Math.min(src.height - 1, Math.floor(y * stepY));
      const si = (sy * src.width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = src.data[si]; out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2]; out[di + 3] = 255;
    }
  }
  return new ImageData(out, w, h);
}

function nearestCluster(point: Point3, clusters: Point3[]): number {
  let nearest = 0, minD = Infinity;
  for (let j = 0; j < clusters.length; j++) {
    const dx = point[0] - clusters[j][0], dy = point[1] - clusters[j][1], dz = point[2] - clusters[j][2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < minD) { minD = d; nearest = j; }
  }
  return nearest;
}

export function extractPalette(image: ImageData): ExtractResult {
  const sized = capSize(image);
  const W = sized.width, H = sized.height, N = W * H;

  // Pre-convert all pixels to OKLab once (SLIC and mean-shift both need it).
  const labPoints: Point3[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const r = sized.data[i * 4], g = sized.data[i * 4 + 1], b = sized.data[i * 4 + 2];
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    const { L, a, b: bv } = hexToOklab(hex);
    labPoints[i] = [L, a, bv];
  }

  if (N === 0) {
    return { hexes: [], debug: { segPixels: new Uint8ClampedArray(0), segWidth: 0, segHeight: 0, clusterSizes: [], bandwidth: 0 } };
  }

  // Phase 1 — SLIC spatial segmentation.
  // Divides the image into compact colour-coherent regions (objects/edges).
  // Target ~1500 px per region so a typical yarn ball (50-200 px wide at
  // 512 px) ends up as 1-3 segments rather than being dissolved into a
  // global colour average.
  const K = Math.max(10, Math.round(N / 1500));
  const { labels } = slicSuperpixels(sized, K, 10);
  const numSeg = K; // slicSuperpixels may produce fewer if some seeds are empty

  // Phase 2 — group pixels by segment.
  const segPixelSets: Point3[][] = Array.from({ length: numSeg }, () => []);
  for (let i = 0; i < N; i++) {
    const si = labels[i];
    if (si >= 0 && si < numSeg) segPixelSets[si].push(labPoints[i]);
  }

  // Phase 3 — mean-shift independently on each segment's pixels.
  // Each segment contributes its own dominant colour(s); no global
  // clustering means a small but vivid skein can't be outvoted by a
  // large neutral background.
  const allCenters: Point3[] = [];
  let totalBw = 0, bwCount = 0;

  for (const pixels of segPixelSets) {
    if (pixels.length < 5) continue;
    // Within-segment bandwidth: quantile=0.3 stays within this region's
    // colour spread; cap keeps distinct sub-colours in the segment separate.
    const bw = Math.max(0.04, Math.min(0.10, estimateBandwidth(pixels, 0.3)));
    const centers = meanShift(pixels, { bandwidth: bw, minBinFreq: 3, maxIter: 50 });
    allCenters.push(...centers);
    totalBw += bw; bwCount++;
  }

  const avgBw = bwCount > 0 ? totalBw / bwCount : 0.07;

  if (allCenters.length === 0) {
    return { hexes: [], debug: { segPixels: new Uint8ClampedArray(0), segWidth: 0, segHeight: 0, clusterSizes: [], bandwidth: avgBw } };
  }

  // Phase 4 — deduplicate colours that converged to the same point across
  // different segments (e.g. two adjacent background tiles).
  const DEDUP = 0.08;
  const unique: Point3[] = [];
  for (const c of allCenters) {
    if (!unique.some((u) => {
      const dx = u[0] - c[0], dy = u[1] - c[1], dz = u[2] - c[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz) < DEDUP;
    })) unique.push(c);
  }

  const hexes = unique.map((c) => oklabToHex({ L: c[0], a: c[1], b: c[2] }));

  // Phase 5 — build per-pixel segmentation image for the debug overlay.
  const clusterSizes = new Array<number>(unique.length).fill(0);
  const segPixels = new Uint8ClampedArray(sized.data.length);
  for (let i = 0; i < N; i++) {
    const ci = nearestCluster(labPoints[i], unique);
    clusterSizes[ci]++;
    const hex = hexes[ci];
    segPixels[i * 4]     = parseInt(hex.slice(1, 3), 16);
    segPixels[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    segPixels[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    segPixels[i * 4 + 3] = 255;
  }

  return { hexes, debug: { segPixels, segWidth: W, segHeight: H, clusterSizes, bandwidth: avgBw } };
}

// Web Worker entrypoint (only registers when running in a worker context).
if (typeof self !== "undefined" && typeof (self as unknown as Worker).postMessage === "function" && !("window" in self)) {
  const workerSelf = self as unknown as Worker;
  workerSelf.addEventListener("message", (e: MessageEvent<ExtractRequest>) => {
    if (e.data?.type === "extract") {
      const result = extractPalette(e.data.imageData);
      const response: ExtractResponse = { type: "result", ...result };
      workerSelf.postMessage(response);
    }
  });
}
