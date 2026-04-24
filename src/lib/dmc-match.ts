import { hexToOklab, shadeRamp, type Oklab } from "./color";
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
