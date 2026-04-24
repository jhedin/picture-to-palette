import { meanShift, estimateBandwidth, type Point3 } from "./mean-shift";
import { hexToOklab, oklabToHex } from "./color";
import { slicSuperpixels } from "./slic";
import { kuwaharaFilter } from "./kuwahara";
import { buildAdjacency, computeMBD } from "./mbd";
import { felzenszwalb } from "./felzenszwalb";
import { spatialMeanShift } from "./spatial-meanshift";
import { spatialKMeansSegmentation } from "./sam-segmentation";
import { ragMerge } from "./rag-merge";
import { gaussianBlur } from "./gaussian-blur";

export type SegmentMethod = "slic" | "felzenszwalb" | "spatial-meanshift" | "spatial-kmeans" | "sam";

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
 *  subtractBackground — use Minimum Barrier Distance (MBD) propagation to
 *                      identify and exclude background-coloured segments.
 *                      Border-touching segments seed the BG model; interior
 *                      segments reachable via a continuous same-colour path
 *                      (low max-edge cost) are also removed.  Handles interior
 *                      gaps between yarn balls that border-only heuristics miss.
 *
 *  kuwahara          — apply a 5×5 Kuwahara texture-flattening filter before
 *                      SLIC segmentation.  Collapses knitted nubs and yarn
 *                      micro-shadows into flat colour zones while preserving
 *                      sharp ball/background boundaries.  Directly reduces the
 *                      number of spurious "same-colour" variants extracted from
 *                      textured backgrounds.
 */
export interface ExtractionOptions {
  segmentSize: number;        // default 1500
  segBandwidthCap: number;    // default 0.10
  mergeBandwidth: number;     // default 0.08
  minSegmentFrac: number;     // default 0
  /** Exclude only the SLIC border-seed segments from extraction — lighter than
   *  subtractBackground (no MBD propagation).  Useful for simple shots where
   *  the background is a plain surface touching the image edge. */
  excludeBorder: boolean;       // default false
  subtractBackground: boolean; // default false
  kuwahara: boolean;           // default false — flatten texture before SLIC
  /** L-axis weight for the second-level merge (0–1).
   *  1.0 = standard 3D OKLab distance (L counts fully).
   *  0.0 = cluster in (a,b) chroma plane only; median-L reassigned per cluster.
   *  Values like 0.2 collapse shadow/highlight variants (same hue, different L)
   *  without merging colours that differ primarily in chroma.  Best combined
   *  with mergeBandwidth 0.08–0.12. */
  mergeL: number;             // default 1.0

  // ── Segmentation method ──────────────────────────────────────────────────
  segmentMethod: SegmentMethod; // default "slic"

  /** Post-process any method with Region Adjacency Graph merging.
   *  Adjacent segments whose OKLab distance is below this threshold are merged.
   *  0 = disabled. */
  ragMergeThreshold: number;  // default 0

  // Felzenszwalb parameters
  fhK: number;        // scale constant — higher → larger components. default 500
  fhMinSize: number;  // minimum component size in pixels. default 500

  // Spatial mean-shift parameters
  spatialBandwidth: number;  // kernel radius in pixels. default 16
  colorBandwidth: number;    // OKLab color kernel radius. default 0.12

  // Spatial K-means parameters
  kmeansK: number;  // number of clusters. default 20

  /** Gaussian pre-blur sigma applied after resize (and after Kuwahara if enabled).
   *  Smooths yarn fiber texture so segmenters find ball-level color boundaries
   *  rather than per-fiber highlights.  0 = disabled. */
  preBlurSigma: number; // default 0
}

export const DEFAULT_OPTIONS: ExtractionOptions = {
  segmentSize: 1500,
  segBandwidthCap: 0.10,
  mergeBandwidth: 0.08,
  minSegmentFrac: 0,
  excludeBorder: false,
  subtractBackground: false,
  kuwahara: false,
  mergeL: 1.0,
  segmentMethod: "spatial-meanshift",
  ragMergeThreshold: 0,
  fhK: 500,
  fhMinSize: 500,
  spatialBandwidth: 16,
  colorBandwidth: 0.12,
  kmeansK: 20,
  preBlurSigma: 1.0,
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

export interface StatusMessage {
  type: "status";
  message: string;
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

/** Re-detect background segments by border pixel coverage after any relabelling. */
function detectBorderBackground(labels: Int32Array, W: number, H: number): Set<number> {
  const borderCount = new Map<number, number>();
  let total = 0;
  const add = (lbl: number) => { borderCount.set(lbl, (borderCount.get(lbl) ?? 0) + 1); total++; };
  for (let x = 0; x < W; x++) { add(labels[x]); add(labels[(H - 1) * W + x]); }
  for (let y = 1; y < H - 1; y++) { add(labels[y * W]); add(labels[y * W + W - 1]); }
  const bg = new Set<number>();
  for (const [lbl, cnt] of borderCount) {
    if (cnt / total >= 0.08) bg.add(lbl);
  }
  return bg;
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

export async function extractPalette(
  image: ImageData,
  cropRegion?: CropBox,
  opts?: Partial<ExtractionOptions>,
  onStatus?: (msg: string) => void,
): Promise<ExtractResult> {
  const {
    segmentSize, segBandwidthCap, mergeBandwidth, minSegmentFrac,
    excludeBorder, subtractBackground, kuwahara, mergeL,
    segmentMethod, ragMergeThreshold,
    fhK, fhMinSize,
    spatialBandwidth, colorBandwidth,
    kmeansK, preBlurSigma,
  } = { ...DEFAULT_OPTIONS, ...opts };
  const source = cropRegion ? cropImageData(image, cropRegion) : image;
  const capped = capSize(source);
  const afterKuwahara = kuwahara ? kuwaharaFilter(capped) : capped;
  const sized = preBlurSigma > 0 ? gaussianBlur(afterKuwahara, preBlurSigma) : afterKuwahara;
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

  // Phase 1 — spatial segmentation (dispatched to chosen method).
  let segPoints: Point3[];
  let labels: Int32Array;
  let backgroundLabels: Set<number>;

  if (segmentMethod === "felzenszwalb") {
    const r = felzenszwalb(sized, 0.5, fhK, fhMinSize);
    segPoints = r.points; labels = r.labels; backgroundLabels = r.backgroundLabels;
  } else if (segmentMethod === "spatial-meanshift") {
    const r = spatialMeanShift(sized, { spatialBandwidth, colorBandwidth });
    segPoints = r.points; labels = r.labels; backgroundLabels = r.backgroundLabels;
  } else if (segmentMethod === "spatial-kmeans") {
    const r = spatialKMeansSegmentation(sized, kmeansK);
    segPoints = r.points; labels = r.labels; backgroundLabels = r.backgroundLabels;
  } else if (segmentMethod === "sam") {
    const { transformersSegmentation } = await import("./sam-segmentation");
    const r = await transformersSegmentation(sized, onStatus);
    segPoints = r.points; labels = r.labels; backgroundLabels = r.backgroundLabels;
  } else {
    // slic (default)
    const K = Math.max(10, Math.round(N / segmentSize));
    const r = slicSuperpixels(sized, K, 10);
    segPoints = r.points; labels = r.labels; backgroundLabels = r.backgroundLabels;
  }

  // Optional RAG merge post-processing — collapses adjacent segments with
  // similar colors. Applies after any segmentation method.
  if (ragMergeThreshold > 0) {
    const merged = ragMerge(labels, segPoints, W, H, ragMergeThreshold);
    segPoints = merged.points;
    labels = merged.labels;
    backgroundLabels = detectBorderBackground(labels, W, H);
  }

  const numSeg = segPoints.length;

  // Phase 1.5 — MBD background propagation (when subtractBackground=true).
  //
  // Builds a superpixel adjacency graph from the SLIC label map, then runs a
  // minimax-Dijkstra from the border seed segments.  The Minimum Barrier Distance
  // (MBD) of each interior segment is the minimum, over all paths to the border,
  // of the maximum single-edge OKLab distance along that path.
  //
  // Interior background segments (e.g. the gap between yarn balls) have MBD ≈ 0
  // because a continuous same-colour path meanders around the balls.  Foreground
  // yarn segments have high MBD because any path to the border must cross the
  // sharp colour boundary at the ball edge.
  //
  // Replaces the older histogram back-projection approach: avoids the contamination
  // problem (SLIC seeds eating border pixels) and correctly handles interior gaps.
  // Only seed from border labels when the caller has opted in — otherwise
  // Phase 2 must include ALL segments regardless of border touching.
  const extendedBgLabels = new Set<number>((subtractBackground || excludeBorder) ? backgroundLabels : []);

  if (subtractBackground && backgroundLabels.size > 0) {
    const adj = buildAdjacency(labels, W, H, numSeg);
    const mbd = computeMBD(backgroundLabels, adj, segPoints);

    // Compute a representative background color from the border seeds.
    let bgL = 0, bgA = 0, bgB = 0;
    for (const b of backgroundLabels) { bgL += segPoints[b][0]; bgA += segPoints[b][1]; bgB += segPoints[b][2]; }
    bgL /= backgroundLabels.size; bgA /= backgroundLabels.size; bgB /= backgroundLabels.size;
    const bgChroma = Math.sqrt(bgA * bgA + bgB * bgB);
    const bgHue = Math.atan2(bgB, bgA); // radians

    // Segments reachable via a low-cost MBD path are candidates for removal.
    // But on textured surfaces the MBD can propagate through a gradual gradient
    // into distinctly different foreground colours.  Guard: only remove a chromatic
    // segment if its hue is within HUE_THRESHOLD of the background hue.
    // Near-achromatic segments (noise, neutral labels) are always removed by MBD.
    const MBD_THRESHOLD = 0.15;
    const HUE_THRESHOLD = 35 * (Math.PI / 180); // 35° in radians
    const ACHROMATIC_C = 0.05; // below this chroma, treat bg as achromatic
    // For achromatic backgrounds, only remove segments within this lightness
    // band.  Prevents MBD from propagating through boundary segments into
    // foreground colours that differ significantly in brightness from the bg.
    const ACHROMATIC_L_TOL = 0.20;

    for (let si = 0; si < numSeg; si++) {
      if (!backgroundLabels.has(si) && mbd[si] < MBD_THRESHOLD) {
        let remove = true;
        const [sL, sA, sB] = segPoints[si];
        if (bgChroma >= ACHROMATIC_C) {
          const segC = Math.sqrt(sA * sA + sB * sB);
          if (segC >= ACHROMATIC_C) {
            // Both bg and segment are chromatic — only remove if hue is similar.
            const segHue = Math.atan2(sB, sA);
            const hueDiff = Math.abs(Math.atan2(
              Math.sin(segHue - bgHue), Math.cos(segHue - bgHue),
            ));
            if (hueDiff >= HUE_THRESHOLD) remove = false;
          }
        } else {
          // Achromatic background: only remove segments with similar lightness.
          if (Math.abs(sL - bgL) > ACHROMATIC_L_TOL) remove = false;
        }
        if (remove) extendedBgLabels.add(si);
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
  //   Excluded segments (extendedBgLabels, which includes border seeds when
  //   excludeBorder/subtractBackground is on, plus MBD-propagated):
  //     border seeds     → 25% brightness
  //     MBD-only removal → 50% brightness
  //   All included segments → coloured by their assigned palette cluster.
  //   When neither excludeBorder nor subtractBackground is on, extendedBgLabels
  //   is empty so every segment is shown in its extracted colour.
  const clusterSizes = new Array<number>(unique.length).fill(0);
  const segPixels = new Uint8ClampedArray(sized.data.length);
  for (let i = 0; i < N; i++) {
    const si = labels[i];
    if (extendedBgLabels.has(si)) {
      // Show excluded segments dark; border seeds darker than MBD-only removals.
      const shift = backgroundLabels.has(si) ? 2 : 1;
      segPixels[i * 4]     = sized.data[i * 4] >> shift;
      segPixels[i * 4 + 1] = sized.data[i * 4 + 1] >> shift;
      segPixels[i * 4 + 2] = sized.data[i * 4 + 2] >> shift;
      segPixels[i * 4 + 3] = 255;
    } else if (unique.length > 0) {
      const rep = segRepCenter[si] ?? labPoints[i];
      const ci = nearestCluster(rep, unique);
      clusterSizes[ci]++;
      const hex = hexes[ci];
      segPixels[i * 4]     = parseInt(hex.slice(1, 3), 16);
      segPixels[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
      segPixels[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
      segPixels[i * 4 + 3] = 255;
    } else {
      // No palette clusters (all segments excluded) — show original pixel.
      segPixels[i * 4]     = sized.data[i * 4];
      segPixels[i * 4 + 1] = sized.data[i * 4 + 1];
      segPixels[i * 4 + 2] = sized.data[i * 4 + 2];
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
      const onStatus = (message: string) => {
        workerSelf.postMessage({ type: "status", message } satisfies StatusMessage);
      };
      extractPalette(e.data.imageData, e.data.cropRegion, e.data.options, onStatus).then((result) => {
        const response: ExtractResponse = { type: "result", ...result };
        workerSelf.postMessage(response);
      });
    }
  });
}
