import Color from "colorjs.io";

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export interface Oklch {
  L: number;
  C: number;
  h: number;
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = HEX_RE.exec(value);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${hex.toUpperCase()}`;
}

export function hexToOklab(hex: string): Oklab {
  const c = new Color(hex).to("oklab");
  const [L, a, b] = c.coords;
  return { L, a, b };
}

export function hexToOklch(hex: string): Oklch {
  const c = new Color(hex).to("oklch");
  const [L, C, h] = c.coords;
  return { L, C, h: Number.isNaN(h) ? 0 : h };
}

export function oklabToHex(lab: Oklab): string {
  const c = new Color("oklab", [lab.L, lab.a, lab.b]).to("srgb");
  return normalizeHex(c.toString({ format: "hex" }))!;
}

export function deltaE00(hexA: string, hexB: string): number {
  const a = new Color(hexA);
  const b = new Color(hexB);
  return a.deltaE(b, "2000");
}

export function dedupByDeltaE(hexes: string[], threshold: number): string[] {
  const out: string[] = [];
  for (const raw of hexes) {
    const hex = normalizeHex(raw);
    if (!hex) continue;
    const tooClose = out.some((kept) => deltaE00(kept, hex) < threshold);
    if (!tooClose) out.push(hex);
  }
  return out;
}

export type GradientMode = "natural" | "lightness" | "saturation" | "hue";

const hueOf = (lab: Oklab) => Math.atan2(lab.b, lab.a) * (180 / Math.PI);
const chromaOf = (lab: Oklab) => Math.sqrt(lab.a * lab.a + lab.b * lab.b);

// Max lateral distance from the A→B segment (as a fraction of segment length)
// allowed in "natural" mode.  Keeps candidates inside a cylinder rather than
// the full half-space, filtering out colours that project between the anchors
// but are far off-axis perceptually (e.g. a green between cream and tan).
export const NATURAL_PERP_THRESHOLD = 0.35;

/**
 * Given two anchor colours and a mode, return every palette colour that
 * falls *between* the anchors according to the mode's own axis, sorted
 * from A toward B along that axis.  Each mode uses a different filter
 * *and* a different sort so the candidate set genuinely changes.
 *
 *   natural    — OKLab projection t ∈ (0,1) AND perpendicular distance
 *                within NATURAL_PERP_THRESHOLD * |AB|; sorted by t
 *   lightness  — L strictly between LA and LB; sorted by L
 *   saturation — chroma C strictly between CA and CB; sorted by C
 *   hue        — hue h on the shorter arc hA→hB (exclusive); sorted by h
 *
 * Use pickEvenly(result, n) to select n colours spread across the sequence.
 * The full gradient is: [anchorA, ...pickEvenly(gradientBetween(...), n), anchorB]
 */
export function gradientBetween(
  palette: string[],
  anchorA: string,
  anchorB: string,
  mode: GradientMode = "natural",
): string[] {
  const a = hexToOklab(anchorA);
  const b = hexToOklab(anchorB);

  const normA = normalizeHex(anchorA);
  const normB = normalizeHex(anchorB);
  const base = palette
    .map(normalizeHex)
    .filter((h): h is string => h !== null && h !== normA && h !== normB)
    .map((hex) => ({ hex, lab: hexToOklab(hex) }));

  if (mode === "natural") {
    const ab = { L: b.L - a.L, a: b.a - a.a, b: b.b - a.b };
    const abLenSq = ab.L * ab.L + ab.a * ab.a + ab.b * ab.b;
    if (abLenSq === 0) return [];
    const maxPerpSq = NATURAL_PERP_THRESHOLD * NATURAL_PERP_THRESHOLD * abLenSq;
    return base
      .map(({ hex, lab }) => {
        const ap = { L: lab.L - a.L, a: lab.a - a.a, b: lab.b - a.b };
        const apLenSq = ap.L * ap.L + ap.a * ap.a + ap.b * ap.b;
        const t = (ap.L * ab.L + ap.a * ab.a + ap.b * ab.b) / abLenSq;
        const perpSq = apLenSq - t * t * abLenSq;
        return { hex, t, perpSq };
      })
      .filter(({ t, perpSq }) => t > 0 && t < 1 && perpSq < maxPerpSq)
      .sort((x, y) => x.t - y.t)
      .map(({ hex }) => hex);

  } else if (mode === "lightness") {
    const lo = Math.min(a.L, b.L), hi = Math.max(a.L, b.L);
    const asc = a.L <= b.L;
    return base
      .filter(({ lab }) => lab.L > lo && lab.L < hi)
      .sort((x, y) => asc ? x.lab.L - y.lab.L : y.lab.L - x.lab.L)
      .map(({ hex }) => hex);

  } else if (mode === "saturation") {
    const lo = Math.min(chromaOf(a), chromaOf(b));
    const hi = Math.max(chromaOf(a), chromaOf(b));
    const asc = chromaOf(a) <= chromaOf(b);
    return base
      .filter(({ lab }) => { const c = chromaOf(lab); return c > lo && c < hi; })
      .sort((x, y) => asc
        ? chromaOf(x.lab) - chromaOf(y.lab)
        : chromaOf(y.lab) - chromaOf(x.lab))
      .map(({ hex }) => hex);

  } else { // hue
    const hA = hueOf(a), hB = hueOf(b);
    // Signed arc hA→hB on the shorter path (−180..180); positive = clockwise.
    const diff = ((hB - hA + 540) % 360) - 180;
    return base
      .filter(({ lab }) => {
        // Angular distance from hA in the direction of the shorter arc.
        const pos = ((hueOf(lab) - hA) * Math.sign(diff) + 720) % 360;
        return pos > 0 && pos < Math.abs(diff);
      })
      .sort((x, y) => {
        const tx = ((hueOf(x.lab) - hA) * Math.sign(diff) + 720) % 360;
        const ty = ((hueOf(y.lab) - hA) * Math.sign(diff) + 720) % 360;
        return tx - ty;
      })
      .map(({ hex }) => hex);
  }
}

/**
 * Pick n colours evenly spaced across a sorted inbetween list.
 * For n=1: the middle colour.  For n=2: roughly ⅓ and ⅔ through.
 * Returns all colours if n >= list length.
 */
export function pickEvenly(sorted: string[], n: number): string[] {
  if (n <= 0 || sorted.length === 0) return [];
  if (n >= sorted.length) return sorted;
  const M = sorted.length;
  const result: string[] = [];
  for (let i = 0; i < n; i++) {
    // Divide M items into n equal bands; pick the midpoint of each band.
    // Floor guarantees unique indices since band width M/n >= 1.
    result.push(sorted[Math.floor((i + 0.5) * M / n)]);
  }
  return result;
}

export interface SwatchMeta {
  hex: string;
  L: number;
  C: number;
}

export function swatchMeta(hex: string): SwatchMeta {
  const { L, C } = hexToOklch(hex);
  return { hex, L: Math.round(L * 100) / 100, C: Math.round(C * 1000) / 1000 };
}

export interface OutlierResult {
  hex: string;
  isOutlier: boolean;
  lDev: number;
  cDev: number;
}

/**
 * Score each swatch in a gradient for how well it fits the linear L and C
 * trend.  Outliers have |deviation| > 1.5 SD from the linear regression.
 * Anchors (first and last) are never flagged.
 */
export function scoreGradientOutliers(gradient: string[]): OutlierResult[] {
  const n = gradient.length;
  if (n < 3) return gradient.map((hex) => ({ hex, isOutlier: false, lDev: 0, cDev: 0 }));

  const metas = gradient.map(swatchMeta);
  const xs = metas.map((_, i) => i);

  function linearResiduals(ys: number[]): number[] {
    const meanX = (n - 1) / 2;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;
    const ssX = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
    const slope = ssX === 0 ? 0 : xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0) / ssX;
    const intercept = meanY - slope * meanX;
    return ys.map((y, i) => y - (slope * i + intercept));
  }

  const lRes = linearResiduals(metas.map((m) => m.L));
  const cRes = linearResiduals(metas.map((m) => m.C));

  const sd = (vals: number[]) => {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  };

  const sdL = Math.max(0.005, sd(lRes));
  const sdC = Math.max(0.002, sd(cRes));

  return metas.map(({ hex }, i) => {
    // Never flag the anchor endpoints.
    const isOutlier = i > 0 && i < n - 1 &&
      (Math.abs(lRes[i]) > 1.5 * sdL || Math.abs(cRes[i]) > 1.5 * sdC);
    return { hex, isOutlier, lDev: lRes[i], cDev: cRes[i] };
  });
}
