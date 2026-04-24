import { hexToOklab } from "./color";
import type { Point3 } from "./mean-shift";

/**
 * SLIC superpixel segmentation (Simple Linear Iterative Clustering).
 *
 * Groups spatially adjacent, color-similar pixels into K compact regions.
 * Returns the mean OKLab color per superpixel and the per-pixel label map.
 * Running mean-shift on these ~K representative colors instead of all N
 * pixels reduces noise from texture/shadow and gives small color areas
 * (e.g. a single yarn skein) their own representative before clustering.
 *
 * Distance metric: D² = d_c² + m² * (d_s / S)²
 *   d_c = OKLab Euclidean distance (color term)
 *   d_s = pixel Euclidean distance (spatial term)
 *   S   = grid spacing = sqrt(N / K)
 *   m   = compactness (higher → more square superpixels)
 */
export function slicSuperpixels(
  img: ImageData,
  K = 50,
  m = 10,
  iters = 10,
): { points: Point3[]; weights: number[]; labels: Int32Array; backgroundLabels: Set<number> } {
  const { width: W, height: H, data } = img;
  const N = W * H;
  const S = Math.sqrt(N / K);

  // Pre-convert all pixels to OKLab
  const labL = new Float32Array(N);
  const labA = new Float32Array(N);
  const labB = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    const lab = hexToOklab(hex);
    labL[i] = lab.L; labA[i] = lab.a; labB[i] = lab.b;
  }

  // Seed cluster centers on a regular grid
  const cL: number[] = [], cA: number[] = [], cB: number[] = [];
  const cX: number[] = [], cY: number[] = [];
  for (let gy = S / 2; gy < H; gy += S) {
    for (let gx = S / 2; gx < W; gx += S) {
      const px = Math.min(W - 1, Math.round(gx));
      const py = Math.min(H - 1, Math.round(gy));
      const i = py * W + px;
      cL.push(labL[i]); cA.push(labA[i]); cB.push(labB[i]);
      cX.push(gx); cY.push(gy);
    }
  }
  const C = cL.length;

  const labels = new Int32Array(N).fill(-1);
  const bestDist = new Float32Array(N).fill(1e9);

  for (let iter = 0; iter < iters; iter++) {
    bestDist.fill(1e9);

    for (let ci = 0; ci < C; ci++) {
      const x0 = Math.max(0, Math.floor(cX[ci] - S));
      const x1 = Math.min(W - 1, Math.ceil(cX[ci] + S));
      const y0 = Math.max(0, Math.floor(cY[ci] - S));
      const y1 = Math.min(H - 1, Math.ceil(cY[ci] + S));

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x;
          const dL = labL[i] - cL[ci], dA = labA[i] - cA[ci], dBv = labB[i] - cB[ci];
          const dx = x - cX[ci], dy = y - cY[ci];
          const dc2 = dL * dL + dA * dA + dBv * dBv;
          const ds2 = (dx * dx + dy * dy) / (S * S);
          const D2 = dc2 + m * m * ds2;
          if (D2 < bestDist[i]) {
            bestDist[i] = D2;
            labels[i] = ci;
          }
        }
      }
    }

    // Update centers
    const sumL = new Float64Array(C), sumA = new Float64Array(C), sumBv = new Float64Array(C);
    const sumX = new Float64Array(C), sumY = new Float64Array(C);
    const count = new Int32Array(C);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const ci = labels[i];
        if (ci < 0) continue;
        sumL[ci] += labL[i]; sumA[ci] += labA[i]; sumBv[ci] += labB[i];
        sumX[ci] += x; sumY[ci] += y;
        count[ci]++;
      }
    }
    for (let ci = 0; ci < C; ci++) {
      const n = count[ci];
      if (n > 0) {
        cL[ci] = sumL[ci] / n; cA[ci] = sumA[ci] / n; cB[ci] = sumBv[ci] / n;
        cX[ci] = sumX[ci] / n; cY[ci] = sumY[ci] / n;
      }
    }
  }

  // Collect non-empty superpixels; recompute final means from label map
  const sumL = new Float64Array(C), sumA = new Float64Array(C), sumBv = new Float64Array(C);
  const count = new Int32Array(C);
  for (let i = 0; i < N; i++) {
    const ci = labels[i];
    if (ci < 0) continue;
    sumL[ci] += labL[i]; sumA[ci] += labA[i]; sumBv[ci] += labB[i];
    count[ci]++;
  }

  // Build compact index: old center id → new superpixel index
  const remap = new Int32Array(C).fill(-1);
  const points: Point3[] = [];
  const weights: number[] = [];
  for (let ci = 0; ci < C; ci++) {
    const n = count[ci];
    if (n === 0) continue;
    remap[ci] = points.length;
    points.push([sumL[ci] / n, sumA[ci] / n, sumBv[ci] / n]);
    weights.push(n);
  }

  // Remap labels to compact superpixel indices
  for (let i = 0; i < N; i++) {
    labels[i] = labels[i] >= 0 ? remap[labels[i]] : 0;
  }

  // Background detection: segments that touch two adjacent sides of the image
  // border (i.e. they wrap around a corner) are very likely background.
  // Segments that only touch parallel sides (top+bottom or left+right) are
  // Count how many border pixels each segment covers.  A segment must own
  // at least MIN_BORDER_FRAC of the total border perimeter to be considered
  // a background seed.  This excludes foreground objects that happen to clip
  // one edge of the image (e.g. a yarn skein placed at the left border) while
  // still including the large, wrap-around background region.
  const MIN_BORDER_FRAC = 0.08;
  const borderCount = new Map<number, number>();
  const addBorder = (lbl: number) => {
    if (lbl >= 0) borderCount.set(lbl, (borderCount.get(lbl) ?? 0) + 1);
  };
  for (let x = 0; x < W; x++) {
    addBorder(labels[x]);
    addBorder(labels[(H - 1) * W + x]);
  }
  for (let y = 0; y < H; y++) {
    addBorder(labels[y * W]);
    addBorder(labels[y * W + W - 1]);
  }
  const totalBorderPixels = 2 * (W + H) - 4;
  const minBorderPixels = Math.max(1, Math.round(MIN_BORDER_FRAC * totalBorderPixels));
  const backgroundLabels = new Set<number>();
  for (const [lbl, count] of borderCount) {
    if (count >= minBorderPixels) backgroundLabels.add(lbl);
  }

  return { points, weights, labels, backgroundLabels };
}
