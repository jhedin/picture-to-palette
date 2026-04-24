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

/**
 * Given two anchor colours, find which palette colours fall *between* them
 * along the A→B line in OKLab space (projection t strictly in (0, 1)),
 * sorted from A toward B.
 *
 * The full gradient sequence is: [anchorA, ...gradientBetween(...), anchorB]
 *
 * Only colours that are genuinely intermediate are returned — colours that
 * project outside the A–B segment (before A or past B) are excluded.
 */
export function gradientBetween(
  palette: string[],
  anchorA: string,
  anchorB: string,
): string[] {
  const a = hexToOklab(anchorA);
  const b = hexToOklab(anchorB);
  const ab = { L: b.L - a.L, a: b.a - a.a, b: b.b - a.b };
  const abLenSq = ab.L * ab.L + ab.a * ab.a + ab.b * ab.b;
  if (abLenSq === 0) return [];

  const normA = normalizeHex(anchorA);
  const normB = normalizeHex(anchorB);

  return palette
    .map(normalizeHex)
    .filter((h): h is string => h !== null && h !== normA && h !== normB)
    .map((hex) => {
      const p = hexToOklab(hex);
      const ap = { L: p.L - a.L, a: p.a - a.a, b: p.b - a.b };
      const t = (ap.L * ab.L + ap.a * ab.a + ap.b * ab.b) / abLenSq;
      return { hex, t };
    })
    .filter(({ t }) => t > 0 && t < 1)   // strictly between the anchors
    .sort((x, y) => x.t - y.t)
    .map(({ hex }) => hex);
}
