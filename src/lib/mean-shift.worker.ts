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
 *  segmentSize       — target px per SLIC superpixel. Smaller = more regions,
 *                      finer spatial detail preserved; larger = fewer regions,
 *                      small highlights averaged away.   range 300–5000
 *
 *  segBandwidthCap   — ceiling on the per-segment mean-shift bandwidth.
 *                      Lower = more sub-colours per region (shadows kept);
 *                      higher = bolder single colour per region.  range 0.04–0.20
 *
 *  mergeBandwidth    — bandwidth for the second-level merge that runs on all
 *                      segment representatives.  In 3D mode this is the OKLab
 *                      distance threshold; in chromaMerge mode it is the 2D
 *                      (a,b) chroma-plane distance threshold.
 *
 *  minSegmentFrac    — skip SLIC segments smaller than this fraction of the
 *                      target segment size.  0 = no minimum.
 *
 *  subtractBackground — use histogram back-projection to identify and exclude
 *                      background-coloured segments, extending the basic
 *                      border-touching heuristic to interior segments.
 *
 *  chromaMerge       — cluster segment representatives in the OKLab (a,b)
 *                      chroma plane only (ignoring L), then assign each cluster
 *                      the median L of its members.  Collapses shadow/highlight
 *                      variants that share a hue but differ in lightness.
 */
export interface ExtractionOptions {
  segmentSize: number;        // default 1500
  segBandwidthCap: number;    // default 0.10
  mergeBandwidth: number;     // default 0.08
  minSegmentFrac: number;     // default 0
  subtractBackground: boolean; // default false
  /** L-axis weight for the second-level merge (0–1).
   *  1.0 = standard 3D OKLab distance (L counts fully).
   *  0.0 = cluster in (a,b) chroma plane only; median-L reassigned per cluster.
   *  Values like 0.2 collapse shadow/highlight variants (same hue, different L)
   *  without merging colours that differ primarily in chroma.  Best combined
   *  with mergeBandwidth 0.08–0.12. */
  mergeL: number;             // default 1.0
}

export const DEFAULT_OPTIONS: ExtractionOptions = {
  segmentSize: 1500,
  segBandwidthCap: 0.10,
  mergeBandwidth: 0.08,
  minSegmentFrac: 0,
  subtractBackground: false,
  mergeL: 1.0,
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
  const { segmentSize, segBandwidthCap, mergeBandwidth, minSegmentFrac, subtractBackground, mergeL } = { ...DEFAULT_OPTIONS, ...opts };
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
  const K = Math.max(10, Math.round(N / segmentSize));
  const { points: slicPoints, labels, backgroundLabels } = slicSuperpixels(sized, K, 10);
  const numSeg = slicPoints.length;

  // Phase 1.5 — back-projection background extension (when subtractBackground=true).
  //
  // Builds a 2D (a,b) histogram from the already-identified border-touching segments,
  // then computes a background ratio for each non-border segment:
  //   ratio[a,b] = bgPixels[bin] / allPixels[bin]
  // A segment whose pixels land mostly in high-ratio bins shares its colour with the
  // border background, so we extend backgroundLabels to include it.
  //
  // This catches interior background segments (between yarn balls) that don't touch
  // the frame edge directly but are the same colour as those that do.
  const extendedBgLabels = new Set<number>(backgroundLabels);

  if (subtractBackground && backgroundLabels.size > 0) {
    const BINS = 24;
    const AB_MIN = -0.4, AB_MAX = 0.4, AB_RANGE = AB_MAX - AB_MIN;
    const binIdx = (v: number) =>
      Math.min(BINS - 1, Math.max(0, Math.floor((v - AB_MIN) / AB_RANGE * BINS)));

    const histBg  = new Float32Array(BINS * BINS);
    const histAll = new Float32Array(BINS * BINS);

    for (let i = 0; i < N; i++) {
      const si = labels[i];
      if (si < 0 || si >= numSeg) continue;
      const ai = binIdx(labPoints[i][1]);
      const bi = binIdx(labPoints[i][2]);
      histAll[ai * BINS + bi]++;
      if (backgroundLabels.has(si)) histBg[ai * BINS + bi]++;
    }

    // For each non-background segment, average the (bgCount/allCount) ratio across
    // its pixels.  Segments where most pixels share their (a,b) with the border get
    // flagged as extended background.
    const segRatioSum = new Float32Array(numSeg);
    const segRatioCount = new Int32Array(numSeg);
    for (let i = 0; i < N; i++) {
      const si = labels[i];
      if (si < 0 || si >= numSeg || backgroundLabels.has(si)) continue;
      const ai = binIdx(labPoints[i][1]);
      const bi = binIdx(labPoints[i][2]);
      const all = histAll[ai * BINS + bi];
      segRatioSum[si]  += all > 0 ? histBg[ai * BINS + bi] / all : 0;
      segRatioCount[si]++;
    }

    // Segments where most pixels share their (a,b) with the border are
    // classified as extended background.  0.15 is empirically good: it catches
    // interior background segments (ratio 0.15–0.22) while leaving foreground
    // subjects (ratio < 0.08) untouched.
    const BG_RATIO_THRESHOLD = 0.15;
    for (let si = 0; si < numSeg; si++) {
      if (!backgroundLabels.has(si) && segRatioCount[si] > 0 &&
          segRatioSum[si] / segRatioCount[si] > BG_RATIO_THRESHOLD) {
        extendedBgLabels.add(si);
      }
    }
  }

  // Phase 2 — group pixels by segment, skipping background segments.
  const segPixelSets: Point3[][] = Array.from({ length: numSeg }, () => []);
  for (let i = 0; i < N; i++) {
    const si = labels[i];
    if (si < 0 || si >= numSeg || extendedBgLabels.has(si)) continue;
    segPixelSets[si].push(labPoints[i]);
  }

  // Phase 3 — mean-shift independently on each segment's pixels.
  const allCenters: Point3[] = [];
  const segRepCenter: Point3[] = new Array(numSeg);
  let totalBw = 0, bwCount = 0;

  for (let si = 0; si < numSeg; si++) {
    const pixels = segPixelSets[si];
    if (minSegmentFrac > 0 && pixels.length < minSegmentFrac * segmentSize) continue;
    if (pixels.length < 5) {
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

  // Phase 4 — greedy dedup in 3D OKLab.
  const BASE_DEDUP = 0.08;
  const deduped: Point3[] = [];
  for (const c of allCenters) {
    if (!deduped.some((u) => {
      const dx = u[0] - c[0], dy = u[1] - c[1], dz = u[2] - c[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz) < BASE_DEDUP;
    })) deduped.push(c);
  }

  // Phase 4.5 — second-level merge to collapse shadow/highlight variants.
  //
  //  mergeL=1.0 (default): standard 3D OKLab mean-shift.  Only fires when
  //    mergeBandwidth > BASE_DEDUP, preserving backward-compatible defaults.
  //
  //  mergeL=0.0: pure (a,b) chroma-plane clustering.  Projects all centers to
  //    (0, a, b), clusters there, then assigns each cluster its members' median L.
  //    Same-hue shadow/highlight variants share an (a,b) direction so they
  //    collapse to one colour.
  //
  //  0 < mergeL < 1: L-weighted distance.  L is scaled by mergeL before
  //    clustering so lightness differences count less.  Allows fine-tuning:
  //    values around 0.2 collapse shadow pairs (ΔL~0.3) while keeping colours
  //    that differ mainly in chroma (Δ(a,b)~0.05) separate.  Runs even when
  //    mergeBandwidth <= BASE_DEDUP, since the L scaling already effectively
  //    increases the merge range in the lightness direction.
  let unique: Point3[];
  if (mergeL <= 0) {
    // Pure chroma-plane clustering: project L to 0, median-L per cluster.
    const projected = deduped.map(c => [0, c[1], c[2]] as Point3);
    const clusters2D = meanShift(projected, { bandwidth: Math.max(BASE_DEDUP, mergeBandwidth), minBinFreq: 1, maxIter: 50 });
    const clusterLs: number[][] = clusters2D.map(() => []);
    for (let i = 0; i < deduped.length; i++) {
      clusterLs[nearestCluster(projected[i], clusters2D)].push(deduped[i][0]);
    }
    unique = clusters2D.map(([, ca, cb], i) => {
      const Ls = [...clusterLs[i]].sort((a, b) => a - b);
      return [Ls.length > 0 ? Ls[Math.floor(Ls.length / 2)] : 0.5, ca, cb] as Point3;
    });
  } else if (mergeL < 1.0) {
    // L-weighted clustering: scale L so lightness differences count less.
    const weighted = deduped.map(c => [c[0] * mergeL, c[1], c[2]] as Point3);
    const merged = meanShift(weighted, { bandwidth: mergeBandwidth, minBinFreq: 1, maxIter: 50 });
    unique = merged.map(c => [c[0] / mergeL, c[1], c[2]] as Point3);
  } else {
    // Standard 3D merge — only fires when bandwidth meaningfully above BASE_DEDUP.
    unique = mergeBandwidth > BASE_DEDUP
      ? meanShift(deduped, { bandwidth: mergeBandwidth, minBinFreq: 1, maxIter: 50 })
      : deduped;
  }

  const hexes = unique.map((c) => oklabToHex({ L: c[0], a: c[1], b: c[2] }));

  // Phase 5 — build segmentation debug image.
  //   Border-touching background   → 25% brightness (very dark)
  //   Back-projection extended bg  → 50% brightness (medium dark)
  //   Foreground                   → coloured by palette cluster
  const clusterSizes = new Array<number>(unique.length).fill(0);
  const segPixels = new Uint8ClampedArray(sized.data.length);
  for (let i = 0; i < N; i++) {
    const si = labels[i];
    if (backgroundLabels.has(si)) {
      segPixels[i * 4]     = sized.data[i * 4] >> 2;
      segPixels[i * 4 + 1] = sized.data[i * 4 + 1] >> 2;
      segPixels[i * 4 + 2] = sized.data[i * 4 + 2] >> 2;
      segPixels[i * 4 + 3] = 255;
    } else if (extendedBgLabels.has(si)) {
      // Back-projection identified segment — shown at 50% so user can see what was removed.
      segPixels[i * 4]     = sized.data[i * 4] >> 1;
      segPixels[i * 4 + 1] = sized.data[i * 4 + 1] >> 1;
      segPixels[i * 4 + 2] = sized.data[i * 4 + 2] >> 1;
      segPixels[i * 4 + 3] = 255;
    } else {
      const rep = segRepCenter[si] ?? labPoints[i];
      const ci = nearestCluster(rep, unique);
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
