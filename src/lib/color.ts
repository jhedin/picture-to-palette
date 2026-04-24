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

/**
 * Given two anchor colours, find which palette colours fall *between* them
 * along the A→B line in OKLab space (projection t strictly in (0, 1)),
 * then sort the filtered set according to `mode`:
 *
 *   natural    — sort by position along the OKLab A→B vector (default)
 *   lightness  — sort by L, ascending from A's lightness toward B's
 *   saturation — sort by OKLCH chroma C, ascending from A's toward B's
 *   hue        — sort by hue angle, taking the shorter arc from A to B
 *
 * The full gradient sequence is: [anchorA, ...gradientBetween(...), anchorB]
 */
export function gradientBetween(
  palette: string[],
  anchorA: string,
  anchorB: string,
  mode: GradientMode = "natural",
): string[] {
  const a = hexToOklab(anchorA);
  const b = hexToOklab(anchorB);
  const ab = { L: b.L - a.L, a: b.a - a.a, b: b.b - a.b };
  const abLenSq = ab.L * ab.L + ab.a * ab.a + ab.b * ab.b;
  if (abLenSq === 0) return [];

  const normA = normalizeHex(anchorA);
  const normB = normalizeHex(anchorB);

  // Filter: only colours whose OKLab projection lands strictly between A and B.
  const candidates = palette
    .map(normalizeHex)
    .filter((h): h is string => h !== null && h !== normA && h !== normB)
    .map((hex) => {
      const lab = hexToOklab(hex);
      const ap = { L: lab.L - a.L, a: lab.a - a.a, b: lab.b - a.b };
      const t = (ap.L * ab.L + ap.a * ab.a + ap.b * ab.b) / abLenSq;
      return { hex, t, lab };
    })
    .filter(({ t }) => t > 0 && t < 1);

  // Sort according to mode.
  if (mode === "natural") {
    candidates.sort((x, y) => x.t - y.t);

  } else if (mode === "lightness") {
    const asc = a.L <= b.L;
    candidates.sort((x, y) => asc ? x.lab.L - y.lab.L : y.lab.L - x.lab.L);

  } else if (mode === "saturation") {
    const chromaOf = (lab: Oklab) => Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    const asc = chromaOf(a) <= chromaOf(b);
    candidates.sort((x, y) =>
      asc ? chromaOf(x.lab) - chromaOf(y.lab) : chromaOf(y.lab) - chromaOf(x.lab),
    );

  } else if (mode === "hue") {
    const hueOf = (lab: Oklab) => Math.atan2(lab.b, lab.a) * (180 / Math.PI);
    const hA = hueOf(a);
    const hB = hueOf(b);
    // Signed angular difference hA→hB on the shorter arc (−180..180).
    const diff = ((hB - hA + 540) % 360) - 180;
    candidates.sort((x, y) => {
      // Project each hue onto the arc from hA in the direction of diff.
      const tx = ((hueOf(x.lab) - hA) * Math.sign(diff) + 720) % 360;
      const ty = ((hueOf(y.lab) - hA) * Math.sign(diff) + 720) % 360;
      return tx - ty;
    });
  }

  return candidates.map(({ hex }) => hex);
}
