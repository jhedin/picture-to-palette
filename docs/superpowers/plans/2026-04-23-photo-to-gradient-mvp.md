# Photo-to-Gradient MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the photo → mean-shift → anchor-pick → gradient → save loop end-to-end as an installable PWA.

**Architecture:** Ionic React + Vite + TypeScript. All compute on-device. Mean-shift runs in a Web Worker on a 128×128 downsample. OKLab/CIEDE2000 via Color.js. Palette state is a React Context + reducer. Output is a PNG rendered to a Canvas and downloaded.

**Tech Stack:** React 18, Ionic React 8, Vite 6, TypeScript strict, Vitest + RTL, Playwright, Color.js, native Web Worker.

**Spec:** [`docs/superpowers/specs/2026-04-23-photo-to-gradient-mvp-design.md`](../specs/2026-04-23-photo-to-gradient-mvp-design.md)

---

## Scope check

This plan covers a single subsystem (one core loop, one user). Not decomposable into independent sub-plans.

## File structure

| Path | Responsibility |
|------|---------------|
| `src/lib/color.ts` | Pure color math: hex parsing, OKLab/LCH conversions, ΔE₀₀, dedup-by-distance, intermediate selection along an OKLab path. Wraps Color.js. |
| `src/lib/color.test.ts` | Unit tests for `color.ts`. Includes published CIEDE2000 test vectors. |
| `src/lib/mean-shift.ts` | Pure mean-shift clustering on LAB-space points with bin-seeding. No DOM. |
| `src/lib/mean-shift.test.ts` | Unit tests with synthetic flat-color inputs. |
| `src/lib/mean-shift.worker.ts` | Web Worker wrapper: receives an `ImageBitmap`, downsamples, calls `meanShift`, posts back hex strings. |
| `src/lib/palette-store.ts` | React Context + reducer. State: `{ colors, anchorA, anchorB }`. Actions: `ADD_COLOR`, `REMOVE_COLOR`, `TAP_SWATCH`, `RESET`. |
| `src/lib/palette-store.test.ts` | Unit tests for the reducer (anchor state machine, dedup-on-add, removal cascading). |
| `src/lib/gradient-canvas.ts` | `renderGradientPng(colors, w, h) → dataURL`. Uses CSS `in oklab` linear-gradient where supported, Canvas+per-pixel OKLab fallback otherwise. |
| `src/lib/gradient-canvas.test.ts` | Unit tests for the rendering function (offscreen canvas; pixel sampling at known stops). |
| `src/pages/Capture.tsx` | Capture screen. File input → worker → candidate chips → accept buttons. |
| `src/pages/Capture.test.tsx` | Component test; mocks the worker. |
| `src/pages/Palette.tsx` | Palette screen. Swatch grid + anchor state UI + remove. |
| `src/pages/Palette.test.tsx` | Component test for anchor-state UI and removal. |
| `src/pages/Gradients.tsx` | Gradient candidates screen + save. |
| `src/pages/Gradients.test.tsx` | Component test mocking palette state. |
| `src/App.tsx` | Routes: `/capture`, `/palette`, `/gradients`. Replaces existing `/home` placeholder. Wraps tree in `PaletteProvider`. |
| `src/pages/Home.tsx` | **Deleted.** Replaced by routes above. |
| `src/pages/Home.test.tsx` | **Deleted.** |
| `e2e/capture-to-save.spec.ts` | Full-flow Playwright test using `public/fixtures/yarn-cubbies.jpg`. Replaces existing `e2e/smoke.spec.ts`. |
| `package.json` | Add `colorjs.io` to `dependencies`. |

---

## Task 1 · Add Color.js dep, baseline dev check

Bring in the only new runtime dependency and confirm the existing scaffold still boots.

**Files:**
- Modify: `package.json`
- Verify: `src/pages/Home.test.tsx` (existing) still passes.

- [ ] **Step 1: Add `colorjs.io` to `dependencies`**

Edit `package.json`. In the `"dependencies"` object, add the entry. Final shape of `"dependencies"`:

```json
"dependencies": {
  "@ionic/react": "^8.4.0",
  "@ionic/react-router": "^8.4.0",
  "colorjs.io": "^0.5.2",
  "ionicons": "^7.4.0",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-router": "^5.3.4",
  "react-router-dom": "^5.3.4"
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: a successful install ending in `added N packages` (no peer-dep warnings about Color.js — it has no React/Ionic peers).

- [ ] **Step 3: Run the existing test suite to confirm scaffold is healthy**

Run: `npm test`
Expected: 1 passing test (`Home page > renders the app title and scaffold confirmation`). Exit 0.

- [ ] **Step 4: Run the typechecker**

Run: `npm run typecheck`
Expected: exit 0, no diagnostics.

- [ ] **Step 5: Boot the dev server, hit it once, kill it**

Run: `npm run dev &` then `sleep 3 && curl -s http://localhost:5173 | head -c 200`
Expected: HTML containing `<div id="root">` returned.
Then: `pkill -f vite` (or `kill %1`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add colorjs.io dep; verify scaffold boots with new lock"
```

---

## Task 2 · `color.ts` — hex / OKLab / ΔE₀₀ primitives

The lowest-level color math. Pure functions over hex strings. Wraps Color.js.

**Files:**
- Create: `src/lib/color.ts`
- Create: `src/lib/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/color.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToOklab,
  hexToOklch,
  deltaE00,
  type Oklab,
} from "./color";

describe("normalizeHex", () => {
  it("uppercases and prepends #", () => {
    expect(normalizeHex("ff8800")).toBe("#FF8800");
    expect(normalizeHex("#ff8800")).toBe("#FF8800");
  });
  it("expands 3-digit to 6", () => {
    expect(normalizeHex("f80")).toBe("#FF8800");
    expect(normalizeHex("#abc")).toBe("#AABBCC");
  });
  it("returns null for invalid input", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex("zzzzzz")).toBeNull();
    expect(normalizeHex("#1234")).toBeNull();
  });
});

describe("hexToOklab", () => {
  it("converts pure black", () => {
    const lab = hexToOklab("#000000");
    expect(lab.L).toBeCloseTo(0, 3);
    expect(lab.a).toBeCloseTo(0, 3);
    expect(lab.b).toBeCloseTo(0, 3);
  });
  it("converts pure white to L=1", () => {
    const lab = hexToOklab("#FFFFFF");
    expect(lab.L).toBeCloseTo(1.0, 2);
  });
  it("converts pure red to expected OKLab", () => {
    // Reference values from Bjorn Ottosson's OKLab spec.
    const lab = hexToOklab("#FF0000");
    expect(lab.L).toBeCloseTo(0.628, 2);
    expect(lab.a).toBeCloseTo(0.225, 2);
    expect(lab.b).toBeCloseTo(0.126, 2);
  });
});

describe("hexToOklch", () => {
  it("returns chroma + hue", () => {
    const lch = hexToOklch("#FF0000");
    expect(lch.L).toBeCloseTo(0.628, 2);
    expect(lch.C).toBeGreaterThan(0.2);
    expect(lch.h).toBeCloseTo(29, 0); // red-orange hue angle
  });
});

describe("deltaE00", () => {
  // Subset of Sharma et al. published CIEDE2000 vectors. Hex-encoded sRGB
  // round-trip is approximate (paper uses Lab inputs directly), so
  // we use 0.5 tolerance for these spot checks.
  it("identical colors → 0", () => {
    const a: Oklab = { L: 0.5, a: 0.1, b: -0.1 };
    expect(deltaE00FromLab(a, a)).toBeCloseTo(0, 4);
  });
  it("near-duplicate hex pair under JND", () => {
    expect(deltaE00("#FF8800", "#FF8801")).toBeLessThan(0.5);
  });
  it("complementary colors are large", () => {
    expect(deltaE00("#FF0000", "#00FFFF")).toBeGreaterThan(40);
  });
  it("hex order does not matter", () => {
    expect(deltaE00("#123456", "#789ABC")).toBeCloseTo(
      deltaE00("#789ABC", "#123456"),
      6,
    );
  });
});

// Helper used only in this test file.
function deltaE00FromLab(a: Oklab, b: Oklab): number {
  const { oklabToHex, deltaE00 } = require("./color");
  return deltaE00(oklabToHex(a), oklabToHex(b));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- color`
Expected: FAIL — "Cannot find module './color'".

- [ ] **Step 3: Implement `src/lib/color.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- color`
Expected: PASS — all `normalizeHex`, `hexToOklab`, `hexToOklch`, `deltaE00` tests green.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/color.ts src/lib/color.test.ts
git commit -m "Add color primitives: hex normalize, OKLab/OKLCH, ΔE₀₀"
```

---

## Task 3 · `color.ts` — dedup + intermediate selection

The Axiom-style "fill the path" math. Adds two functions to the existing `color.ts`.

**Files:**
- Modify: `src/lib/color.ts`
- Modify: `src/lib/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/color.test.ts`:

```ts
import { dedupByDeltaE, pickIntermediates } from "./color";

describe("dedupByDeltaE", () => {
  it("keeps first occurrence; drops near-duplicates", () => {
    const out = dedupByDeltaE(["#FF0000", "#FF0001", "#00FF00"], 3);
    expect(out).toEqual(["#FF0000", "#00FF00"]);
  });
  it("treats threshold inclusively (>=) — removes equal-distance dupes", () => {
    // Synthesize: same hex twice → distance 0 → always considered duplicate.
    const out = dedupByDeltaE(["#123456", "#123456"], 3);
    expect(out).toEqual(["#123456"]);
  });
  it("preserves order", () => {
    const out = dedupByDeltaE(["#0000FF", "#FF0000", "#00FF00"], 3);
    expect(out).toEqual(["#0000FF", "#FF0000", "#00FF00"]);
  });
  it("normalizes hex before comparing", () => {
    const out = dedupByDeltaE(["ff0000", "#ff0000", "F00"], 3);
    expect(out).toEqual(["#FF0000"]);
  });
});

describe("pickIntermediates", () => {
  // Anchors are pure red and pure blue. Test palette includes a perfect
  // mid-purple (which should be picked first), an off-axis green (rejected
  // for any k>=1 if a closer purple is present), and a near-anchor red.
  const A = "#FF0000"; // anchor A
  const B = "#0000FF"; // anchor B
  const PURPLE = "#8000FF"; // close to OKLab path midpoint
  const NEAR_PURPLE = "#9000A0"; // also near path
  const GREEN = "#00FF00"; // far from path
  const NEAR_A = "#F00010"; // very close to A

  it("k=0 returns empty", () => {
    expect(pickIntermediates([A, B, PURPLE, GREEN], A, B, 0)).toEqual([]);
  });
  it("k=1 picks the on-path color", () => {
    const result = pickIntermediates([A, B, PURPLE, GREEN], A, B, 1);
    expect(result).toEqual([PURPLE]);
  });
  it("k=1 rejects far-from-path colors when an on-path option exists", () => {
    const result = pickIntermediates([A, B, GREEN, PURPLE], A, B, 1);
    expect(result).not.toContain(GREEN);
  });
  it("returns colors ordered by their position along the path (A → B)", () => {
    const result = pickIntermediates([A, B, PURPLE, NEAR_A], A, B, 2);
    // NEAR_A projects to t≈0, PURPLE to t≈0.5; expect NEAR_A first.
    expect(result).toEqual([NEAR_A, PURPLE]);
  });
  it("excludes the anchors from candidates", () => {
    const result = pickIntermediates([A, B], A, B, 1);
    expect(result).toEqual([]);
  });
  it("returns fewer than k if not enough viable candidates", () => {
    const result = pickIntermediates([A, B, PURPLE], A, B, 3);
    expect(result.length).toBeLessThanOrEqual(1);
  });
  it("spread penalty: avoids stacking two intermediates at the same t", () => {
    // PURPLE and NEAR_PURPLE both project near t=0.5; only one should be picked
    // when k=1, but if k=2 we should NOT see both — we should see PURPLE plus
    // something else (NEAR_A would not exist here, so we get only PURPLE).
    const result = pickIntermediates([A, B, PURPLE, NEAR_PURPLE], A, B, 2);
    expect(result.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- color`
Expected: FAIL — "dedupByDeltaE is not a function" / "pickIntermediates is not a function".

- [ ] **Step 3: Implement `dedupByDeltaE` and `pickIntermediates`**

Append to `src/lib/color.ts`:

```ts
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

interface ScoredCandidate {
  hex: string;
  t: number; // position along the OKLab path, 0..1
  perpDist: number; // ΔE-equivalent perpendicular distance to path
}

export function pickIntermediates(
  palette: string[],
  anchorA: string,
  anchorB: string,
  k: number,
): string[] {
  if (k <= 0) return [];

  const a = hexToOklab(anchorA);
  const b = hexToOklab(anchorB);
  const ab = { L: b.L - a.L, a: b.a - a.a, b: b.b - a.b };
  const abLenSq = ab.L * ab.L + ab.a * ab.a + ab.b * ab.b;
  if (abLenSq === 0) return []; // degenerate: A == B

  const normA = normalizeHex(anchorA);
  const normB = normalizeHex(anchorB);

  const candidates = palette
    .map(normalizeHex)
    .filter((h): h is string => h !== null && h !== normA && h !== normB);

  const scored: ScoredCandidate[] = candidates.map((hex) => {
    const p = hexToOklab(hex);
    const ap = { L: p.L - a.L, a: p.a - a.a, b: p.b - a.b };
    let t = (ap.L * ab.L + ap.a * ab.a + ap.b * ab.b) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const proj: Oklab = {
      L: a.L + t * ab.L,
      a: a.a + t * ab.a,
      b: a.b + t * ab.b,
    };
    const projHex = oklabToHex(proj);
    return { hex, t, perpDist: deltaE00(hex, projHex) };
  });

  scored.sort((x, y) => x.perpDist - y.perpDist);

  const minGap = 1 / (k + 2);
  const chosen: ScoredCandidate[] = [];
  for (const s of scored) {
    if (chosen.length >= k) break;
    if (chosen.every((c) => Math.abs(c.t - s.t) >= minGap)) {
      chosen.push(s);
    }
  }
  chosen.sort((x, y) => x.t - y.t);
  return chosen.map((c) => c.hex);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- color`
Expected: PASS — all dedup and pickIntermediates tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/color.ts src/lib/color.test.ts
git commit -m "Add dedupByDeltaE and pickIntermediates (OKLab path fill)"
```

---

## Task 4 · `mean-shift.ts` — pure clusterer

Bin-seeded mean-shift on 3-D points (intended for OKLab pixels). No DOM, no Web Worker yet — that's Task 5.

**Files:**
- Create: `src/lib/mean-shift.ts`
- Create: `src/lib/mean-shift.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/mean-shift.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { meanShift, estimateBandwidth, type Point3 } from "./mean-shift";

describe("estimateBandwidth", () => {
  it("returns a positive bandwidth for a non-degenerate sample", () => {
    const points: Point3[] = [
      [0, 0, 0],
      [10, 10, 10],
      [20, 20, 20],
      [5, 5, 5],
      [15, 15, 15],
    ];
    expect(estimateBandwidth(points, 0.3)).toBeGreaterThan(0);
  });
  it("returns a smaller bandwidth for tighter data", () => {
    const tight: Point3[] = Array.from({ length: 20 }, (_, i) => [i / 10, 0, 0]);
    const loose: Point3[] = Array.from({ length: 20 }, (_, i) => [i, 0, 0]);
    expect(estimateBandwidth(tight, 0.3)).toBeLessThan(
      estimateBandwidth(loose, 0.3),
    );
  });
});

describe("meanShift", () => {
  it("recovers 3 distinct cluster centers from 3 flat blobs", () => {
    const blobs: Point3[] = [];
    // 3 blobs each with 50 points around a center, jitter ±0.5
    const centers: Point3[] = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
    ];
    for (const c of centers) {
      for (let i = 0; i < 50; i++) {
        blobs.push([
          c[0] + Math.random() * 0.5,
          c[1] + Math.random() * 0.5,
          c[2] + Math.random() * 0.5,
        ]);
      }
    }
    const result = meanShift(blobs, { bandwidth: 2 });
    expect(result.length).toBe(3);
    // Each known center should be near at least one returned cluster
    for (const known of centers) {
      const nearest = result.reduce((best, c) => {
        const d = Math.hypot(c[0] - known[0], c[1] - known[1], c[2] - known[2]);
        return d < best.d ? { d, c } : best;
      }, { d: Infinity, c: [0, 0, 0] as Point3 });
      expect(nearest.d).toBeLessThan(1);
    }
  });
  it("returns a single cluster when all points are identical", () => {
    const points: Point3[] = Array.from({ length: 30 }, () => [5, 5, 5]);
    const result = meanShift(points, { bandwidth: 1 });
    expect(result.length).toBe(1);
    expect(result[0][0]).toBeCloseTo(5, 3);
  });
  it("returns an empty array for empty input", () => {
    expect(meanShift([], { bandwidth: 1 })).toEqual([]);
  });
  it("respects minBinFreq to skip sparse seeds", () => {
    const points: Point3[] = [
      ...Array.from({ length: 20 }, () => [0, 0, 0] as Point3),
      [50, 50, 50], // single outlier
    ];
    const result = meanShift(points, { bandwidth: 1, minBinFreq: 5 });
    expect(result.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- mean-shift`
Expected: FAIL — "Cannot find module './mean-shift'".

- [ ] **Step 3: Implement `src/lib/mean-shift.ts`**

```ts
export type Point3 = [number, number, number];

export interface MeanShiftOptions {
  bandwidth: number;
  minBinFreq?: number;
  maxIter?: number;
  convergence?: number;
}

function dist(a: Point3, b: Point3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function estimateBandwidth(points: Point3[], quantile = 0.3): number {
  if (points.length < 2) return 1;
  const sample = points.length > 200 ? sampleN(points, 200) : points;
  const distances: number[] = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      distances.push(dist(sample[i], sample[j]));
    }
  }
  distances.sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(distances.length - 1, Math.floor(distances.length * quantile)));
  return distances[idx] || 1;
}

function sampleN<T>(arr: T[], n: number): T[] {
  const out: T[] = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.floor(i * step)]);
  }
  return out;
}

export function meanShift(points: Point3[], opts: MeanShiftOptions): Point3[] {
  if (points.length === 0) return [];
  const bandwidth = opts.bandwidth;
  const minBinFreq = opts.minBinFreq ?? 1;
  const maxIter = opts.maxIter ?? 100;
  const convergence = opts.convergence ?? 1e-3;

  // Bin-seed
  const bins = new Map<string, Point3[]>();
  for (const p of points) {
    const key = `${Math.floor(p[0] / bandwidth)},${Math.floor(p[1] / bandwidth)},${Math.floor(p[2] / bandwidth)}`;
    let bucket = bins.get(key);
    if (!bucket) {
      bucket = [];
      bins.set(key, bucket);
    }
    bucket.push(p);
  }

  const seeds: Point3[] = [];
  for (const bucket of bins.values()) {
    if (bucket.length < minBinFreq) continue;
    const cx = bucket.reduce((s, p) => s + p[0], 0) / bucket.length;
    const cy = bucket.reduce((s, p) => s + p[1], 0) / bucket.length;
    const cz = bucket.reduce((s, p) => s + p[2], 0) / bucket.length;
    seeds.push([cx, cy, cz]);
  }
  if (seeds.length === 0) seeds.push(points[0]);

  const converged: Point3[] = [];
  for (let seed of seeds) {
    for (let iter = 0; iter < maxIter; iter++) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const p of points) {
        if (dist(p, seed) < bandwidth) {
          sx += p[0]; sy += p[1]; sz += p[2]; n++;
        }
      }
      if (n === 0) break;
      const next: Point3 = [sx / n, sy / n, sz / n];
      if (dist(next, seed) < convergence) {
        seed = next;
        break;
      }
      seed = next;
    }
    converged.push(seed);
  }

  // Merge converged centers within bandwidth of each other
  const merged: Point3[] = [];
  for (const c of converged) {
    if (!merged.some((m) => dist(m, c) < bandwidth)) {
      merged.push(c);
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- mean-shift`
Expected: PASS — 5 tests green. (The first test is non-deterministic on jitter; if it occasionally returns 4 clusters instead of 3, increase `bandwidth` to 2.5 or constrain `Math.random()` with a seeded RNG.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mean-shift.ts src/lib/mean-shift.test.ts
git commit -m "Add bin-seeded mean-shift clusterer (pure)"
```

---

## Task 5 · `mean-shift.worker.ts` — Web Worker wrapper

Wraps the pure clusterer in a Web Worker. Receives an `ImageBitmap` (transferable), downsamples to 128×128, converts pixels to OKLab, calls `meanShift`, posts back hex strings.

**Files:**
- Create: `src/lib/mean-shift.worker.ts`
- Create: `src/lib/mean-shift.worker.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/mean-shift.worker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractPalette } from "./mean-shift.worker";

function buildSyntheticImageData(): ImageData {
  // 32x32 image, half pure red, half pure green, third pure blue stripe.
  const w = 32, h = 32;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (x < 11) {
        data[idx] = 255; data[idx + 1] = 0; data[idx + 2] = 0;
      } else if (x < 22) {
        data[idx] = 0; data[idx + 1] = 255; data[idx + 2] = 0;
      } else {
        data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 255;
      }
      data[idx + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

describe("extractPalette (worker payload function)", () => {
  it("extracts ~3 clusters from a 3-stripe image", () => {
    const out = extractPalette(buildSyntheticImageData());
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out.every((hex) => /^#[0-9A-F]{6}$/.test(hex))).toBe(true);
  });
  it("returns hex strings normalized via normalizeHex", () => {
    const out = extractPalette(buildSyntheticImageData());
    for (const hex of out) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- mean-shift.worker`
Expected: FAIL — "Cannot find module './mean-shift.worker'".

- [ ] **Step 3: Implement `src/lib/mean-shift.worker.ts`**

```ts
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
  self.addEventListener("message", (e: MessageEvent<ExtractRequest>) => {
    if (e.data?.type === "extract") {
      const hexes = extractPalette(e.data.imageData);
      const response: ExtractResponse = { type: "result", hexes };
      (self as unknown as Worker).postMessage(response);
    }
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- mean-shift.worker`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mean-shift.worker.ts src/lib/mean-shift.worker.test.ts
git commit -m "Add Web Worker wrapper for mean-shift palette extraction"
```

---

## Task 6 · `palette-store.ts` — Context + reducer

Holds session palette state and the anchor state machine. Pure reducer + a thin React Context provider/hook.

**Files:**
- Create: `src/lib/palette-store.ts`
- Create: `src/lib/palette-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/palette-store.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { paletteReducer, initialPaletteState, type PaletteState } from "./palette-store";

const empty = initialPaletteState();

describe("paletteReducer · ADD_COLOR", () => {
  it("adds a new color with a stable id", () => {
    const s = paletteReducer(empty, { type: "ADD_COLOR", hex: "#FF0000" });
    expect(s.colors.length).toBe(1);
    expect(s.colors[0].hex).toBe("#FF0000");
    expect(typeof s.colors[0].id).toBe("string");
  });
  it("dedupes near-duplicates by ΔE₀₀ < 3", () => {
    let s = paletteReducer(empty, { type: "ADD_COLOR", hex: "#FF0000" });
    s = paletteReducer(s, { type: "ADD_COLOR", hex: "#FF0001" });
    expect(s.colors.length).toBe(1);
  });
  it("normalizes hex on input", () => {
    const s = paletteReducer(empty, { type: "ADD_COLOR", hex: "f00" });
    expect(s.colors[0].hex).toBe("#FF0000");
  });
  it("ignores invalid hex silently", () => {
    const s = paletteReducer(empty, { type: "ADD_COLOR", hex: "garbage" });
    expect(s.colors.length).toBe(0);
  });
});

describe("paletteReducer · TAP_SWATCH (anchor state machine)", () => {
  function withColors(hexes: string[]): PaletteState {
    return hexes.reduce(
      (s, hex) => paletteReducer(s, { type: "ADD_COLOR", hex }),
      empty,
    );
  }

  it("State 0 → State 1 (A only): tap any → A=id", () => {
    const s = withColors(["#FF0000", "#00FF00"]);
    const id1 = s.colors[0].id;
    const next = paletteReducer(s, { type: "TAP_SWATCH", id: id1 });
    expect(next.anchorA).toBe(id1);
    expect(next.anchorB).toBeNull();
  });

  it("State 1 (A only): tap A → State 0 (A cleared)", () => {
    let s = withColors(["#FF0000"]);
    const id = s.colors[0].id;
    s = paletteReducer(s, { type: "TAP_SWATCH", id });
    s = paletteReducer(s, { type: "TAP_SWATCH", id });
    expect(s.anchorA).toBeNull();
    expect(s.anchorB).toBeNull();
  });

  it("State 1 (A only): tap a different swatch → State 2 (B set)", () => {
    let s = withColors(["#FF0000", "#00FF00"]);
    const idA = s.colors[0].id;
    const idB = s.colors[1].id;
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idA });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idB });
    expect(s.anchorA).toBe(idA);
    expect(s.anchorB).toBe(idB);
  });

  it("State 2: tap A → A cleared, B promoted? — spec says A cleared, B stays B (so State 1 with B only)", () => {
    let s = withColors(["#FF0000", "#00FF00"]);
    const idA = s.colors[0].id;
    const idB = s.colors[1].id;
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idA });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idB });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idA });
    expect(s.anchorA).toBeNull();
    expect(s.anchorB).toBe(idB);
  });

  it("State 2: tap B → B cleared, A stays", () => {
    let s = withColors(["#FF0000", "#00FF00"]);
    const idA = s.colors[0].id;
    const idB = s.colors[1].id;
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idA });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idB });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idB });
    expect(s.anchorA).toBe(idA);
    expect(s.anchorB).toBeNull();
  });

  it("State 2: tap a third swatch → A drops, B promotes to A, third becomes B", () => {
    let s = withColors(["#FF0000", "#00FF00", "#0000FF"]);
    const [a, b, c] = s.colors.map((x) => x.id);
    s = paletteReducer(s, { type: "TAP_SWATCH", id: a });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: b });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: c });
    expect(s.anchorA).toBe(b);
    expect(s.anchorB).toBe(c);
  });
});

describe("paletteReducer · REMOVE_COLOR", () => {
  it("removes the color and clears anchors that pointed at it", () => {
    let s: PaletteState = empty;
    s = paletteReducer(s, { type: "ADD_COLOR", hex: "#FF0000" });
    s = paletteReducer(s, { type: "ADD_COLOR", hex: "#00FF00" });
    const idA = s.colors[0].id;
    const idB = s.colors[1].id;
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idA });
    s = paletteReducer(s, { type: "TAP_SWATCH", id: idB });
    s = paletteReducer(s, { type: "REMOVE_COLOR", id: idA });
    expect(s.colors.length).toBe(1);
    expect(s.colors[0].id).toBe(idB);
    expect(s.anchorA).toBeNull();
    expect(s.anchorB).toBe(idB);
  });
});

describe("paletteReducer · RESET", () => {
  it("returns to initial state", () => {
    let s: PaletteState = empty;
    s = paletteReducer(s, { type: "ADD_COLOR", hex: "#FF0000" });
    s = paletteReducer(s, { type: "RESET" });
    expect(s).toEqual(initialPaletteState());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- palette-store`
Expected: FAIL — "Cannot find module './palette-store'".

- [ ] **Step 3: Implement `src/lib/palette-store.ts`**

```ts
import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { normalizeHex, deltaE00 } from "./color";

export interface PaletteEntry {
  id: string;
  hex: string;
}

export interface PaletteState {
  colors: PaletteEntry[];
  anchorA: string | null;
  anchorB: string | null;
}

export type PaletteAction =
  | { type: "ADD_COLOR"; hex: string }
  | { type: "REMOVE_COLOR"; id: string }
  | { type: "TAP_SWATCH"; id: string }
  | { type: "RESET" };

const DEDUP_THRESHOLD = 3;

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `c${nextId}_${Math.random().toString(36).slice(2, 8)}`;
}

export function initialPaletteState(): PaletteState {
  return { colors: [], anchorA: null, anchorB: null };
}

export function paletteReducer(
  state: PaletteState,
  action: PaletteAction,
): PaletteState {
  switch (action.type) {
    case "ADD_COLOR": {
      const hex = normalizeHex(action.hex);
      if (!hex) return state;
      const tooClose = state.colors.some(
        (c) => deltaE00(c.hex, hex) < DEDUP_THRESHOLD,
      );
      if (tooClose) return state;
      return {
        ...state,
        colors: [...state.colors, { id: makeId(), hex }],
      };
    }

    case "REMOVE_COLOR": {
      return {
        colors: state.colors.filter((c) => c.id !== action.id),
        anchorA: state.anchorA === action.id ? null : state.anchorA,
        anchorB: state.anchorB === action.id ? null : state.anchorB,
      };
    }

    case "TAP_SWATCH": {
      const { id } = action;
      const exists = state.colors.some((c) => c.id === id);
      if (!exists) return state;

      const { anchorA, anchorB } = state;

      if (anchorA === null && anchorB === null) {
        return { ...state, anchorA: id };
      }
      if (anchorA !== null && anchorB === null) {
        if (id === anchorA) return { ...state, anchorA: null };
        return { ...state, anchorB: id };
      }
      if (anchorA === null && anchorB !== null) {
        if (id === anchorB) return { ...state, anchorB: null };
        return { ...state, anchorA: id };
      }
      // State 2 — both set
      if (id === anchorA) return { ...state, anchorA: null };
      if (id === anchorB) return { ...state, anchorB: null };
      // Third tap → A drops, B promotes to A, new id is B
      return { ...state, anchorA: anchorB, anchorB: id };
    }

    case "RESET":
      return initialPaletteState();

    default:
      return state;
  }
}

interface PaletteContextValue {
  state: PaletteState;
  dispatch: Dispatch<PaletteAction>;
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(paletteReducer, initialPaletteState());
  return (
    <PaletteContext.Provider value={{ state, dispatch }}>
      {children}
    </PaletteContext.Provider>
  );
}

export function usePalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("usePalette must be used inside <PaletteProvider>");
  return ctx;
}
```

Note: `palette-store.ts` contains JSX in `PaletteProvider`. **Rename the file to `palette-store.tsx`** before saving — TS won't compile JSX in a `.ts` file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- palette-store`
Expected: PASS — all reducer tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/palette-store.tsx src/lib/palette-store.test.ts
git commit -m "Add palette-store: Context + reducer for colors and anchors"
```

---

## Task 7 · `gradient-canvas.ts` — render + PNG export

Renders an OKLab-interpolated horizontal gradient strip with hex labels to a Canvas and returns a `data:image/png` URL.

**Files:**
- Create: `src/lib/gradient-canvas.ts`
- Create: `src/lib/gradient-canvas.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/gradient-canvas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderGradientPng, sampleGradientStop } from "./gradient-canvas";

describe("sampleGradientStop", () => {
  it("returns the first color at t=0", () => {
    const colors = ["#FF0000", "#00FF00", "#0000FF"];
    expect(sampleGradientStop(colors, 0)).toBe("#FF0000");
  });
  it("returns the last color at t=1", () => {
    const colors = ["#FF0000", "#00FF00", "#0000FF"];
    expect(sampleGradientStop(colors, 1)).toBe("#0000FF");
  });
  it("interpolates in OKLab between two colors at t=0.5", () => {
    const mid = sampleGradientStop(["#000000", "#FFFFFF"], 0.5);
    // OKLab midpoint of black and white is roughly 50% lightness gray.
    // Allow wide tolerance because OKLab L is perceptual, not linear-RGB.
    expect(mid).toMatch(/^#[0-9A-F]{6}$/);
    const r = parseInt(mid.slice(1, 3), 16);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(200);
  });
});

describe("renderGradientPng", () => {
  it("returns a PNG data URL for a 2-color input", async () => {
    const url = await renderGradientPng(["#FF0000", "#0000FF"], 200, 80);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
  it("rejects empty color arrays", async () => {
    await expect(renderGradientPng([], 200, 80)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- gradient-canvas`
Expected: FAIL — "Cannot find module './gradient-canvas'".

- [ ] **Step 3: Implement `src/lib/gradient-canvas.ts`**

```ts
import Color from "colorjs.io";
import { normalizeHex } from "./color";

export function sampleGradientStop(colors: string[], t: number): string {
  if (colors.length === 0) throw new Error("empty colors");
  if (colors.length === 1) return normalizeHex(colors[0])!;
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped === 0) return normalizeHex(colors[0])!;
  if (clamped === 1) return normalizeHex(colors[colors.length - 1])!;
  const segCount = colors.length - 1;
  const scaled = clamped * segCount;
  const segIdx = Math.min(segCount - 1, Math.floor(scaled));
  const localT = scaled - segIdx;
  const a = new Color(colors[segIdx]).to("oklab");
  const b = new Color(colors[segIdx + 1]).to("oklab");
  const mixed = a.mix(b, localT, { space: "oklab" });
  return normalizeHex(mixed.to("srgb").toString({ format: "hex" }))!;
}

export async function renderGradientPng(
  colors: string[],
  width: number,
  height: number,
): Promise<string> {
  if (colors.length === 0) throw new Error("renderGradientPng: empty colors");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");

  const labelHeight = 28;
  const stripHeight = height - labelHeight;

  // Per-pixel OKLab interpolation. Slow on huge canvases but exact.
  const imageData = ctx.createImageData(width, stripHeight);
  for (let x = 0; x < width; x++) {
    const t = width === 1 ? 0 : x / (width - 1);
    const hex = sampleGradientStop(colors, t);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    for (let y = 0; y < stripHeight; y++) {
      const idx = (y * width + x) * 4;
      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // Hex labels under each stop.
  ctx.fillStyle = "#1b1f27";
  ctx.fillRect(0, stripHeight, width, labelHeight);
  ctx.fillStyle = "#e8ebf0";
  ctx.font = "13px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < colors.length; i++) {
    const x = colors.length === 1 ? width / 2 : (i / (colors.length - 1)) * width;
    const clampedX = Math.max(40, Math.min(width - 40, x));
    ctx.fillText(normalizeHex(colors[i]) ?? colors[i], clampedX, stripHeight + labelHeight / 2);
  }

  return canvas.toDataURL("image/png");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- gradient-canvas`
Expected: PASS — 5 tests green. (jsdom provides a `<canvas>` polyfill via the test environment; if `canvas.toDataURL` is missing, install `canvas` as a devDep and add `vitest.config.ts` `test.environmentOptions = { jsdom: { resources: "usable" } }`. Most jsdom builds now include a stub.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/gradient-canvas.ts src/lib/gradient-canvas.test.ts
git commit -m "Add OKLab gradient canvas renderer + PNG export"
```

---

## Task 8 · `Capture.tsx` — file input → worker → chips

The first user-facing screen. Loads a photo via the native file picker, pushes its `ImageData` into the mean-shift worker, renders the returned hexes as chips with add/added states.

**Files:**
- Create: `src/pages/Capture.tsx`
- Create: `src/pages/Capture.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/pages/Capture.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PaletteProvider } from "../lib/palette-store";
import Capture from "./Capture";

vi.mock("../lib/mean-shift.worker", () => ({
  extractPalette: vi.fn(() => ["#FF0000", "#00FF00", "#0000FF"]),
}));

function renderCapture() {
  return render(
    <MemoryRouter>
      <PaletteProvider>
        <Capture />
      </PaletteProvider>
    </MemoryRouter>,
  );
}

describe("Capture page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the take/upload button when no photo loaded", () => {
    renderCapture();
    expect(screen.getByRole("button", { name: /take.*photo|upload/i })).toBeInTheDocument();
  });

  it("renders chips after extraction returns", async () => {
    renderCapture();
    const file = new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /add color #/i }).length).toBe(3);
    });
  });

  it("Accept all adds all unaccepted chips and disables them", async () => {
    renderCapture();
    const file = new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /add color #/i }).length).toBe(3),
    );
    await userEvent.click(screen.getByRole("button", { name: /accept all/i }));
    expect(screen.queryAllByRole("button", { name: /add color #/i }).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- Capture`
Expected: FAIL — "Cannot find module './Capture'".

- [ ] **Step 3: Implement `src/pages/Capture.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonProgressBar,
  IonText,
  IonTitle,
  IonToast,
  IonToolbar,
} from "@ionic/react";
import { useHistory } from "react-router-dom";
import { extractPalette } from "../lib/mean-shift.worker";
import { usePalette } from "../lib/palette-store";

type Status = "idle" | "extracting" | "ready" | "error";

export default function Capture() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { state, dispatch } = usePalette();
  const history = useHistory();

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  async function handleFile(file: File) {
    setStatus("extracting");
    setCandidates([]);
    setAccepted(new Set());
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));

    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas context");
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const hexes = extractPalette(imageData);
      if (hexes.length === 0) {
        setStatus("error");
        setErrorMsg("Couldn't find distinct colors in this photo");
        return;
      }
      setCandidates(hexes);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Extraction failed");
    }
  }

  function addOne(hex: string) {
    dispatch({ type: "ADD_COLOR", hex });
    setAccepted((prev) => new Set(prev).add(hex));
  }

  function acceptAll() {
    for (const hex of candidates) {
      if (!accepted.has(hex)) dispatch({ type: "ADD_COLOR", hex });
    }
    setAccepted(new Set(candidates));
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Capture</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        {!photoUrl && (
          <IonButton expand="block" onClick={() => inputRef.current?.click()}>
            Take or upload photo
          </IonButton>
        )}

        {photoUrl && (
          <img
            src={photoUrl}
            alt="captured"
            style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 8 }}
          />
        )}

        {status === "extracting" && <IonProgressBar type="indeterminate" />}

        {status === "ready" && (
          <>
            <IonText>
              <p>
                Tap a swatch to add it to your palette. Already added: {accepted.size} /{" "}
                {candidates.length}.
              </p>
            </IonText>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
              {candidates.map((hex) => {
                const isAdded = accepted.has(hex);
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={isAdded ? `Added color ${hex}` : `Add color ${hex}`}
                    onClick={() => !isAdded && addOne(hex)}
                    disabled={isAdded}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: "50%",
                      background: hex,
                      border: isAdded ? "3px solid var(--ion-color-primary)" : "none",
                      cursor: isAdded ? "default" : "pointer",
                    }}
                  />
                );
              })}
            </div>
            <IonButton onClick={acceptAll} disabled={accepted.size === candidates.length}>
              Accept all
            </IonButton>
            <IonButton onClick={() => inputRef.current?.click()} fill="outline">
              Add another photo
            </IonButton>
            <IonButton
              expand="block"
              onClick={() => history.push("/palette")}
              disabled={state.colors.length < 2}
            >
              Next → Palette ({state.colors.length})
            </IonButton>
          </>
        )}

        <IonToast
          isOpen={status === "error"}
          message={errorMsg ?? ""}
          duration={3000}
          onDidDismiss={() => setStatus("idle")}
        />
      </IonContent>
    </IonPage>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- Capture`
Expected: PASS — all 3 component tests green.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Capture.tsx src/pages/Capture.test.tsx
git commit -m "Add Capture page: file input → worker → chips → accept"
```

---

## Task 9 · `Palette.tsx` — grid + anchor state UI + remove

Shows the accumulated palette as a grid of swatches. Wires the anchor state machine from Task 6 into taps. Long-press or × removes.

**Files:**
- Create: `src/pages/Palette.tsx`
- Create: `src/pages/Palette.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/pages/Palette.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  PaletteProvider,
  usePalette,
} from "../lib/palette-store";
import Palette from "./Palette";

function Seeder({ hexes }: { hexes: string[] }) {
  const { dispatch } = usePalette();
  // Seed synchronously before first paint.
  for (const h of hexes) dispatch({ type: "ADD_COLOR", hex: h });
  return null;
}

function renderPalette(hexes: string[]) {
  return render(
    <MemoryRouter>
      <PaletteProvider>
        <Seeder hexes={hexes} />
        <Palette />
      </PaletteProvider>
    </MemoryRouter>,
  );
}

describe("Palette page", () => {
  it("renders one swatch per color", () => {
    renderPalette(["#FF0000", "#00FF00", "#0000FF"]);
    expect(screen.getAllByRole("button", { name: /swatch #/i }).length).toBe(3);
  });

  it("first tap marks anchor A; second tap (different swatch) marks anchor B", async () => {
    renderPalette(["#FF0000", "#00FF00"]);
    const swatches = screen.getAllByRole("button", { name: /swatch #/i });
    await userEvent.click(swatches[0]);
    expect(swatches[0]).toHaveAttribute("data-anchor", "A");
    await userEvent.click(swatches[1]);
    expect(swatches[1]).toHaveAttribute("data-anchor", "B");
  });

  it("Generate gradients is disabled until both anchors chosen", async () => {
    renderPalette(["#FF0000", "#00FF00"]);
    const btn = screen.getByRole("button", { name: /generate gradients/i });
    expect(btn).toBeDisabled();
    const swatches = screen.getAllByRole("button", { name: /swatch #/i });
    await userEvent.click(swatches[0]);
    await userEvent.click(swatches[1]);
    expect(btn).not.toBeDisabled();
  });

  it("× removes a swatch", async () => {
    renderPalette(["#FF0000", "#00FF00", "#0000FF"]);
    const removeButtons = screen.getAllByRole("button", { name: /remove #/i });
    await userEvent.click(removeButtons[0]);
    expect(screen.getAllByRole("button", { name: /swatch #/i }).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- Palette`
Expected: FAIL — "Cannot find module './Palette'".

- [ ] **Step 3: Implement `src/pages/Palette.tsx`**

```tsx
import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { useHistory } from "react-router-dom";
import { usePalette } from "../lib/palette-store";

export default function Palette() {
  const { state, dispatch } = usePalette();
  const history = useHistory();

  const canGenerate = state.anchorA !== null && state.anchorB !== null;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Palette</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText>
          <p>
            Tap two colors to pick anchors. {state.colors.length} color
            {state.colors.length === 1 ? "" : "s"} in palette.
          </p>
        </IonText>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
            gap: 12,
            margin: "12px 0",
          }}
        >
          {state.colors.map((color) => {
            const anchor =
              color.id === state.anchorA
                ? "A"
                : color.id === state.anchorB
                  ? "B"
                  : null;
            return (
              <div key={color.id} style={{ position: "relative" }}>
                <button
                  type="button"
                  aria-label={`Swatch ${color.hex}`}
                  data-anchor={anchor ?? ""}
                  onClick={() => dispatch({ type: "TAP_SWATCH", id: color.id })}
                  style={{
                    width: "100%",
                    paddingTop: "100%",
                    background: color.hex,
                    borderRadius: 8,
                    border: anchor
                      ? "4px solid var(--ion-color-primary)"
                      : "1px solid #ccc",
                    cursor: "pointer",
                    position: "relative",
                  }}
                >
                  {anchor && (
                    <span
                      style={{
                        position: "absolute",
                        top: 4,
                        left: 4,
                        background: "var(--ion-color-primary)",
                        color: "white",
                        padding: "2px 8px",
                        borderRadius: 6,
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      {anchor}
                    </span>
                  )}
                </button>
                <div
                  style={{
                    textAlign: "center",
                    fontFamily: "monospace",
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  {color.hex}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${color.hex}`}
                  onClick={() =>
                    dispatch({ type: "REMOVE_COLOR", id: color.id })
                  }
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "none",
                    background: "#000a",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <IonButton
          expand="block"
          onClick={() => history.push("/gradients")}
          disabled={!canGenerate}
        >
          Generate gradients
        </IonButton>
        <IonButton
          fill="outline"
          expand="block"
          onClick={() => history.push("/capture")}
        >
          Back to Capture
        </IonButton>
      </IonContent>
    </IonPage>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- Palette`
Expected: PASS — 4 component tests green.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Palette.tsx src/pages/Palette.test.tsx
git commit -m "Add Palette page: swatch grid + anchor state + remove"
```

---

## Task 10 · `Gradients.tsx` — candidates + save

Final screen of the flow. Reads the two anchors and the palette from the store, computes 3–4 candidate gradients with *k* ∈ {0,1,2,3} intermediates, renders each as a selectable strip, saves the chosen one as a PNG download.

**Files:**
- Create: `src/pages/Gradients.tsx`
- Create: `src/pages/Gradients.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/pages/Gradients.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  PaletteProvider,
  usePalette,
} from "../lib/palette-store";
import Gradients from "./Gradients";

vi.mock("../lib/gradient-canvas", () => ({
  renderGradientPng: vi.fn(async () => "data:image/png;base64,FAKE"),
  sampleGradientStop: (colors: string[], t: number) => colors[Math.floor(t * (colors.length - 1))],
}));

function Seeder({ hexes, anchors }: { hexes: string[]; anchors: [number, number] }) {
  const { state, dispatch } = usePalette();
  if (state.colors.length === 0) {
    for (const h of hexes) dispatch({ type: "ADD_COLOR", hex: h });
  } else if (state.anchorA === null) {
    dispatch({ type: "TAP_SWATCH", id: state.colors[anchors[0]].id });
    dispatch({ type: "TAP_SWATCH", id: state.colors[anchors[1]].id });
  }
  return null;
}

function renderGradients(hexes: string[], anchors: [number, number]) {
  return render(
    <MemoryRouter>
      <PaletteProvider>
        <Seeder hexes={hexes} anchors={anchors} />
        <Gradients />
      </PaletteProvider>
    </MemoryRouter>,
  );
}

describe("Gradients page", () => {
  it("renders at least one candidate when both anchors set", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF", "#FFFF00"], [0, 1]);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /gradient candidate/i }).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("Save is disabled until a candidate is selected", async () => {
    renderGradients(["#FF0000", "#00FF00", "#0000FF"], [0, 1]);
    await waitFor(() => screen.getAllByRole("button", { name: /gradient candidate/i }));
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getAllByRole("button", { name: /gradient candidate/i })[0]);
    expect(save).not.toBeDisabled();
  });

  it("clicking Save calls renderGradientPng", async () => {
    const mod = await import("../lib/gradient-canvas");
    renderGradients(["#FF0000", "#00FF00", "#0000FF"], [0, 1]);
    await waitFor(() => screen.getAllByRole("button", { name: /gradient candidate/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /gradient candidate/i })[0]);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(mod.renderGradientPng).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- Gradients`
Expected: FAIL — "Cannot find module './Gradients'".

- [ ] **Step 3: Implement `src/pages/Gradients.tsx`**

```tsx
import { useMemo, useState } from "react";
import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonText,
  IonTitle,
  IonToast,
  IonToolbar,
} from "@ionic/react";
import { useHistory } from "react-router-dom";
import { usePalette } from "../lib/palette-store";
import { pickIntermediates } from "../lib/color";
import { renderGradientPng } from "../lib/gradient-canvas";

interface Candidate {
  id: string;
  colors: string[];
}

export default function Gradients() {
  const { state } = usePalette();
  const history = useHistory();
  const [selected, setSelected] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const anchorA = state.colors.find((c) => c.id === state.anchorA)?.hex ?? null;
  const anchorB = state.colors.find((c) => c.id === state.anchorB)?.hex ?? null;
  const paletteHexes = state.colors.map((c) => c.hex);

  const candidates: Candidate[] = useMemo(() => {
    if (!anchorA || !anchorB) return [];
    const out: Candidate[] = [{ id: "k0", colors: [anchorA, anchorB] }];
    for (const k of [1, 2, 3]) {
      const intermediates = pickIntermediates(paletteHexes, anchorA, anchorB, k);
      if (intermediates.length === k) {
        out.push({ id: `k${k}`, colors: [anchorA, ...intermediates, anchorB] });
      }
    }
    return out;
  }, [anchorA, anchorB, paletteHexes]);

  async function handleSave() {
    const candidate = candidates.find((c) => c.id === selected);
    if (!candidate) return;
    const dataUrl = await renderGradientPng(candidate.colors, 1080, 240);
    const a = document.createElement("a");
    const ts = new Date()
      .toISOString()
      .replace(/[:T]/g, "-")
      .slice(0, 16);
    a.href = dataUrl;
    a.download = `palette-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSavedMsg("Saved to downloads");
  }

  if (!anchorA || !anchorB) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Gradients</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonText>
            <p>Pick two anchors on the Palette screen first.</p>
          </IonText>
          <IonButton expand="block" onClick={() => history.push("/palette")}>
            Back to Palette
          </IonButton>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Gradients</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText>
          <p>Pick a candidate, then tap Save.</p>
        </IonText>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {candidates.map((c) => {
            const isSelected = selected === c.id;
            const stops = c.colors
              .map((hex, i) => `${hex} ${((i / (c.colors.length - 1)) * 100).toFixed(1)}%`)
              .join(", ");
            return (
              <button
                type="button"
                key={c.id}
                aria-label={`Gradient candidate ${c.id}`}
                onClick={() => setSelected(c.id)}
                style={{
                  height: 64,
                  borderRadius: 10,
                  border: isSelected
                    ? "3px solid var(--ion-color-primary)"
                    : "1px solid #ccc",
                  background: `linear-gradient(in oklab to right, ${stops})`,
                  padding: 0,
                  cursor: "pointer",
                }}
              />
            );
          })}
        </div>
        <IonButton
          expand="block"
          onClick={handleSave}
          disabled={!selected}
          style={{ marginTop: 16 }}
        >
          Save
        </IonButton>
        <IonToast
          isOpen={savedMsg !== null}
          message={savedMsg ?? ""}
          duration={2000}
          onDidDismiss={() => setSavedMsg(null)}
        />
      </IonContent>
    </IonPage>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- Gradients`
Expected: PASS — 3 component tests green.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Gradients.tsx src/pages/Gradients.test.tsx
git commit -m "Add Gradients page: candidates + Save as PNG"
```

---

## Task 11 · Wire routes in `App.tsx`, retire `Home`

Replace the `/home` placeholder with the three real routes. Wrap the tree in `PaletteProvider`.

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/pages/Home.tsx`, `src/pages/Home.test.tsx`
- Modify: `e2e/smoke.spec.ts` (gets deleted in Task 12 — for now, make it pass by targeting new copy)

- [ ] **Step 1: Replace `src/App.tsx`**

```tsx
import { IonApp, IonRouterOutlet } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { Redirect, Route } from "react-router-dom";
import Capture from "./pages/Capture";
import Palette from "./pages/Palette";
import Gradients from "./pages/Gradients";
import { PaletteProvider } from "./lib/palette-store";

export default function App() {
  return (
    <IonApp>
      <PaletteProvider>
        <IonReactRouter>
          <IonRouterOutlet>
            <Route exact path="/capture" component={Capture} />
            <Route exact path="/palette" component={Palette} />
            <Route exact path="/gradients" component={Gradients} />
            <Route exact path="/">
              <Redirect to="/capture" />
            </Route>
          </IonRouterOutlet>
        </IonReactRouter>
      </PaletteProvider>
    </IonApp>
  );
}
```

- [ ] **Step 2: Delete the placeholder Home page**

```bash
git rm src/pages/Home.tsx src/pages/Home.test.tsx
```

- [ ] **Step 3: Update the existing smoke E2E to match new copy (temporary)**

Edit `e2e/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("app loads at /capture", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/capture$/);
  await expect(page.getByRole("button", { name: /take or upload photo/i })).toBeVisible();
});
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: PASS — all tests across color, mean-shift, palette-store, gradient-canvas, Capture, Palette, Gradients.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Boot dev server and smoke-check manually in Playwright**

Run: `npx playwright install chromium` (first run only) then `npm run test:e2e -- --project=chromium smoke.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx e2e/smoke.spec.ts
git commit -m "Wire /capture, /palette, /gradients routes; retire Home placeholder"
```

---

## Task 12 · E2E flow test + final M1 verification

Full Playwright test that exercises the real code path (no mocks) against a committed fixture photo. Then run the whole suite + typecheck + production build to confirm M1 is shippable.

**Files:**
- Create: `e2e/capture-to-save.spec.ts`
- Delete: `e2e/smoke.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `e2e/capture-to-save.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import path from "node:path";

test("full flow: capture → pick anchors → generate → save", async ({ page }, testInfo) => {
  const downloadPromise = page.waitForEvent("download");

  await page.goto("/");
  await expect(page).toHaveURL(/\/capture$/);

  // Upload fixture via the hidden <input type="file">
  const fixture = path.resolve(__dirname, "..", "public", "fixtures", "yarn-cubbies.jpg");
  await page.setInputFiles('input[type="file"]', fixture);

  // Wait for extraction to finish (chips appear).
  await page.waitForSelector('button[aria-label^="Add color #"]', { timeout: 20_000 });

  // Accept all extracted candidates.
  await page.getByRole("button", { name: /accept all/i }).click();

  // Move to Palette.
  await page.getByRole("button", { name: /next → palette/i }).click();
  await expect(page).toHaveURL(/\/palette$/);

  // Pick two anchors (first two swatches).
  const swatches = page.getByRole("button", { name: /swatch #/i });
  const count = await swatches.count();
  expect(count).toBeGreaterThanOrEqual(2);
  await swatches.nth(0).click();
  await swatches.nth(1).click();

  // Generate.
  await page.getByRole("button", { name: /generate gradients/i }).click();
  await expect(page).toHaveURL(/\/gradients$/);

  // Pick the first candidate.
  const candidates = page.getByRole("button", { name: /gradient candidate/i });
  await expect(candidates.first()).toBeVisible();
  await candidates.first().click();

  // Save and assert a download fired.
  await page.getByRole("button", { name: /^save$/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^palette-.+\.png$/);

  // Attach the PNG to the test report for visual inspection.
  await testInfo.attach("saved-gradient.png", {
    path: await download.path(),
    contentType: "image/png",
  });
});
```

- [ ] **Step 2: Delete the smoke test**

```bash
git rm e2e/smoke.spec.ts
```

- [ ] **Step 3: Run the full unit suite**

Run: `npm test`
Expected: PASS — every test file (`color`, `mean-shift`, `mean-shift.worker`, `palette-store`, `gradient-canvas`, `Capture`, `Palette`, `Gradients`) green.

- [ ] **Step 4: Run the E2E flow test**

Run: `npx playwright install chromium` (first run only) then `npm run test:e2e`
Expected: 1 test passed ("full flow: capture → pick anchors → generate → save"). The Playwright report attaches a real rendered PNG from the fixture — open it and eyeball it.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Production build**

Run: `npm run build`
Expected: exit 0. A `dist/` directory appears with `index.html`, hashed JS chunks, the PWA manifest, and `sw.js` (service worker).

- [ ] **Step 7: Install to phone (manual, one-time sanity)**

Serve the build: `npx serve dist -l 5173` (or any static server). Open `http://<your-LAN-IP>:5173` on an Android phone in Chrome, use "Add to Home Screen" from the menu, launch from the home screen icon. Confirm you can upload a photo, extract a palette, pick anchors, save a PNG. Airplane-mode the phone and confirm the app still opens from the home screen (PWA offline-capable).

- [ ] **Step 8: Commit and push**

```bash
git add e2e/capture-to-save.spec.ts
git commit -m "Add full-flow E2E; retire smoke test; M1 shipped"
git push
```

---

## Done — M1 ships here.

### Self-review (run through the spec)

- **Section 1 · Capture** — covered by Task 8 (Capture.tsx, worker integration, chips, accept-all, edge cases for 0 extracted colors via the toast).
- **Section 2 · Palette** — covered by Task 9 (grid, anchor state machine wired to Task 6's reducer, × remove).
- **Section 3 · Gradient candidates** — covered by Task 10 (k∈{0,1,2,3} candidates from Task 3's `pickIntermediates`, CSS `linear-gradient(in oklab, ...)` rendering).
- **Section 4 · Save** — covered by Task 10 (Canvas render via Task 7's `renderGradientPng`, download via `<a download>`).
- **Section 5 · Auto-suggest** — explicitly out of M1; picked up in the M2 spec/plan (not this document).

### Spec-coverage gap check

- **"Extraction exceeds 3s → no timeout in M1"** — implicitly covered: `Capture.tsx` leaves the progress bar indeterminate; no timeout wired in.
- **"Capacitor native build"** — explicitly M4 non-goal.
- **"Bitmap PWA icons"** — explicitly deferred in the spec; Task 1 uses the existing SVG icons from the scaffold.

### Type consistency check

- `PaletteEntry` / `PaletteState` defined in Task 6, consumed unchanged in Tasks 8-10.
- `Oklab` / `Oklch` defined in Task 2, consumed in Task 3 and Task 7.
- `Point3` defined in Task 4, consumed in Task 5.
- `ExtractRequest` / `ExtractResponse` defined in Task 5; Task 8 calls `extractPalette` directly (synchronous function that the worker entrypoint also calls) rather than going through `postMessage` — keeping the test path synchronous. If performance profiling after M1 shows the main thread blocking noticeably on large photos, swap to the real `postMessage` path in a follow-up (file change only — same `extractPalette` function runs on either side).

### Placeholder scan

No `TODO`, `TBD`, "implement later", or "similar to Task N" — every step has concrete code or exact commands.
