/**
 * ML-backed segmentation using Transformers.js (image-segmentation pipeline).
 *
 * Primary path: loads Xenova/detr-resnet-50-panoptic via @huggingface/transformers
 * and converts the returned per-segment masks into a flat Int32Array label map.
 *
 * Fallback path: if the model fails to load or run at runtime (e.g. offline,
 * WASM init failure), spatialKMeansSegmentation is used instead.
 */

import { hexToOklab } from "./color";
import type { Point3 } from "./mean-shift";

export interface SegmentResult {
  points: Point3[];
  weights: number[];
  labels: Int32Array;
  backgroundLabels: Set<number>;
}

// ---------------------------------------------------------------------------
// Transformers.js image segmentation
// ---------------------------------------------------------------------------

/** Cached pipeline instance (singleton per worker lifetime). */
let pipelineCache: import("@huggingface/transformers").ImageSegmentationPipeline | null =
  null;
let pipelineLoadFailed = false;

type StatusCallback = (message: string) => void;

/**
 * Load (and cache) the image segmentation pipeline.
 * Returns null if the model cannot be loaded.
 */
async function getSegmentationPipeline(
  onStatus?: StatusCallback,
): Promise<import("@huggingface/transformers").ImageSegmentationPipeline | null> {
  if (pipelineCache) return pipelineCache;
  if (pipelineLoadFailed) return null;

  try {
    const { pipeline, env } = await import("@huggingface/transformers");

    // Configure for web-worker context.
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;

    // Point ONNX Runtime WASM to a reliable CDN so Vite bundling doesn't
    // need to copy the .wasm files into the build output.
    (
      env.backends as {
        onnx: { wasm?: { wasmPaths?: string } };
      }
    ).onnx.wasm = {
      wasmPaths:
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/",
    };

    onStatus?.("Downloading segmentation model (~40MB)…");

    const segmenter = await pipeline(
      "image-segmentation",
      "Xenova/detr-resnet-50-panoptic",
      {
        progress_callback: (info) => {
          if (info.status === "progress") {
            const pct = Math.round((info as { progress: number }).progress);
            onStatus?.(
              `Downloading segmentation model… ${pct}%`,
            );
          }
        },
      },
    );

    pipelineCache = segmenter;
    return segmenter;
  } catch (err) {
    console.warn(
      "[sam-segmentation] Failed to load Transformers.js pipeline, will use K-means fallback:",
      err,
    );
    pipelineLoadFailed = true;
    return null;
  }
}

/**
 * Convert ImageData to a data URI via OffscreenCanvas so the pipeline can
 * accept it as an image source.
 */
async function imageDataToBlob(img: ImageData): Promise<Blob> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

/**
 * Build a SegmentResult from Transformers.js output masks.
 *
 * Each segment in `segments` has a binary `mask` (RawImage with 1 channel,
 * values 0 or 255).  We assign each pixel the index of the segment whose
 * mask covers it (last-wins when masks overlap).
 */
function masksToSegmentResult(
  img: ImageData,
  segments: import("@huggingface/transformers").ImageSegmentationOutput,
): SegmentResult {
  const W = img.width;
  const H = img.height;
  const N = W * H;

  if (segments.length === 0 || N === 0) {
    return {
      points: [],
      weights: [],
      labels: new Int32Array(N),
      backgroundLabels: new Set(),
    };
  }

  // Start with label -1 (unassigned).
  const labels = new Int32Array(N).fill(-1);

  for (let si = 0; si < segments.length; si++) {
    const { mask } = segments[si];
    // mask.data is Uint8Array/Uint8ClampedArray with one channel (L=0..255).
    // mask dimensions should match the input image (the pipeline resizes).
    const maskData = mask.data;
    const mW = mask.width;
    const mH = mask.height;

    for (let my = 0; my < mH; my++) {
      for (let mx = 0; mx < mW; mx++) {
        // Map mask coordinates back to image coordinates if sizes differ.
        const ix = Math.round((mx / mW) * W);
        const iy = Math.round((my / mH) * H);
        const imgIdx = Math.min(iy, H - 1) * W + Math.min(ix, W - 1);
        const maskIdx = my * mW + mx;
        if (maskData[maskIdx] > 127) {
          labels[imgIdx] = si;
        }
      }
    }
  }

  // Any pixel still at -1 gets assigned to segment 0.
  for (let i = 0; i < N; i++) {
    if (labels[i] < 0) labels[i] = 0;
  }

  // Compute per-segment mean OKLab colour and pixel count.
  const K = segments.length;
  const sumL = new Float64Array(K);
  const sumA = new Float64Array(K);
  const sumB = new Float64Array(K);
  const count = new Int32Array(K);

  for (let i = 0; i < N; i++) {
    const si = labels[i];
    const r = img.data[i * 4];
    const g = img.data[i * 4 + 1];
    const b = img.data[i * 4 + 2];
    const hex =
      "#" +
      r.toString(16).padStart(2, "0") +
      g.toString(16).padStart(2, "0") +
      b.toString(16).padStart(2, "0");
    const lab = hexToOklab(hex);
    sumL[si] += lab.L;
    sumA[si] += lab.a;
    sumB[si] += lab.b;
    count[si]++;
  }

  const remap = new Int32Array(K).fill(-1);
  const points: Point3[] = [];
  const weights: number[] = [];

  for (let si = 0; si < K; si++) {
    const n = count[si];
    if (n === 0) continue;
    remap[si] = points.length;
    points.push([sumL[si] / n, sumA[si] / n, sumB[si] / n]);
    weights.push(n);
  }

  for (let i = 0; i < N; i++) {
    const mapped = remap[labels[i]];
    labels[i] = mapped >= 0 ? mapped : 0;
  }

  // Background detection: segments touching two adjacent image borders.
  const touchesTop = new Set<number>();
  const touchesBottom = new Set<number>();
  const touchesLeft = new Set<number>();
  const touchesRight = new Set<number>();

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
    ...touchesTop,
    ...touchesBottom,
    ...touchesLeft,
    ...touchesRight,
  ]);
  for (const lbl of allBorderLabels) {
    const tT = touchesTop.has(lbl),
      tBo = touchesBottom.has(lbl);
    const tL = touchesLeft.has(lbl),
      tR = touchesRight.has(lbl);
    if ((tT && tL) || (tT && tR) || (tBo && tL) || (tBo && tR)) {
      backgroundLabels.add(lbl);
    }
  }

  return { points, weights, labels, backgroundLabels };
}

/**
 * Segment an image using the Transformers.js image-segmentation pipeline.
 * Falls back to spatialKMeansSegmentation if the model fails to load or run.
 *
 * @param img         Input image (any size; caller may cap at ~256 px).
 * @param onStatus    Optional callback for progress/status messages.
 */
export async function transformersSegmentation(
  img: ImageData,
  onStatus?: StatusCallback,
): Promise<SegmentResult> {
  const segmenter = await getSegmentationPipeline(onStatus);

  if (segmenter) {
    try {
      const blob = await imageDataToBlob(img);
      const url = URL.createObjectURL(blob);
      try {
        const result = await segmenter(url);
        const segments =
          result as import("@huggingface/transformers").ImageSegmentationOutput;
        return masksToSegmentResult(img, segments);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.warn(
        "[sam-segmentation] Model inference failed, falling back to K-means:",
        err,
      );
    }
  }

  // Fallback to spatial K-means.
  return spatialKMeansSegmentation(img);
}

// ---------------------------------------------------------------------------
// Spatial K-means fallback
// ---------------------------------------------------------------------------

/**
 * Segment an image using K-means in joint (x, y, L, a, b) space.
 *
 * This is kept as a pure-TypeScript fallback used when the Transformers.js
 * model is unavailable (offline, WASM failure, etc.).
 *
 * @param img       Input image (any size; caller should cap at ~256 px).
 * @param k         Number of segments (clusters). Default 20.
 * @param iters     K-means iterations. Default 15.
 * @param spatialScale Weight applied to the normalised (x,y) coordinates
 *                  relative to the OKLab colour axes. Default 0.5.
 */
export function spatialKMeansSegmentation(
  img: ImageData,
  k = 20,
  iters = 15,
  spatialScale = 0.5,
): SegmentResult {
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

  // ------------------------------------------------------------------
  // Step 1: Pre-compute 5-D feature vectors [x̂, ŷ, L, a, b] per pixel.
  // ------------------------------------------------------------------
  const sx = spatialScale / (W - 1 || 1);
  const sy = spatialScale / (H - 1 || 1);

  const fx = new Float32Array(N);
  const fy = new Float32Array(N);
  const fL = new Float32Array(N);
  const fA = new Float32Array(N);
  const fB = new Float32Array(N);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const hex =
        "#" +
        r.toString(16).padStart(2, "0") +
        g.toString(16).padStart(2, "0") +
        b.toString(16).padStart(2, "0");
      const lab = hexToOklab(hex);
      fx[i] = px * sx;
      fy[i] = py * sy;
      fL[i] = lab.L;
      fA[i] = lab.a;
      fB[i] = lab.b;
    }
  }

  // ------------------------------------------------------------------
  // Step 2: K-means++ initialisation.
  // ------------------------------------------------------------------
  const K = Math.min(k, N);

  const cX = new Float64Array(K);
  const cY = new Float64Array(K);
  const cL = new Float64Array(K);
  const cA = new Float64Array(K);
  const cBv = new Float64Array(K);

  const first = Math.floor(Math.random() * N);
  cX[0] = fx[first];
  cY[0] = fy[first];
  cL[0] = fL[first];
  cA[0] = fA[first];
  cBv[0] = fB[first];

  const d2 = new Float64Array(N).fill(Infinity);

  for (let ci = 1; ci < K; ci++) {
    const px0 = cX[ci - 1],
      py0 = cY[ci - 1];
    const pL0 = cL[ci - 1],
      pA0 = cA[ci - 1],
      pB0 = cBv[ci - 1];
    for (let i = 0; i < N; i++) {
      const dx = fx[i] - px0,
        dy = fy[i] - py0;
      const dL = fL[i] - pL0,
        dAv = fA[i] - pA0,
        dBv2 = fB[i] - pB0;
      const dist2 = dx * dx + dy * dy + dL * dL + dAv * dAv + dBv2 * dBv2;
      if (dist2 < d2[i]) d2[i] = dist2;
    }
    let total = 0;
    for (let i = 0; i < N; i++) total += d2[i];
    let rnd = Math.random() * total;
    let chosen = N - 1;
    for (let i = 0; i < N; i++) {
      rnd -= d2[i];
      if (rnd <= 0) {
        chosen = i;
        break;
      }
    }
    cX[ci] = fx[chosen];
    cY[ci] = fy[chosen];
    cL[ci] = fL[chosen];
    cA[ci] = fA[chosen];
    cBv[ci] = fB[chosen];
  }

  // ------------------------------------------------------------------
  // Step 3: K-means iterations.
  // ------------------------------------------------------------------
  const labels = new Int32Array(N);

  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < N; i++) {
      let best = 0,
        bestD = Infinity;
      for (let ci = 0; ci < K; ci++) {
        const dx = fx[i] - cX[ci],
          dy = fy[i] - cY[ci];
        const dL = fL[i] - cL[ci],
          dAv = fA[i] - cA[ci],
          dBv2 = fB[i] - cBv[ci];
        const d = dx * dx + dy * dy + dL * dL + dAv * dAv + dBv2 * dBv2;
        if (d < bestD) {
          bestD = d;
          best = ci;
        }
      }
      labels[i] = best;
    }

    const sumX = new Float64Array(K),
      sumY = new Float64Array(K);
    const sumL = new Float64Array(K),
      sumA = new Float64Array(K),
      sumBv = new Float64Array(K);
    const count = new Int32Array(K);
    for (let i = 0; i < N; i++) {
      const ci = labels[i];
      sumX[ci] += fx[i];
      sumY[ci] += fy[i];
      sumL[ci] += fL[i];
      sumA[ci] += fA[i];
      sumBv[ci] += fB[i];
      count[ci]++;
    }
    for (let ci = 0; ci < K; ci++) {
      const n = count[ci];
      if (n > 0) {
        cX[ci] = sumX[ci] / n;
        cY[ci] = sumY[ci] / n;
        cL[ci] = sumL[ci] / n;
        cA[ci] = sumA[ci] / n;
        cBv[ci] = sumBv[ci] / n;
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Compute per-cluster mean OKLab colour and pixel counts.
  //         Drop empty clusters and remap labels to compact indices.
  // ------------------------------------------------------------------
  const finalSumL = new Float64Array(K);
  const finalSumA = new Float64Array(K);
  const finalSumBv = new Float64Array(K);
  const finalCount = new Int32Array(K);
  for (let i = 0; i < N; i++) {
    const ci = labels[i];
    finalSumL[ci] += fL[i];
    finalSumA[ci] += fA[i];
    finalSumBv[ci] += fB[i];
    finalCount[ci]++;
  }

  const remap = new Int32Array(K).fill(-1);
  const points: Point3[] = [];
  const weights: number[] = [];
  for (let ci = 0; ci < K; ci++) {
    const n = finalCount[ci];
    if (n === 0) continue;
    remap[ci] = points.length;
    points.push([finalSumL[ci] / n, finalSumA[ci] / n, finalSumBv[ci] / n]);
    weights.push(n);
  }

  for (let i = 0; i < N; i++) {
    const mapped = remap[labels[i]];
    labels[i] = mapped >= 0 ? mapped : 0;
  }

  // ------------------------------------------------------------------
  // Step 5: Background detection — corner-adjacency heuristic.
  // ------------------------------------------------------------------
  const touchesTop = new Set<number>();
  const touchesBottom = new Set<number>();
  const touchesLeft = new Set<number>();
  const touchesRight = new Set<number>();

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
    ...touchesTop,
    ...touchesBottom,
    ...touchesLeft,
    ...touchesRight,
  ]);
  for (const lbl of allBorderLabels) {
    const tT = touchesTop.has(lbl),
      tBo = touchesBottom.has(lbl);
    const tL = touchesLeft.has(lbl),
      tR = touchesRight.has(lbl);
    if ((tT && tL) || (tT && tR) || (tBo && tL) || (tBo && tR)) {
      backgroundLabels.add(lbl);
    }
  }

  return { points, weights, labels, backgroundLabels };
}
