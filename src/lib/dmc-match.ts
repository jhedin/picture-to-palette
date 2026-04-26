import { hexToOklab, shadeRamp, gradientBetween, type Oklab } from "./color";
import { DMC_COLORS, type DmcColor } from "./dmc-colors";

// Cache OKLab values for the full DMC palette so repeated lookups are O(n)
// rather than O(n × colorjs conversions).
interface DmcEntry {
  color: DmcColor;
  lab: Oklab;
}

let _cache: DmcEntry[] | null = null;
function dmcEntries(): DmcEntry[] {
  if (!_cache) {
    _cache = DMC_COLORS.map((color) => ({ color, lab: hexToOklab(color.hex) }));
  }
  return _cache;
}

function oklabDist(a: Oklab, b: Oklab): number {
  const dL = a.L - b.L, da = a.a - b.a, db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Find the single nearest DMC thread to a given hex color by OKLab
 * Euclidean distance (perceptually uniform).
 */
export function nearestDmc(hex: string): DmcColor {
  const target = hexToOklab(hex);
  const entries = dmcEntries();
  let best = entries[0];
  let bestDist = oklabDist(target, best.lab);
  for (let i = 1; i < entries.length; i++) {
    const d = oklabDist(target, entries[i].lab);
    if (d < bestDist) { bestDist = d; best = entries[i]; }
  }
  return best.color;
}

/**
 * Map an array of hex colors to their nearest DMC thread each.
 * Deduplicates: if two input colors both map to the same DMC thread,
 * only the first is kept in the output.
 */
export function matchToDmc(hexes: string[]): DmcColor[] {
  const seen = new Set<string>();
  const result: DmcColor[] = [];
  for (const hex of hexes) {
    const match = nearestDmc(hex);
    if (!seen.has(match.id)) {
      seen.add(match.id);
      result.push(match);
    }
  }
  return result;
}

/**
 * Expand a set of DMC colors by finding shade-ramp neighbors within the
 * full DMC palette.  For each base color, finds the nearest DMC thread in
 * the shadow direction (cooler, darker) and highlight direction (warmer,
 * lighter) using the same hue-shift parameters as shadeRamp.
 *
 * Returns the unique union of the input set and all discovered neighbors,
 * preserving input order then appending new colors.
 */
export function expandDmcPalette(base: DmcColor[], stepsPerColor = 1): DmcColor[] {
  const dmcHexes = DMC_COLORS.map((d) => d.hex);
  const seen = new Set<string>(base.map((d) => d.id));
  const result: DmcColor[] = [...base];

  for (const dmc of base) {
    const { shadows, highlights } = shadeRamp(dmcHexes, dmc.hex, stepsPerColor);
    for (const hex of [...shadows, ...highlights]) {
      const match = nearestDmc(hex);
      if (!seen.has(match.id)) {
        seen.add(match.id);
        result.push(match);
      }
    }
  }
  return result;
}

// A preferred thread is accepted even if it's up to this many times farther
// than the globally nearest match — avoids adding new threads unnecessarily.
const PREFERRED_TOLERANCE_SQ = 1.5 * 1.5; // compare squared distances

/**
 * Return the k DMC threads closest to evenly-spaced OKLab positions along
 * the straight line from anchorA to anchorB.  Greedy: each picked thread is
 * excluded from subsequent picks so the result has no duplicates.
 *
 * Pass `preferred` (e.g. the user's already-matched dmcSet hexes) to bias the
 * algorithm toward reusing existing threads before pulling new ones.
 */
export function idealDmcPositions(
  anchorA: string,
  anchorB: string,
  k: number,
  exclude: Iterable<string> = [],
  preferred: Set<string> = new Set(),
): string[] {
  if (k <= 0) return [];
  const aLab = hexToOklab(anchorA);
  const bLab = hexToOklab(anchorB);
  const entries = dmcEntries();
  const used = new Set(exclude);
  const result: string[] = [];
  for (let i = 1; i <= k; i++) {
    const t = i / (k + 1);
    const ideal = {
      L: aLab.L + t * (bLab.L - aLab.L),
      a: aLab.a + t * (bLab.a - aLab.a),
      b: aLab.b + t * (bLab.b - aLab.b),
    };
    let bestDistSq = Infinity, bestHex: string | null = null;
    let prefDistSq = Infinity, prefHex: string | null = null;
    for (const { color, lab } of entries) {
      if (used.has(color.hex)) continue;
      const dSq = (lab.L - ideal.L) ** 2 + (lab.a - ideal.a) ** 2 + (lab.b - ideal.b) ** 2;
      if (dSq < bestDistSq) { bestDistSq = dSq; bestHex = color.hex; }
      if (preferred.has(color.hex) && dSq < prefDistSq) { prefDistSq = dSq; prefHex = color.hex; }
    }
    const chosen = (prefHex && prefDistSq <= bestDistSq * PREFERRED_TOLERANCE_SQ) ? prefHex : bestHex;
    if (chosen) { used.add(chosen); result.push(chosen); }
  }
  return result;
}

/**
 * Find the nearest unused DMC thread to an arbitrary OKLab position.
 * Used when filling the largest perceptual gap in a sequence.
 *
 * Pass `preferred` to bias toward reusing existing threads.
 */
export function nearestUnusedDmc(
  ideal: { L: number; a: number; b: number },
  exclude: Set<string>,
  preferred: Set<string> = new Set(),
): DmcColor | null {
  const entries = dmcEntries();
  let best: DmcColor | null = null, bestDistSq = Infinity;
  let prefBest: DmcColor | null = null, prefDistSq = Infinity;
  for (const { color, lab } of entries) {
    if (exclude.has(color.hex)) continue;
    const dSq = (lab.L - ideal.L) ** 2 + (lab.a - ideal.a) ** 2 + (lab.b - ideal.b) ** 2;
    if (dSq < bestDistSq) { bestDistSq = dSq; best = color; }
    if (preferred.has(color.hex) && dSq < prefDistSq) { prefDistSq = dSq; prefBest = color; }
  }
  return (prefBest && prefDistSq <= bestDistSq * PREFERRED_TOLERANCE_SQ) ? prefBest : best;
}

/**
 * Given a sorted gradient sequence, find DMC threads from the full catalog
 * that lie perceptually between each adjacent pair and are not already in
 * `knownHexes`.  Returns new candidate threads to offer as shelf additions.
 */
export function findDmcBridges(
  sequence: string[],
  knownHexes: string[] = [],
): DmcColor[] {
  if (sequence.length < 2) return [];
  const allHexes = DMC_COLORS.map((d) => d.hex);
  const known = new Set([...sequence, ...knownHexes]);
  const foundHex = new Set<string>();
  const result: DmcColor[] = [];

  for (let i = 0; i < sequence.length - 1; i++) {
    const between = gradientBetween(allHexes, sequence[i], sequence[i + 1]);
    for (const hex of between) {
      if (!known.has(hex) && !foundHex.has(hex)) {
        foundHex.add(hex);
        const dmc = DMC_COLORS.find((d) => d.hex === hex);
        if (dmc) result.push(dmc);
      }
    }
  }
  return result;
}
