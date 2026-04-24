import { meanShift, estimateBandwidth, type Point3 } from "./mean-shift";
import { hexToOklab, oklabToHex } from "./color";

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

const TARGET_DIM = 128;

function downsample(src: ImageData): ImageData {
  if (src.width <= TARGET_DIM && src.height <= TARGET_DIM) return src;
  const scale = TARGET_DIM / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  const stepX = src.width / w;
  const stepY = src.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x * stepX));
      const sy = Math.min(src.height - 1, Math.floor(y * stepY));
      const sIdx = (sy * src.width + sx) * 4;
      const dIdx = (y * w + x) * 4;
      out[dIdx] = src.data[sIdx];
      out[dIdx + 1] = src.data[sIdx + 1];
      out[dIdx + 2] = src.data[sIdx + 2];
      out[dIdx + 3] = 255;
    }
  }
  return new ImageData(out, w, h);
}

function nearestCluster(point: Point3, clusters: Point3[]): number {
  let nearest = 0;
  let minD = Infinity;
  for (let j = 0; j < clusters.length; j++) {
    const dx = point[0] - clusters[j][0];
    const dy = point[1] - clusters[j][1];
    const dz = point[2] - clusters[j][2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < minD) { minD = d; nearest = j; }
  }
  return nearest;
}

export function extractPalette(image: ImageData): ExtractResult {
  const small = downsample(image);
  const points: Point3[] = [];
  for (let i = 0; i < small.data.length; i += 4) {
    const r = small.data[i];
    const g = small.data[i + 1];
    const b = small.data[i + 2];
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    const lab = hexToOklab(hex);
    points.push([lab.L, lab.a, lab.b]);
  }
  if (points.length === 0) {
    return {
      hexes: [],
      debug: { segPixels: new Uint8ClampedArray(0), segWidth: 0, segHeight: 0, clusterSizes: [], bandwidth: 0 },
    };
  }
  const bandwidth = Math.max(0.05, estimateBandwidth(points, 0.2));
  const clusters = meanShift(points, { bandwidth, minBinFreq: 3 });
  const hexes = clusters.map((c) => oklabToHex({ L: c[0], a: c[1], b: c[2] }));

  // Build per-pixel segmentation image
  const clusterSizes = new Array<number>(clusters.length).fill(0);
  const segPixels = new Uint8ClampedArray(small.data.length);
  for (let i = 0; i < points.length; i++) {
    const ci = nearestCluster(points[i], clusters);
    clusterSizes[ci]++;
    const hex = hexes[ci];
    segPixels[i * 4] = parseInt(hex.slice(1, 3), 16);
    segPixels[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    segPixels[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    segPixels[i * 4 + 3] = 255;
  }

  return { hexes, debug: { segPixels, segWidth: small.width, segHeight: small.height, clusterSizes, bandwidth } };
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
