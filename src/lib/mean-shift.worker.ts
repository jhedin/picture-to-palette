import { meanShift, estimateBandwidth, type Point3 } from "./mean-shift";
import { hexToOklab, oklabToHex } from "./color";

export interface ExtractRequest {
  type: "extract";
  imageData: ImageData;
}

export interface ExtractResponse {
  type: "result";
  hexes: string[];
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

export function extractPalette(image: ImageData): string[] {
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
  if (points.length === 0) return [];
  const bandwidth = Math.max(0.05, estimateBandwidth(points, 0.2));
  const clusters = meanShift(points, { bandwidth, minBinFreq: 3 });
  return clusters.map((c) => oklabToHex({ L: c[0], a: c[1], b: c[2] }));
}

// Web Worker entrypoint (only registers when running in a worker context).
if (typeof self !== "undefined" && typeof (self as unknown as Worker).postMessage === "function" && !("window" in self)) {
  const workerSelf = self as unknown as Worker;
  workerSelf.addEventListener("message", (e: MessageEvent<ExtractRequest>) => {
    if (e.data?.type === "extract") {
      const hexes = extractPalette(e.data.imageData);
      const response: ExtractResponse = { type: "result", hexes };
      workerSelf.postMessage(response);
    }
  });
}
