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

/** Normalised crop rectangle (all values 0–1, relative to original image). */
export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Tuning knobs for extractPalette.  All have sensible defaults so callers
 * only need to set the ones they want to override.
 *
 *  segmentSize      — target px per SLIC superpixel. Smaller = more regions,
 *                     finer spatial detail preserved; larger = fewer regions,
 *                     small highlights averaged away.   range 300–5000
 *
 *  segBandwidthCap  — ceiling on the per-segment mean-shift bandwidth.
 *                     Lower = more sub-colours per region (shadows kept);
 *                     higher = bolder single colour per region.  range 0.04–0.20
 *
 *  mergeBandwidth   — bandwidth for the second-level mean-shift that runs on
 *                     all segment representatives.  This is the main knob for
 *                     collapsing shadow/highlight variants of the same object:
 *                     shadow + highlight of a yarn ball are ~0.10–0.15 apart,
 *                     so values above 0.10 start merging them.  range 0.04–0.25
 */
export interface ExtractionOptions {
  segmentSize: number;       // default 1500
  segBandwidthCap: number;   // default 0.10
  mergeBandwidth: number;    // default 0.08
  /** Skip SLIC segments smaller than (minSegmentFrac × segmentSize) pixels.
   *  0 = no minimum.  0.5 = skip anything under half the expected segment size.
   *  Scales with segmentSize so it stays meaningful regardless of crop or K. */
  minSegmentFrac: number;    // default 0
  /** Remove palette colours that match the border-detected background.
   *  Builds a colour signature from border-touching segments, then drops
   *  any final palette colour within BASE_DEDUP distance of that signature.
   *  Useful when the subject sits on a clearly different background. */
  subtractBackground: boolean; // default false
}

export const DEFAULT_OPTIONS: ExtractionOptions = {
  segmentSize: 1500,
  segBandwidthCap: 0.10,
  mergeBandwidth: 0.08,
  minSegmentFrac: 0,
  subtractBackground: false,
};

export interface ExtractResult {
  hexes: string[];
  debug: DebugData;
}

export interface ExtractRequest {
  type: "extract";
  imageData: ImageData;
  cropRegion?: CropBox;
  options?: Partial<ExtractionOptions>;
}

export interface ExtractResponse {
  type: "result";
  hexes: string[];
  debug: DebugData;
}

/** Crop an ImageData to the given normalised box. */
function cropImageData(src: ImageData, box: CropBox): ImageData {
  const sx = Math.round(box.x * src.width);
  const sy = Math.round(box.y * src.height);
  const sw = Math.max(1, Math.round(box.w * src.width));
  const sh = Math.max(1, Math.round(box.h * src.height));
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const si = ((sy + y) * src.width + (sx + x)) * 4;
      const di = (y * sw + x) * 4;
      out[di] = src.data[si]; out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2]; out[di + 3] = src.data[si + 3];
    }
  }
  return new ImageData(out, sw, sh);
}

/** Compute the bounding box of non-background pixels, with a small padding. */
function computeCropBox(labels: Int32Array, bg: Set<number>, W: number, H: number): CropBox {
  let minX = W, minY = H, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!bg.has(labels[y * W + x])) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  if (!found) return { x: 0, y: 0, w: 1, h: 1 };
  const PAD = 0.02;
  const x = Math.max(0, minX / W - PAD);
  const y = Math.max(0, minY / H - PAD);
  const w = Math.min(1 - x, (maxX - minX + 1) / W + 2 * PAD);
  const h = Math.min(1 - y, (maxY - minY + 1) / H + 2 * PAD);
  return { x, y, w, h };
}

/**
 * Quick SLIC pass to detect subject bounds and suggest a crop rectangle.
 * Much faster than a full extraction — only runs SLIC, not mean-shift.
 */
export function suggestCrop(image: ImageData): CropBox {
  if (image.width === 0 || image.height === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const sized = capSize(image);
  const W = sized.width, H = sized.height;
  const K = Math.max(10, Math.round((W * H) / 1500));
  const { labels, backgroundLabels } = slicSuperpixels(sized, K, 10);
  return computeCropBox(labels, backgroundLabels, W, H);
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

export function extractPalette(
  image: ImageData,
  cropRegion?: CropBox,
  opts?: Partial<ExtractionOptions>,
): ExtractResult {
  const { segmentSize, segBandwidthCap, mergeBandwidth, minSegmentFrac, subtractBackground } = { ...DEFAULT_OPTIONS, ...opts };
  const source = cropRegion ? cropImageData(image, cropRegion) : image;
  const sized = capSize(source);
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
  const K = Math.max(10, Math.round(N / segmentSize));
  const { points: slicPoints, labels, backgroundLabels } = slicSuperpixels(sized, K, 10);
  const numSeg = slicPoints.length;

  // Phase 2 — group pixels by segment, skipping border-touching background segments.
  // Also collect a sample of background pixels for optional background subtraction.
  const segPixelSets: Point3[][] = Array.from({ length: numSeg }, () => []);
  const bgSample: Point3[] = [];
  for (let i = 0; i < N; i++) {
    const si = labels[i];
    if (si < 0 || si >= numSeg) continue;
    if (backgroundLabels.has(si)) {
      // Sample ~1 in 4 background pixels — enough for mean-shift, not expensive.
      if (subtractBackground && i % 4 === 0) bgSample.push(labPoints[i]);
    } else {
      segPixelSets[si].push(labPoints[i]);
    }
  }

  // Phase 3 — mean-shift independently on each segment's pixels.
  // Track per-segment representative colors so the debug view can color
  // each pixel from its own segment rather than a global nearest-cluster.
  const allCenters: Point3[] = [];
  // segRepCenter[si] = the dominant center found for segment si
  const segRepCenter: Point3[] = new Array(numSeg);
  let totalBw = 0, bwCount = 0;

  for (let si = 0; si < numSeg; si++) {
    const pixels = segPixelSets[si];
    // Skip segments below the minimum size threshold — labels, glints, edge slivers.
    // Threshold is a fraction of total pixels so it scales with crop size.
    // segRepCenter[si] stays undefined; phase 5 falls back to per-pixel nearest-cluster.
    if (minSegmentFrac > 0 && pixels.length < minSegmentFrac * segmentSize) continue;
    if (pixels.length < 5) {
      // Too few pixels — use the mean of whatever is there
      if (pixels.length > 0) {
        const mean: Point3 = [
          pixels.reduce((s, p) => s + p[0], 0) / pixels.length,
          pixels.reduce((s, p) => s + p[1], 0) / pixels.length,
          pixels.reduce((s, p) => s + p[2], 0) / pixels.length,
        ];
        segRepCenter[si] = mean;
        allCenters.push(mean);
      }
      continue;
    }
    const bw = Math.max(0.04, Math.min(segBandwidthCap, estimateBandwidth(pixels, 0.3)));
    const centers = meanShift(pixels, { bandwidth: bw, minBinFreq: 3, maxIter: 50 });
    // Representative for this segment = center nearest its mean
    const mean: Point3 = [
      pixels.reduce((s, p) => s + p[0], 0) / pixels.length,
      pixels.reduce((s, p) => s + p[1], 0) / pixels.length,
      pixels.reduce((s, p) => s + p[2], 0) / pixels.length,
    ];
    const rep = centers[nearestCluster(mean, centers)];
    segRepCenter[si] = rep;
    allCenters.push(...centers);
    totalBw += bw; bwCount++;
  }

  const avgBw = bwCount > 0 ? totalBw / bwCount : 0.07;

  if (allCenters.length === 0) {
    return { hexes: [], debug: { segPixels: new Uint8ClampedArray(0), segWidth: 0, segHeight: 0, clusterSizes: [], bandwidth: avgBw } };
  }

  // Phase 4 — greedy dedup: drop any center within BASE_DEDUP of an already-kept one.
  // This is fast and order-stable, preserving the same baseline behaviour as before.
  const BASE_DEDUP = 0.08;
  const deduped: Point3[] = [];
  for (const c of allCenters) {
    if (!deduped.some((u) => {
      const dx = u[0] - c[0], dy = u[1] - c[1], dz = u[2] - c[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz) < BASE_DEDUP;
    })) deduped.push(c);
  }

  // Phase 4.5 — second-level mean-shift to collapse shadow/highlight variants.
  // Only runs when mergeBandwidth is meaningfully above the base dedup threshold.
  // Shadow/highlight pairs of the same object are typically 0.10–0.15 apart in OKLab,
  // so values in that range start merging them while leaving distinct hues separate.
  const unique: Point3[] = mergeBandwidth > BASE_DEDUP
    ? meanShift(deduped, { bandwidth: mergeBandwidth, minBinFreq: 1, maxIter: 50 })
    : deduped;

  // Phase 4.7 — background subtraction.
  // Cluster the border-touching background pixels to find representative background
  // colours, then remove any palette colour that falls within BASE_DEDUP of them.
  // Interior background segments (same colour but not touching the border) get
  // caught because their colours match the border-segment signature.
  let filtered = unique;
  if (subtractBackground && bgSample.length >= 5) {
    const bgBw = Math.max(0.04, Math.min(0.15, estimateBandwidth(bgSample, 0.3)));
    const bgCenters = meanShift(bgSample, { bandwidth: bgBw, minBinFreq: 2, maxIter: 50 });
    filtered = unique.filter((c) => {
      return !bgCenters.some((bg) => {
        const dx = c[0] - bg[0], dy = c[1] - bg[1], dz = c[2] - bg[2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz) < BASE_DEDUP;
      });
    });
    // Keep at least 1 colour even if everything matched background.
    if (filtered.length === 0) filtered = unique;
  }

  const hexes = filtered.map((c) => oklabToHex({ L: c[0], a: c[1], b: c[2] }));

  // Phase 5 — build segmentation debug image.
  // Foreground segments: coloured by their representative palette colour.
  // Background segments (border-touching): shown at 25% brightness.
  // Uses `filtered` for colouring so subtracted colours show as background-like.
  const clusterSizes = new Array<number>(filtered.length).fill(0);
  const segPixels = new Uint8ClampedArray(sized.data.length);
  for (let i = 0; i < N; i++) {
    const si = labels[i];
    if (backgroundLabels.has(si)) {
      segPixels[i * 4]     = sized.data[i * 4] >> 2;
      segPixels[i * 4 + 1] = sized.data[i * 4 + 1] >> 2;
      segPixels[i * 4 + 2] = sized.data[i * 4 + 2] >> 2;
      segPixels[i * 4 + 3] = 255;
    } else {
      const rep = segRepCenter[si] ?? labPoints[i];
      const ci = nearestCluster(rep, filtered);
      clusterSizes[ci]++;
      const hex = hexes[ci];
      segPixels[i * 4]     = parseInt(hex.slice(1, 3), 16);
      segPixels[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
      segPixels[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
      segPixels[i * 4 + 3] = 255;
    }
  }

  return { hexes, debug: { segPixels, segWidth: W, segHeight: H, clusterSizes, bandwidth: avgBw } };
}

// Web Worker entrypoint (only registers when running in a worker context).
if (typeof self !== "undefined" && typeof (self as unknown as Worker).postMessage === "function" && !("window" in self)) {
  const workerSelf = self as unknown as Worker;
  workerSelf.addEventListener("message", (e: MessageEvent<ExtractRequest>) => {
    if (e.data?.type === "extract") {
      const result = extractPalette(e.data.imageData, e.data.cropRegion, e.data.options);
      const response: ExtractResponse = { type: "result", ...result };
      workerSelf.postMessage(response);
    }
  });
}
