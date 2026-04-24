import { hexToOklab } from "./color";
import type { Point3 } from "./mean-shift";

/**
 * Joint spatial-color mean-shift segmentation (EDISON-style).
 *
 * Operates in 5D space (xNorm, yNorm, L, a, b) so that clusters are
 * automatically spatially coherent: same-color pixels in different parts of
 * the image will NOT merge.  Produces large, boundary-respecting regions
 * suitable for yarn/wool photos.
 */
export function spatialMeanShift(
  img: ImageData,
  opts?: {
    spatialBandwidth?: number;
    colorBandwidth?: number;
    minRegionSize?: number;
    maxIter?: number;
  },
): { points: Point3[]; labels: Int32Array; backgroundLabels: Set<number> } {
  const spatialBandwidth = opts?.spatialBandwidth ?? 16;
  const colorBandwidth = opts?.colorBandwidth ?? 0.12;
  const minRegionSize = opts?.minRegionSize ?? 50;
  const maxIter = opts?.maxIter ?? 30;

  const { width: W, height: H, data } = img;
  const N = W * H;
  const maxDim = Math.max(W, H);

  // Normalized spatial bandwidth in [0,1] coordinates
  const hSpatial = spatialBandwidth / maxDim;
  const hSpatial2 = hSpatial * hSpatial;
  const hColor2 = colorBandwidth * colorBandwidth;

  if (N === 0) {
    return { points: [], labels: new Int32Array(0), backgroundLabels: new Set() };
  }

  // ----- Step 1: Convert all pixels to OKLab -----
  const labL = new Float32Array(N);
  const labA = new Float32Array(N);
  const labB = new Float32Array(N);
  const xNorm = new Float32Array(N);
  const yNorm = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const px = i % W;
    const py = (i / W) | 0;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    const lab = hexToOklab(hex);
    labL[i] = lab.L;
    labA[i] = lab.a;
    labB[i] = lab.b;
    xNorm[i] = px / maxDim;
    yNorm[i] = py / maxDim;
  }

  // ----- Step 2: Build spatial grid for fast neighbor lookup -----
  // Cell size matches the spatial bandwidth so each cell covers one kernel radius.
  const cellSize = hSpatial; // in normalized units
  const gridCols = Math.ceil(1.0 / cellSize) + 1;
  const gridRows = Math.ceil(H / maxDim / cellSize) + 1;

  // Map from cell index to list of pixel indices
  const grid: number[][] = new Array(gridCols * gridRows).fill(null).map(() => []);

  function cellOf(xn: number, yn: number): number {
    const col = Math.floor(xn / cellSize);
    const row = Math.floor(yn / cellSize);
    const c = Math.max(0, Math.min(gridCols - 1, col));
    const r = Math.max(0, Math.min(gridRows - 1, row));
    return r * gridCols + c;
  }

  for (let i = 0; i < N; i++) {
    grid[cellOf(xNorm[i], yNorm[i])].push(i);
  }

  // ----- Step 3: Mean-shift each pixel to its mode -----
  // Store converged mode for each pixel (5 components)
  const modeX = new Float32Array(N);
  const modeY = new Float32Array(N);
  const modeL = new Float32Array(N);
  const modeAv = new Float32Array(N);
  const modeBv = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    let cx = xNorm[i];
    let cy = yNorm[i];
    let cL = labL[i];
    let cA = labA[i];
    let cBv = labB[i];

    for (let iter = 0; iter < maxIter; iter++) {
      // Determine which grid cells to check (3x3 neighborhood of current center)
      const col0 = Math.max(0, Math.floor((cx - hSpatial) / cellSize));
      const col1 = Math.min(gridCols - 1, Math.floor((cx + hSpatial) / cellSize));
      const row0 = Math.max(0, Math.floor((cy - hSpatial) / cellSize));
      const row1 = Math.min(gridRows - 1, Math.floor((cy + hSpatial) / cellSize));

      let sx = 0, sy = 0, sL = 0, sA = 0, sBv = 0, n = 0;

      for (let gr = row0; gr <= row1; gr++) {
        for (let gc = col0; gc <= col1; gc++) {
          const cell = grid[gr * gridCols + gc];
          for (let k = 0; k < cell.length; k++) {
            const j = cell[k];
            // Check spatial distance in normalized coords
            const dxj = xNorm[j] - cx;
            const dyj = yNorm[j] - cy;
            if (dxj * dxj + dyj * dyj > hSpatial2) continue;
            // Check color distance
            const dL = labL[j] - cL;
            const dA = labA[j] - cA;
            const dBj = labB[j] - cBv;
            if (dL * dL + dA * dA + dBj * dBj > hColor2) continue;
            sx += xNorm[j]; sy += yNorm[j];
            sL += labL[j]; sA += labA[j]; sBv += labB[j];
            n++;
          }
        }
      }

      if (n === 0) break;

      const nx = sx / n, ny = sy / n;
      const nL = sL / n, nA = sA / n, nBv = sBv / n;

      const dx = nx - cx, dy = ny - cy;
      const dL = nL - cL, dA = nA - cA, dBv = nBv - cBv;
      const moved = dx * dx + dy * dy + dL * dL + dA * dA + dBv * dBv;

      cx = nx; cy = ny;
      cL = nL; cA = nA; cBv = nBv;

      if (moved < 1e-6) break;
    }

    modeX[i] = cx;
    modeY[i] = cy;
    modeL[i] = cL;
    modeAv[i] = cA;
    modeBv[i] = cBv;
  }

  // ----- Step 4: Cluster converged modes then assign connected components -----
  //
  // Two modes that are within half the color bandwidth of each other represent
  // the same color class.  We assign each pixel a color-class id, then run a
  // flood-fill (connected-components) over the pixel grid so that spatially
  // disconnected patches of the same color class become separate regions.

  const halfColor2 = hColor2 * 0.25;

  // Assign color-class id to each pixel using sequential mode clustering on
  // color only (ignore spatial component here — spatial coherence is handled
  // by the connected-component step below).
  const colorClass = new Int32Array(N).fill(-1);
  const ccModeL: number[] = [];
  const ccModeA: number[] = [];
  const ccModeBv: number[] = [];

  for (let i = 0; i < N; i++) {
    let found = -1;
    for (let ci = 0; ci < ccModeL.length; ci++) {
      const dL = modeL[i] - ccModeL[ci];
      const dA = modeAv[i] - ccModeA[ci];
      const dBv = modeBv[i] - ccModeBv[ci];
      if (dL * dL + dA * dA + dBv * dBv <= halfColor2) {
        found = ci;
        break;
      }
    }
    if (found === -1) {
      found = ccModeL.length;
      ccModeL.push(modeL[i]);
      ccModeA.push(modeAv[i]);
      ccModeBv.push(modeBv[i]);
    }
    colorClass[i] = found;
  }

  // Connected-components flood fill: pixels that are 4-connected AND share
  // the same color class get the same region label.
  const labels = new Int32Array(N).fill(-1);
  let nextLabel = 0;

  for (let start = 0; start < N; start++) {
    if (labels[start] !== -1) continue;
    const targetClass = colorClass[start];
    const label = nextLabel++;
    const stack = [start];
    labels[start] = label;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % W;
      const y = (idx / W) | 0;
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < W - 1 ? idx + 1 : -1,
        y > 0 ? idx - W : -1,
        y < H - 1 ? idx + W : -1,
      ];
      for (const ni of neighbors) {
        if (ni < 0 || labels[ni] !== -1) continue;
        if (colorClass[ni] !== targetClass) continue;
        labels[ni] = label;
        stack.push(ni);
      }
    }
  }

  // ----- Step 5: Compute per-region means -----
  const numLabels = nextLabel;
  const sumL = new Float64Array(numLabels);
  const sumA = new Float64Array(numLabels);
  const sumBv = new Float64Array(numLabels);
  const count = new Int32Array(numLabels);

  for (let i = 0; i < N; i++) {
    const ci = labels[i];
    sumL[ci] += labL[i];
    sumA[ci] += labA[i];
    sumBv[ci] += labB[i];
    count[ci]++;
  }

  // ----- Step 6: Merge small regions -----
  // Small regions (< minRegionSize) are reassigned to their spatially nearest
  // neighbor label (by checking adjacent pixels).
  let changed = true;
  const maxPass = 5;
  for (let pass = 0; pass < maxPass && changed; pass++) {
    changed = false;
    for (let i = 0; i < N; i++) {
      const ci = labels[i];
      if (count[ci] >= minRegionSize) continue;

      // Find adjacent label with the largest region
      const x = i % W;
      const y = (i / W) | 0;
      let bestNeighbor = -1;
      let bestCount = -1;

      const tryNeighbor = (ni: number) => {
        const nl = labels[ni];
        if (nl !== ci && count[nl] > bestCount) {
          bestCount = count[nl];
          bestNeighbor = nl;
        }
      };

      if (x > 0) tryNeighbor(i - 1);
      if (x < W - 1) tryNeighbor(i + 1);
      if (y > 0) tryNeighbor(i - W);
      if (y < H - 1) tryNeighbor(i + W);

      if (bestNeighbor !== -1) {
        // Move pixel i from ci to bestNeighbor
        sumL[ci] -= labL[i]; sumA[ci] -= labA[i]; sumBv[ci] -= labB[i]; count[ci]--;
        sumL[bestNeighbor] += labL[i]; sumA[bestNeighbor] += labA[i]; sumBv[bestNeighbor] += labB[i]; count[bestNeighbor]++;
        labels[i] = bestNeighbor;
        changed = true;
      }
    }
  }

  // ----- Step 7: Build compact label set -----
  const remap = new Int32Array(numLabels).fill(-1);
  const points: Point3[] = [];
  for (let ci = 0; ci < numLabels; ci++) {
    const n = count[ci];
    if (n <= 0) continue;
    remap[ci] = points.length;
    points.push([sumL[ci] / n, sumA[ci] / n, sumBv[ci] / n]);
  }
  for (let i = 0; i < N; i++) {
    labels[i] = labels[i] >= 0 ? remap[labels[i]] : 0;
  }

  // ----- Step 8: Background detection -----
  // Segments owning ≥8% of border pixels are considered background.
  const borderCount = new Map<number, number>();
  let totalBorder = 0;

  const addBorder = (lbl: number) => {
    borderCount.set(lbl, (borderCount.get(lbl) ?? 0) + 1);
    totalBorder++;
  };

  for (let x = 0; x < W; x++) {
    addBorder(labels[x]);                      // top row
    addBorder(labels[(H - 1) * W + x]);       // bottom row
  }
  for (let y = 1; y < H - 1; y++) {
    addBorder(labels[y * W]);                  // left col
    addBorder(labels[y * W + W - 1]);         // right col
  }

  const backgroundLabels = new Set<number>();
  const threshold = 0.08 * totalBorder;
  for (const [lbl, cnt] of borderCount) {
    if (cnt >= threshold) backgroundLabels.add(lbl);
  }

  return { points, labels, backgroundLabels };
}
