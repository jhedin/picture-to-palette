import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonText,
  IonTitle,
  IonToast,
  IonToolbar,
} from "@ionic/react";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useHistory, useLocation } from "react-router-dom";
import { usePalette } from "../lib/palette-store";
import type { DmcColor } from "../lib/palette-store";
import {
  hexToOklab,
  sortGradient,
  pickEvenly,
  swatchMeta,
  scoreGradientOutliers,
  gradientBetween,
  oklabDistHex,
  nearestNeighborSort,
  shadeRamp,
  NATURAL_PERP_THRESHOLD,
  NATURAL_PERP_ABS_CAP,
  type GradientMode,
} from "../lib/color";

const MODES: GradientMode[] = ["natural", "lightness", "saturation", "hue"];
const DMC_MODES: GradientMode[] = [...MODES, "shade"];
const MODE_DESC: Record<GradientMode, string> = {
  natural:    "Colors that perceptually sit on the line between your endpoints in OKLab space.",
  lightness:  "Colors sorted by brightness — dark to light or light to dark depending on your endpoints.",
  saturation: "Colors sorted by intensity — from muted to vivid or vice versa.",
  hue:        "Colors sorted along the shortest arc of the color wheel between your endpoints.",
  shade:      "Hue-shifted shading ramp — shadows drift cool, highlights drift warm, from the median-lightness midtone.",
};
import { idealDmcPositions, nearestUnusedDmc } from "../lib/dmc-match";
import { DMC_COLORS } from "../lib/dmc-colors";
import { renderGradientPng } from "../lib/gradient-canvas";

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export default function Gradients() {
  const { state, dispatch } = usePalette();
  const history = useHistory();
  const location = useLocation();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const dmcSet = state.dmcSet;
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isDmcMode = searchParams.get("mode") === "dmc" && dmcSet.length > 0;

  // In DMC mode, colorSpace = matched threads + full DMC library filtered to the
  // perp cylinder between the current anchors (wider threshold so the shelf is
  // generous; gradientBetween/idealDmcPositions do tighter filtering when building
  // the actual sequence).
  const colorSpace: string[] = useMemo(() => {
    if (!isDmcMode) return state.colors.map((c) => c.hex);
    const base = new Set(dmcSet.map((d) => d.hex));
    const anchorAHex = state.colors.find((c) => c.id === state.anchorA)?.hex;
    const anchorBHex = state.colors.find((c) => c.id === state.anchorB)?.hex;
    if (anchorAHex && anchorBHex) {
      const allDmcHexes = DMC_COLORS.map((d) => d.hex);
      const between = gradientBetween(allDmcHexes, anchorAHex, anchorBHex, "natural",
        { threshold: 0.40, absCap: 0.20 });
      for (const h of between) base.add(h);
    }
    return [...base];
  }, [isDmcMode, dmcSet, state.anchorA, state.anchorB, state.colors]);

  const dmcPool = useMemo(() => {
    if (!isDmcMode) return [];
    const result: DmcColor[] = [];
    const seen = new Set<string>();
    for (const hex of colorSpace) {
      const entry = DMC_COLORS.find((d) => d.hex === hex);
      if (entry && !seen.has(entry.id)) { result.push(entry); seen.add(entry.id); }
    }
    return result;
  }, [isDmcMode, colorSpace]);

  const [sortMode, setSortMode] = useState<GradientMode>(() => (state.gradientSortMode as GradientMode) || "natural");
  const [sequence, setSequence] = useState<string[]>(() => state.gradientSeq);
  const [pinnedHexes, setPinnedHexes] = useState<string[]>(() => state.gradientPinned);
  const [selectedSeqHex, setSelectedSeqHex] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [maxColors, setMaxColors] = useState<number>(() => state.gradientMaxColors);

  const [perpRel, setPerpRel] = useState(NATURAL_PERP_THRESHOLD);
  const [perpCap, setPerpCap] = useState(NATURAL_PERP_ABS_CAP);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [fillMode, setFillMode] = useState<"gap-fill" | "farthest">("gap-fill");

  const perpOpts = useMemo(() => ({ threshold: perpRel, absCap: perpCap }), [perpRel, perpCap]);

  // Keep a ref so the seeding effect can check pins without adding them to its dep array.
  const pinnedRef = useRef<string[]>(state.gradientPinned);
  useEffect(() => { pinnedRef.current = pinnedHexes; }, [pinnedHexes]);
  // Sync gradient state back to the store so it survives tab navigation.
  useEffect(() => {
    dispatch({ type: "SET_GRADIENT", seq: sequence, pinned: pinnedHexes, sortMode, maxColors });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequence, pinnedHexes, sortMode, maxColors]);

  // Sort a set of colours according to the given mode (or the current sortMode).
  function sortWithMode(cs: string[], m: GradientMode = sortMode): string[] {
    const a = state.colors.find((c) => c.id === state.anchorA)?.hex;
    const b = state.colors.find((c) => c.id === state.anchorB)?.hex;
    if (m === "natural") {
      if (a && b) return sortGradient(cs, a, b);
      // Without anchors use nearest-neighbour so similar colours stay adjacent
      // (projection-onto-L-axis would interleave unrelated hues at the same lightness).
      return nearestNeighborSort(cs);
    }
    if (m === "lightness") return [...cs].sort((x, y) => hexToOklab(x).L - hexToOklab(y).L);
    if (m === "saturation") {
      const chroma = (h: string) => { const lab = hexToOklab(h); return Math.sqrt(lab.a * lab.a + lab.b * lab.b); };
      return [...cs].sort((x, y) => chroma(x) - chroma(y));
    }
    if (m === "hue") {
      const hueOf = (h: string) => { const lab = hexToOklab(h); return Math.atan2(lab.b, lab.a); };
      return [...cs].sort((x, y) => hueOf(x) - hueOf(y));
    }
    // shade — hue-shifted shadow→highlight ramp from the median-lightness midtone
    const byL = [...cs].sort((x, y) => hexToOklab(x).L - hexToOklab(y).L);
    const midtone = byL[Math.floor(byL.length / 2)];
    const { shadows, highlights } = shadeRamp(cs, midtone, cs.length);
    const ordered = [...shadows, midtone, ...highlights];
    const inRamp = new Set(ordered);
    return [...ordered, ...cs.filter((h) => !inRamp.has(h))];
  }

  function buildSorted(cs: string[]): string[] { return sortWithMode(cs, sortMode); }

  // Seed sequence on first load or when anchors newly arrive (only if no manual picks).
  const prevAnchorKey = useRef("");
  useEffect(() => {
    if (colorSpace.length === 0) return;
    const anchorKey = `${state.anchorA ?? ""}|${state.anchorB ?? ""}`;
    const anchorsChanged = anchorKey !== prevAnchorKey.current && !!(state.anchorA && state.anchorB);
    // Re-seed only: (a) sequence is empty, or (b) anchors newly arrived AND no manual picks yet.
    const shouldSeed = sequence.length === 0 || (anchorsChanged && pinnedRef.current.length === 0);
    if (!shouldSeed) return;
    prevAnchorKey.current = anchorKey;
    const anchorAHex = state.colors.find((c) => c.id === state.anchorA)?.hex;
    const anchorBHex = state.colors.find((c) => c.id === state.anchorB)?.hex;
    let seeded: string[];
    if (isDmcMode && anchorAHex && anchorBHex) {
      // DMC mode: generate 1 ideal OKLab intermediate, preferring existing threads.
      const preferred = new Set(dmcSet.map((d) => d.hex));
      const intermediates = idealDmcPositions(anchorAHex, anchorBHex, 1,
        [anchorAHex, anchorBHex], preferred);
      seeded = [anchorAHex, ...intermediates, anchorBHex];
    } else if (anchorAHex && anchorBHex && colorSpace.includes(anchorAHex) && colorSpace.includes(anchorBHex)) {
      const between = gradientBetween(colorSpace, anchorAHex, anchorBHex, sortMode, perpOpts);
      seeded = [anchorAHex, ...between, anchorBHex];
    } else {
      const sorted = buildSorted(colorSpace);
      const limit = maxColors > 0 ? maxColors : colorSpace.length;
      seeded = limit < sorted.length ? pickEvenly(sorted, limit) : sorted;
    }
    setSequence(seeded);
    // Pin the anchor endpoints so the slider can't remove them.
    setPinnedHexes(anchorAHex && anchorBHex ? [anchorAHex, anchorBHex] : []);
    setSelectedSeqHex(null);
    if (maxColors === 0) setMaxColors(seeded.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorSpace, state.anchorA, state.anchorB]);

  // Close alternatives panel if its color was removed from sequence.
  useEffect(() => {
    if (selectedSeqHex && !sequence.includes(selectedSeqHex)) setSelectedSeqHex(null);
  }, [sequence, selectedSeqHex]);

  // Bump maxColors when sequence grows past it (manual additions).
  useEffect(() => {
    if (maxColors > 0 && sequence.length > maxColors) setMaxColors(sequence.length);
  }, [sequence.length, maxColors]);

  // Bump maxColors up when pinned count exceeds it.
  useEffect(() => {
    if (maxColors > 0 && pinnedHexes.length > maxColors) setMaxColors(pinnedHexes.length);
  }, [pinnedHexes.length, maxColors]);

  function applyMaxColors(n: number, mode: "gap-fill" | "farthest" = fillMode) {
    const effective = Math.max(n, pinnedHexes.length);
    setMaxColors(effective);
    setSequence((prev) => {
      // When 2+ pinned colors exist, always recompute from the pinned subset.
      // This makes the slider deterministic: the same count + same pins always
      // produces the same sequence regardless of how the slider was moved.
      const pinned = prev.filter((h) => pinnedHexes.includes(h));

      if (pinned.length >= 2) {
        const toAdd = effective - pinned.length;
        if (toAdd <= 0) return pinned;

        if (isDmcMode) {
          const prefSet = new Set(dmcSet.map((d) => d.hex));
          let result = [...pinned];
          const used = new Set(result);
          for (let step = 0; step < toAdd; step++) {
            const labs = result.map(hexToOklab);
            let maxDistSq = 0, gapIdx = 0;
            for (let i = 0; i < result.length - 1; i++) {
              const a = labs[i], b = labs[i + 1];
              const dSq = (a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2;
              if (dSq > maxDistSq) { maxDistSq = dSq; gapIdx = i; }
            }
            const a = labs[gapIdx], b = labs[gapIdx + 1];
            const ideal = { L: (a.L + b.L) / 2, a: (a.a + b.a) / 2, b: (a.b + b.b) / 2 };
            const match = nearestUnusedDmc(ideal, used, prefSet);
            const fillHex = match ? match.hex : "#000000";
            if (match) used.add(fillHex);
            result.splice(gapIdx + 1, 0, fillHex);
          }
          return result;
        }

        // Non-DMC: gap-fill from pinned with t-projection + perp corridor filter.
        // Applying the same perpendicular filter as gradientBetween prevents
        // off-line colors from winning over better on-line candidates.
        let result = [...pinned];
        const used = new Set(result);
        const endA = hexToOklab(result[0]);
        const endB = hexToOklab(result[result.length - 1]);
        const ab = { L: endB.L - endA.L, a: endB.a - endA.a, b: endB.b - endA.b };
        const abLenSq = ab.L ** 2 + ab.a ** 2 + ab.b ** 2;
        const abLen = Math.sqrt(abLenSq);
        const maxPerp = abLen > 0 ? Math.min(perpRel * abLen, perpCap) : Infinity;
        const maxPerpSq = maxPerp * maxPerp;
        const csLabs = colorSpace.map((hex) => ({ hex, lab: hexToOklab(hex) }));
        let labs = result.map(hexToOklab);

        for (let step = 0; step < toAdd; step++) {
          let bestHex: string | null = null, bestLab = endA;

          if (mode === "farthest") {
            // Farthest-point sampling: pick the candidate that maximises its
            // minimum distance to any already-selected color, subject to the
            // perp corridor. Guarantees perceptually spread coverage.
            let bestMinDistSq = -1;
            for (const { hex, lab } of csLabs) {
              if (used.has(hex)) continue;
              if (abLenSq > 0) {
                const ap = { L: lab.L - endA.L, a: lab.a - endA.a, b: lab.b - endA.b };
                const t = (ap.L * ab.L + ap.a * ab.a + ap.b * ab.b) / abLenSq;
                if (t < -0.05 || t > 1.05) continue;
                const apLenSq = ap.L ** 2 + ap.a ** 2 + ap.b ** 2;
                if (Math.max(0, apLenSq - t * t * abLenSq) > maxPerpSq) continue;
              }
              let minDistSq = Infinity;
              for (const el of labs) {
                const dSq = (lab.L - el.L) ** 2 + (lab.a - el.a) ** 2 + (lab.b - el.b) ** 2;
                if (dSq < minDistSq) minDistSq = dSq;
              }
              if (minDistSq > bestMinDistSq) { bestMinDistSq = minDistSq; bestHex = hex; bestLab = lab; }
            }
          } else {
            // Gap-fill: find the largest gap, then insert the color nearest to
            // its midpoint that also falls within the gap's t-range.
            const gaps = Array.from({ length: result.length - 1 }, (_, i) => {
              const a = labs[i], b = labs[i + 1];
              return { i, dSq: (a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2 };
            }).sort((x, y) => y.dSq - x.dSq);
            for (const { i: gapIdx } of gaps) {
              const a = labs[gapIdx], b = labs[gapIdx + 1];
              const ideal = { L: (a.L + b.L) / 2, a: (a.a + b.a) / 2, b: (a.b + b.b) / 2 };
              let tMin = -0.05, tMax = 1.05;
              if (abLenSq > 0) {
                const t_lo = ((a.L - endA.L) * ab.L + (a.a - endA.a) * ab.a + (a.b - endA.b) * ab.b) / abLenSq;
                const t_hi = ((b.L - endA.L) * ab.L + (b.a - endA.a) * ab.a + (b.b - endA.b) * ab.b) / abLenSq;
                tMin = Math.min(t_lo, t_hi) - 0.02;
                tMax = Math.max(t_lo, t_hi) + 0.02;
              }
              let bestDistSq = Infinity;
              for (const { hex, lab } of csLabs) {
                if (used.has(hex)) continue;
                let perpSq = 0;
                if (abLenSq > 0) {
                  const ap = { L: lab.L - endA.L, a: lab.a - endA.a, b: lab.b - endA.b };
                  const t = (ap.L * ab.L + ap.a * ab.a + ap.b * ab.b) / abLenSq;
                  if (t < tMin || t > tMax) continue;
                  const apLenSq = ap.L ** 2 + ap.a ** 2 + ap.b ** 2;
                  perpSq = Math.max(0, apLenSq - t * t * abLenSq);
                  if (perpSq > maxPerpSq) continue;
                }
                const dSq = (lab.L - ideal.L) ** 2 + (lab.a - ideal.a) ** 2 + (lab.b - ideal.b) ** 2 + perpSq;
                if (dSq < bestDistSq) { bestDistSq = dSq; bestHex = hex; bestLab = lab; }
              }
              if (bestHex) break;
            }
          }

          if (!bestHex) break;
          used.add(bestHex);
          // Insert at the t-ordered position so the sequence stays sorted
          // regardless of which selection algorithm picked the candidate.
          let insertPos = result.length;
          if (abLenSq > 0) {
            const apb = { L: bestLab.L - endA.L, a: bestLab.a - endA.a, b: bestLab.b - endA.b };
            const t_b = (apb.L * ab.L + apb.a * ab.a + apb.b * ab.b) / abLenSq;
            for (let j = 0; j < labs.length; j++) {
              const lj = labs[j];
              const t_j = ((lj.L - endA.L) * ab.L + (lj.a - endA.a) * ab.a + (lj.b - endA.b) * ab.b) / abLenSq;
              if (t_b < t_j) { insertPos = j; break; }
            }
          }
          result.splice(insertPos, 0, bestHex);
          labs.splice(insertPos, 0, bestLab);
        }
        // t-ordered insertion prevents out-of-range picks but adjacent colors
        // can still zigzag in the perpendicular directions. Re-sequence the
        // interior by nearest-neighbor to minimise the total 3D path length.
        if (result.length > 2) {
          const first = result[0], last = result[result.length - 1];
          let cur = hexToOklab(first);
          const pool = result.slice(1, -1).map((h) => ({ hex: h, lab: hexToOklab(h) }));
          const ordered: string[] = [];
          while (pool.length > 0) {
            let minD = Infinity, idx = 0;
            for (let i = 0; i < pool.length; i++) {
              const d = (cur.L - pool[i].lab.L) ** 2 + (cur.a - pool[i].lab.a) ** 2 + (cur.b - pool[i].lab.b) ** 2;
              if (d < minD) { minD = d; idx = i; }
            }
            cur = pool[idx].lab;
            ordered.push(pool.splice(idx, 1)[0].hex);
          }
          result = [first, ...ordered, last];
        }
        return result;
      }

      // Fewer than 2 pins — fall back to incremental on prev.
      if (effective >= prev.length) {
        const toAdd = effective - prev.length;
        if (toAdd <= 0) return prev;
        const sorted = buildSorted(colorSpace).filter((h) => !prev.includes(h));
        if (sorted.length === 0) return prev;
        if (mode === "gap-fill") {
          return [...prev, ...sorted.slice(0, toAdd)];
        }
        // Farthest mode: radius exclusion — each new color must be at least
        // 0.10 OKLab units from everything already selected.
        const MIN_DIST_SQ = 0.10 * 0.10;
        const result = [...prev];
        const resultLabs = result.map(hexToOklab);
        for (const hex of sorted) {
          if (result.length >= effective) break;
          const lab = hexToOklab(hex);
          const tooClose = resultLabs.some(
            (el) => (lab.L - el.L) ** 2 + (lab.a - el.a) ** 2 + (lab.b - el.b) ** 2 < MIN_DIST_SQ,
          );
          if (!tooClose) { result.push(hex); resultLabs.push(lab); }
        }
        if (result.length < effective) {
          result.push(...sorted.filter((h) => !result.includes(h)).slice(0, effective - result.length));
        }
        return result;
      }
      // Shrink without enough pins: min-gap removal.
      let result = [...prev];
      let labs = result.map(hexToOklab);
      while (result.length > effective) {
        let bestIdx = -1, bestGapSq = Infinity;
        for (let i = 0; i < result.length; i++) {
          if (pinnedHexes.includes(result[i])) continue;
          const lLab = i > 0 ? labs[i - 1] : null;
          const rLab = i < result.length - 1 ? labs[i + 1] : null;
          const nb = lLab ?? rLab!;
          const gapSq = (lLab && rLab)
            ? (lLab.L-rLab.L)**2 + (lLab.a-rLab.a)**2 + (lLab.b-rLab.b)**2
            : (labs[i].L-nb.L)**2 + (labs[i].a-nb.a)**2 + (labs[i].b-nb.b)**2;
          if (gapSq < bestGapSq) { bestGapSq = gapSq; bestIdx = i; }
        }
        if (bestIdx === -1) break;
        result.splice(bestIdx, 1);
        labs.splice(bestIdx, 1);
      }
      return result;
    });
  }

  function handleAddToShelf() {
    for (const hex of sequence) {
      const dmc = dmcPool.find((d) => d.hex === hex);
      if (dmc) dispatch({ type: "ADD_DMC", color: dmc });
    }
  }

  // ── dnd-kit ──────────────────────────────────────────────────────────────
  // Named drop zones need to beat nearby sortable chips.
  // 1. pointerWithin: exact pointer position — fires when pointer is inside any droppable
  // 2. rectIntersection on named zones: tolerant overlap check for the drag overlay rect
  // 3. closestCenter: fallback for sortable reordering
  const NAMED_ZONES = new Set(["shelf-drop-zone", "trash-zone", "shadow-zone", "highlight-zone"]);
  const collisionDetection = useCallback(
    (args: Parameters<typeof closestCenter>[0]) => {
      const within = pointerWithin(args);
      if (within.length > 0) {
        // Named zones always beat sortable chips even when both contain the pointer.
        const namedFirst = within.find((c) => NAMED_ZONES.has(String(c.id)));
        return namedFirst ? [namedFirst] : within;
      }
      const intersecting = rectIntersection(args);
      const namedZone = intersecting.find((c) => NAMED_ZONES.has(String(c.id)));
      if (namedZone) return [namedZone];
      return closestCenter(args);
    },
    [],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  // Track the last stable "over" and raw pointer position during drag so
  // handleDragEnd can walk the DOM to find the real named drop zone even when
  // the final pointer coordinates glitch onto a gradient chip.
  const lastOverIdRef = useRef<string | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!activeId) { lastPointerRef.current = null; return; }
    const track = (e: PointerEvent) => { lastPointerRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", track);
    return () => window.removeEventListener("pointermove", track);
  }, [activeId]);

  function handleDragStart({ active }: DragStartEvent) {
    console.log("[drag-start]", String(active.id));
    setActiveId(String(active.id));
    setSelectedSeqHex(null);
    lastOverIdRef.current = null;
  }

  function handleDragOver({ over }: DragOverEvent) {
    const id = over ? String(over.id) : null;
    if (id !== lastOverIdRef.current) {
      console.log("[drag-over] target changed:", lastOverIdRef.current, "→", id);
    }
    if (over) lastOverIdRef.current = id!;
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    const activeIdStr = String(active.id);

    // Walk the DOM from the last known pointer position to find the true
    // drop target — any named zone div carries data-drop-zone so .closest()
    // finds it even if the pointer landed on a child element (chip label, etc).
    let overIdStr = over ? String(over.id) : null;
    const pt = lastPointerRef.current;
    const el = pt ? document.elementFromPoint(pt.x, pt.y) : null;
    const domZone = (el?.closest("[data-drop-zone]") as HTMLElement | null)?.dataset.dropZone;
    // eslint-disable-next-line no-debugger
    debugger; // ← browser breakpoint: inspect active, over, el, domZone, lastOverIdRef.current
    console.log("[drop]", {
      active: activeIdStr,
      over: over?.id ?? null,
      domEl: el?.tagName,
      domClass: el instanceof HTMLElement ? el.className : undefined,
      domZone,
      lastRef: lastOverIdRef.current,
    });
    if (domZone && NAMED_ZONES.has(domZone)) overIdStr = domZone;
    // Ref fallback: if the DOM walk missed but the last stable hover was a
    // named zone, honour that intent.
    if (!overIdStr || !NAMED_ZONES.has(overIdStr)) {
      if (lastOverIdRef.current && NAMED_ZONES.has(lastOverIdRef.current)) {
        overIdStr = lastOverIdRef.current;
      }
    }
    console.log("[drop] resolved →", overIdStr);
    lastOverIdRef.current = null;
    lastPointerRef.current = null;
    if (!overIdStr) return;
    if (activeIdStr.startsWith("shelf:")) {
      const hex = activeIdStr.slice(6);
      setSequence((prev) => {
        console.log("[drop-seq] prev=", prev, "hex=", hex, "over=", overIdStr, "alreadyIn=", prev.includes(hex));
        if (prev.includes(hex)) return prev;
        const overIdx = prev.indexOf(overIdStr);
        const insertAt = overIdx >= 0 ? overIdx : prev.length;
        const next = [...prev];
        next.splice(insertAt, 0, hex);
        console.log("[drop-seq] next=", next);
        return next;
      });
      setPinnedHexes((prev) => prev.includes(hex) ? prev : [...prev, hex]);
    } else if (overIdStr === "trash-zone") {
      if (activeIdStr.startsWith("shelf:")) {
        // Shelf item dragged to trash — remove from dmcSet permanently.
        const hex = activeIdStr.slice(6);
        if (isDmcMode) {
          const dmc = dmcPool.find((d) => d.hex === hex);
          if (dmc) dispatch({ type: "REMOVE_DMC", id: dmc.id });
        }
      } else {
        // Gradient chip dragged to trash — remove from gradient.
        setSequence((prev) => prev.filter((h) => h !== activeIdStr));
        setPinnedHexes((prev) => prev.filter((h) => h !== activeIdStr));
        setMaxColors((prev) => Math.max(Math.max(1, pinnedHexes.filter((h) => h !== activeIdStr).length), prev - 1));
      }
    } else if (overIdStr === "shadow-zone" || overIdStr === "highlight-zone") {
      const hex = activeIdStr.startsWith("shelf:") ? activeIdStr.slice(6) : activeIdStr;
      const isShadow = overIdStr === "shadow-zone";
      setSequence((prev) => {
        const without = prev.filter((h) => h !== hex);
        return isShadow ? [hex, ...without] : [...without, hex];
      });
      setPinnedHexes((prev) => prev.includes(hex) ? prev : [...prev, hex]);
    } else if (overIdStr === "shelf-drop-zone") {
      setSequence((prev) => prev.filter((h) => h !== activeIdStr));
      setPinnedHexes((prev) => prev.filter((h) => h !== activeIdStr));
      setMaxColors((prev) => Math.max(Math.max(1, pinnedHexes.filter((h) => h !== activeIdStr).length), prev - 1));
    } else {
      setSequence((prev) => {
        const oldIdx = prev.indexOf(activeIdStr);
        const newIdx = prev.indexOf(overIdStr);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return prev;
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }

  const metas = useMemo(() => sequence.map(swatchMeta), [sequence]);
  const outlierMap = useMemo(() => {
    const results = scoreGradientOutliers(sequence);
    return new Map(results.map((r) => [r.hex, r.isOutlier]));
  }, [sequence]);

  // OKLab scatter analysis: compute (t, perp) for every palette color relative to anchors A→B.
  const oklabAnalysis = useMemo(() => {
    const anchorAHex = state.colors.find((c) => c.id === state.anchorA)?.hex;
    const anchorBHex = state.colors.find((c) => c.id === state.anchorB)?.hex;
    if (!anchorAHex || !anchorBHex) return null;
    const a = hexToOklab(anchorAHex);
    const b = hexToOklab(anchorBHex);
    const ab = { L: b.L - a.L, a: b.a - a.a, b: b.b - a.b };
    const abLenSq = ab.L * ab.L + ab.a * ab.a + ab.b * ab.b;
    if (abLenSq === 0) return null;
    const abLen = Math.sqrt(abLenSq);
    const maxPerp = Math.min(perpOpts.threshold * abLen, perpOpts.absCap);
    const points = colorSpace.map((hex) => {
      const lab = hexToOklab(hex);
      const ap = { L: lab.L - a.L, a: lab.a - a.a, b: lab.b - a.b };
      const apLenSq = ap.L * ap.L + ap.a * ap.a + ap.b * ap.b;
      const t = (ap.L * ab.L + ap.a * ab.a + ap.b * ab.b) / abLenSq;
      const perpSq = Math.max(0, apLenSq - t * t * abLenSq);
      const perp = Math.sqrt(perpSq);
      const included = t > 0 && t < 1 && perp < maxPerp;
      return { hex, t, perp, included };
    });
    return { points, abLen, maxPerp, anchorAHex, anchorBHex };
  }, [state.anchorA, state.anchorB, state.colors, colorSpace, perpOpts]);

  function handleModeChange(m: GradientMode) {
    setSortMode(m);
    setSequence((prev) => {
      if (prev.length < 2) return prev;
      const first = prev[0], last = prev[prev.length - 1];
      const numInterior = prev.length - 2;
      // Reselect interior from colorSpace for the new mode rather than just
      // re-sorting the same colors — the best choices differ per mode.
      const excludeEnds = new Set([first, last]);
      const available = colorSpace.filter((h) => !excludeEnds.has(h));
      if (m === "natural") {
        const between = gradientBetween(available, first, last, m, perpOpts);
        const interior = numInterior >= between.length ? between : pickEvenly(between, numInterior);
        return [first, ...interior, last];
      }
      // Non-natural: sort available by the mode's scalar in anchor direction.
      const scalarOf = (h: string) => {
        const lab = hexToOklab(h);
        if (m === "lightness") return lab.L;
        if (m === "saturation") return Math.sqrt(lab.a ** 2 + lab.b ** 2);
        if (m === "hue") return Math.atan2(lab.b, lab.a);
        return lab.L; // shade fallback
      };
      const sorted = sortWithMode(available, m);
      const ascending = scalarOf(first) <= scalarOf(last);
      const oriented = ascending ? sorted : [...sorted].reverse();
      const interior = numInterior <= 0 ? []
        : numInterior >= oriented.length ? oriented
        : pickEvenly(oriented, numInterior);
      return [first, ...interior, last];
    });
    setSelectedSeqHex(null);
  }

  // Alternatives for the selected slot: use gradientBetween between its neighbours (mode-aware).
  const alternatives = useMemo(() => {
    if (!selectedSeqHex) return [];
    const idx = sequence.indexOf(selectedSeqHex);
    const leftHex = idx > 0 ? sequence[idx - 1] : null;
    const rightHex = idx < sequence.length - 1 ? sequence[idx + 1] : null;
    if (leftHex && rightHex) {
      const between = gradientBetween(colorSpace, leftHex, rightHex, sortMode, perpOpts)
        .filter((h) => !sequence.includes(h));
      if (between.length > 0) return between.slice(0, 12);
    }
    // Endpoint or no between-candidates: nearest by OKLab distance.
    return colorSpace
      .filter((h) => !sequence.includes(h))
      .sort((a, b) => oklabDistHex(a, selectedSeqHex) - oklabDistHex(b, selectedSeqHex))
      .slice(0, 12);
  }, [selectedSeqHex, sequence, colorSpace, sortMode]);

  function handleSwapAlternative(candidate: string) {
    if (!selectedSeqHex) return;
    const oldHex = selectedSeqHex;
    setSequence((prev) => {
      const idx = prev.indexOf(oldHex);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = candidate;
      return next;
    });
    // Remove old pin, pin the explicitly chosen replacement.
    setPinnedHexes((prev) => {
      const next = prev.filter((h) => h !== oldHex);
      return next.includes(candidate) ? next : [...next, candidate];
    });
    setSelectedSeqHex(candidate);
  }

  const [processedThumb, setProcessedThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!isDmcMode || !state.captureThumb || colorSpace.length === 0) {
      setProcessedThumb(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, img.width, img.height);
      const d = id.data;

      const pool = colorSpace.map((hex) => ({
        lab: hexToOklab(hex),
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
      }));
      if (pool.length === 0) return;
      const THRESHOLD_SQ = 0.20 * 0.20;

      for (let i = 0; i < d.length; i += 4) {
        const lr = srgbToLinear(d[i]), lg = srgbToLinear(d[i + 1]), lb = srgbToLinear(d[i + 2]);
        const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
        const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
        const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
        const pL = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
        const pa = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
        const pb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

        let minDistSq = Infinity, best = pool[0];
        for (const entry of pool) {
          const dSq = (pL - entry.lab.L) ** 2 + (pa - entry.lab.a) ** 2 + (pb - entry.lab.b) ** 2;
          if (dSq < minDistSq) { minDistSq = dSq; best = entry; }
        }
        if (minDistSq <= THRESHOLD_SQ) {
          d[i] = best.r; d[i + 1] = best.g; d[i + 2] = best.b;
        } else {
          d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
        }
      }

      ctx.putImageData(id, 0, 0);
      if (!cancelled) setProcessedThumb(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.src = state.captureThumb;
    return () => { cancelled = true; };
  }, [isDmcMode, state.captureThumb, colorSpace]);
  const { setNodeRef: setShelfDropRef, isOver: isOverShelf } = useDroppable({ id: "shelf-drop-zone" });
  const { setNodeRef: setTrashRef, isOver: isOverTrash } = useDroppable({ id: "trash-zone" });
  const { setNodeRef: setShadowZoneRef, isOver: isOverShadow } = useDroppable({ id: "shadow-zone" });
  const { setNodeRef: setHighlightZoneRef, isOver: isOverHighlight } = useDroppable({ id: "highlight-zone" });

  function handleExtendShadow() {
    if (sequence.length === 0 || !isDmcMode) return;
    const allDmcHexes = DMC_COLORS.map((d) => d.hex);
    const { shadows } = shadeRamp(allDmcHexes, sequence[0], 1);
    if (shadows.length === 0) return;
    const hex = shadows[0];
    if (sequence.includes(hex)) return;
    setSequence((prev) => [hex, ...prev]);
  }

  function handleExtendHighlight() {
    if (sequence.length === 0 || !isDmcMode) return;
    const allDmcHexes = DMC_COLORS.map((d) => d.hex);
    const { highlights } = shadeRamp(allDmcHexes, sequence[sequence.length - 1], 1);
    if (highlights.length === 0) return;
    const hex = highlights[highlights.length - 1];
    if (sequence.includes(hex)) return;
    setSequence((prev) => [...prev, hex]);
  }

  const shelf = colorSpace.filter((h) => !sequence.includes(h));
  const activeHex = activeId
    ? activeId.startsWith("shelf:") ? activeId.slice(6) : activeId
    : null;

  const pinnedFloor = Math.max(1, pinnedHexes.length);
  const sliderValue = Math.max(maxColors > 0 ? maxColors : colorSpace.length, pinnedFloor);

  async function handleSave() {
    if (sequence.length < 2) return;
    const dataUrl = await renderGradientPng(sequence, 1080, 240);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    a.href = dataUrl;
    a.download = `palette-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSavedMsg("Saved to downloads");
  }

  if (colorSpace.length === 0) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start"><IonBackButton defaultHref="/capture" text="Back" /></IonButtons>
            <IonTitle>Gradient</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonText><p>Extract some colors on the Capture screen first.</p></IonText>
          <IonButton expand="block" onClick={() => history.push("/capture")}>Go to Capture</IonButton>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref={isDmcMode ? "/dmc" : "/palette"} text={isDmcMode ? "DMC" : "Palette"} />
          </IonButtons>
          <IonTitle>
            Gradient{isDmcMode && <span style={{ fontSize: 11, opacity: 0.55, fontWeight: 400 }}> DMC</span>}
          </IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={({ active }) => {
            console.log("🚨 [drag-cancel] gesture cancelled for:", String(active.id));
            setActiveId(null);
            lastOverIdRef.current = null;
            lastPointerRef.current = null;
          }}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        >
          {/* ── Capture preview (DMC mode) ───────────────────────────── */}
          {isDmcMode && processedThumb && (
            <img
              src={processedThumb}
              alt="Capture preview posterized to current palette"
              style={{
                width: "100%",
                maxHeight: 180,
                objectFit: "contain",
                borderRadius: 8,
                marginBottom: 12,
                display: "block",
              }}
            />
          )}

          {/* ── Mode selector ─────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {(isDmcMode ? DMC_MODES : MODES).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => handleModeChange(m)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 20,
                  border: "1px solid var(--ion-color-primary)",
                  background: sortMode === m ? "var(--ion-color-primary)" : "transparent",
                  color: sortMode === m ? "var(--ion-color-primary-contrast)" : "var(--ion-color-primary)",
                  fontSize: 13,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--ion-color-medium)", margin: "0 0 12px" }}>
            {MODE_DESC[sortMode]}
          </p>

          {/* ── Fill mode + max-colors slider ────────────────────────── */}
          {colorSpace.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--ion-color-medium)", whiteSpace: "nowrap" }}>Fill:</span>
              {(["gap-fill", "farthest"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setFillMode(m); applyMaxColors(sliderValue, m); }}
                  style={{
                    padding: "2px 10px",
                    borderRadius: 20,
                    border: "1px solid var(--ion-color-primary)",
                    background: fillMode === m ? "var(--ion-color-primary)" : "transparent",
                    color: fillMode === m ? "var(--ion-color-primary-contrast)" : "var(--ion-color-primary)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {m === "gap-fill" ? "Gap-fill" : "Spread"}
                </button>
              ))}
            </div>
          )}
          {colorSpace.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--ion-color-medium)", whiteSpace: "nowrap" }}>
                Colors: {sequence.length > 0 ? sequence.length : sliderValue}
                {pinnedHexes.length > 0 && (
                  <span style={{ opacity: 0.6 }}> ({pinnedHexes.length} pinned)</span>
                )}
              </span>
              <input
                type="range"
                min={pinnedFloor}
                max={colorSpace.length}
                value={sliderValue}
                onChange={(e) => applyMaxColors(Number(e.target.value))}
                style={{ flex: 1 }}
              />
            </div>
          )}

          {/* ── Analyze OKLab toggle ──────────────────────────────────── */}
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setShowAnalysis((v) => !v)}
              style={{
                padding: "4px 12px",
                borderRadius: 20,
                border: "1px solid var(--ion-color-medium)",
                background: showAnalysis ? "var(--ion-color-medium)" : "transparent",
                color: showAnalysis ? "white" : "var(--ion-color-medium)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {showAnalysis ? "Hide OKLab Analysis" : "Analyze OKLab"}
            </button>
          </div>

          {/* ── OKLab Analysis panel ──────────────────────────────────── */}
          {showAnalysis && (
            <div style={{
              background: "var(--ion-color-light)",
              borderRadius: 10,
              padding: "12px",
              marginBottom: 12,
            }}>
              {/* Threshold sliders */}
              <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ion-color-medium)" }}>
                OKLab Filter Thresholds
                {oklabAnalysis && (
                  <span style={{ marginLeft: 8, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                    — effective: <strong>{oklabAnalysis.maxPerp.toFixed(3)}</strong>
                    {" "}
                    <span style={{ opacity: 0.6, fontSize: 10 }}>
                      ({oklabAnalysis.maxPerp === perpCap ? "cap limiting" : "relative limiting"})
                    </span>
                  </span>
                )}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--ion-color-medium)", minWidth: 140, whiteSpace: "nowrap" }}>
                  Relative: <strong>{perpRel.toFixed(2)}</strong>
                  {oklabAnalysis && <span style={{ opacity: 0.5, fontSize: 10 }}> ×{oklabAnalysis.abLen.toFixed(2)}={( perpRel * oklabAnalysis.abLen).toFixed(3)}</span>}
                </span>
                <input
                  type="range"
                  min={0.10}
                  max={0.50}
                  step={0.01}
                  value={perpRel}
                  onChange={(e) => setPerpRel(Number(e.target.value))}
                  style={{ flex: 1, opacity: oklabAnalysis && oklabAnalysis.maxPerp < perpCap ? 1 : 0.5 }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "var(--ion-color-medium)", minWidth: 140, whiteSpace: "nowrap" }}>
                  Cap: <strong>{perpCap.toFixed(2)}</strong>
                </span>
                <input
                  type="range"
                  min={0.05}
                  max={0.30}
                  step={0.01}
                  value={perpCap}
                  onChange={(e) => setPerpCap(Number(e.target.value))}
                  style={{ flex: 1, opacity: oklabAnalysis && oklabAnalysis.maxPerp === perpCap ? 1 : 0.5 }}
                />
              </div>
              <button
                type="button"
                onClick={() => { setSequence([]); setMaxColors(0); }}
                style={{
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--ion-color-primary)",
                  background: "transparent",
                  color: "var(--ion-color-primary)",
                  fontSize: 12,
                  cursor: "pointer",
                  marginBottom: 12,
                }}
              >
                Reseed
              </button>

              {/* Scatter plot */}
              {!oklabAnalysis ? (
                <p style={{ margin: 0, fontSize: 12, color: "var(--ion-color-medium)" }}>
                  Set anchors A and B on the Palette screen to see analysis.
                </p>
              ) : (
                <OklabScatter
                  points={oklabAnalysis.points}
                  maxPerp={oklabAnalysis.maxPerp}
                />
              )}
            </div>
          )}

          {/* ── Gradient strip ────────────────────────────────────────── */}
          {sequence.length === 0 ? (
            <IonText color="medium"><p style={{ fontSize: 13 }}>Add colors from the shelf below.</p></IonText>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ion-color-medium)" }}>
                  Gradient ({sequence.length}) — drag to reorder, tap to swap
                </p>
                <button
                  type="button"
                  onClick={() => { setSequence([]); setPinnedHexes([]); setSelectedSeqHex(null); }}
                  style={{ background: "none", border: "none", color: "var(--ion-color-medium)", fontSize: 12, cursor: "pointer", padding: "2px 4px", textDecoration: "underline" }}
                >
                  Clear
                </button>
              </div>

              {/* Shadow / Highlight endpoint zones + extend buttons */}
              <div style={{ display: "flex", gap: 4, alignItems: "stretch", marginBottom: 4 }}>
                {isDmcMode && (
                  <button
                    type="button"
                    onClick={handleExtendShadow}
                    title="Extend shadow one step darker"
                    style={{
                      width: 28, flexShrink: 0,
                      borderRadius: 6,
                      border: "1px solid rgba(128,128,128,0.3)",
                      background: "transparent",
                      color: "var(--ion-color-medium)",
                      fontSize: 16,
                      cursor: "pointer",
                    }}
                  >←</button>
                )}
                <div
                  ref={setShadowZoneRef}
                  data-drop-zone="shadow-zone"
                  style={{
                    width: 52, flexShrink: 0,
                    borderRadius: 8,
                    background: isOverShadow ? "rgba(var(--ion-color-primary-rgb),0.2)" : (sequence[0] ?? "var(--ion-color-light)"),
                    border: isOverShadow ? "2px dashed var(--ion-color-primary)" : "2px solid transparent",
                    display: "flex", alignItems: "flex-end", justifyContent: "center",
                    padding: "4px 2px",
                    minHeight: 64,
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.85)", textShadow: "0 1px 3px rgba(0,0,0,0.9)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, lineHeight: 1.2, textAlign: "center" }}>
                    {isOverShadow ? "Set\nShadow" : "Shadow"}
                  </span>
                </div>

                <SortableContext items={sequence} strategy={horizontalListSortingStrategy}>
                  <div style={{ display: "flex", flex: 1, borderRadius: 0, overflow: "visible", minHeight: 64 }}>
                    {sequence.map((hex, i) => {
                      const dmcEntry = isDmcMode ? dmcPool.find((d) => d.hex === hex) : null;
                      return (
                        <SeqItem
                          key={hex}
                          hex={hex}
                          index={i}
                          total={sequence.length}
                          isOutlier={outlierMap.get(hex) ?? false}
                          isPinned={pinnedHexes.includes(hex)}
                          isSelected={selectedSeqHex === hex}
                          label={dmcEntry ? dmcEntry.id : `L${metas[i].L.toFixed(2)}`}
                          title={
                            outlierMap.get(hex)
                              ? "Perceptual outlier — may not blend smoothly"
                              : (dmcEntry ? `${dmcEntry.id} — ${dmcEntry.name}` : hex)
                          }
                          onSelect={() => setSelectedSeqHex((prev) => prev === hex ? null : hex)}
                        />
                      );
                    })}
                  </div>
                </SortableContext>

                <div
                  ref={setHighlightZoneRef}
                  data-drop-zone="highlight-zone"
                  style={{
                    width: 52, flexShrink: 0,
                    borderRadius: 8,
                    background: isOverHighlight ? "rgba(var(--ion-color-primary-rgb),0.2)" : (sequence[sequence.length - 1] ?? "var(--ion-color-light)"),
                    border: isOverHighlight ? "2px dashed var(--ion-color-primary)" : "2px solid transparent",
                    display: "flex", alignItems: "flex-end", justifyContent: "center",
                    padding: "4px 2px",
                    minHeight: 64,
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.85)", textShadow: "0 1px 3px rgba(0,0,0,0.9)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, lineHeight: 1.2, textAlign: "center" }}>
                    {isOverHighlight ? "Set\nHighlight" : "Highlight"}
                  </span>
                </div>

                {isDmcMode && (
                  <button
                    type="button"
                    onClick={handleExtendHighlight}
                    title="Extend highlight one step lighter"
                    style={{
                      width: 28, flexShrink: 0,
                      borderRadius: 6,
                      border: "1px solid rgba(128,128,128,0.3)",
                      background: "transparent",
                      color: "var(--ion-color-medium)",
                      fontSize: 16,
                      cursor: "pointer",
                    }}
                  >→</button>
                )}
              </div>

              {/* ── Alternatives / pin panel ──────────────────────────── */}
              {selectedSeqHex && (
                <div style={{
                  background: "var(--ion-color-light)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  marginBottom: 10,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ion-color-medium)" }}>
                      {selectedSeqHex}
                    </span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={() => setPinnedHexes((prev) =>
                          prev.includes(selectedSeqHex)
                            ? prev.filter((h) => h !== selectedSeqHex)
                            : [...prev, selectedSeqHex]
                        )}
                        style={{
                          background: pinnedHexes.includes(selectedSeqHex) ? "var(--ion-color-primary)" : "transparent",
                          color: pinnedHexes.includes(selectedSeqHex) ? "white" : "var(--ion-color-medium)",
                          border: "1px solid currentColor",
                          borderRadius: 6,
                          fontSize: 11,
                          padding: "2px 8px",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        {pinnedHexes.includes(selectedSeqHex) ? "Pinned ✓" : "Pin"}
                      </button>
                      <button
                        type="button"
                        aria-label="Remove from gradient"
                        title="Remove from gradient"
                        onClick={() => {
                          const hex = selectedSeqHex;
                          setSequence((prev) => prev.filter((h) => h !== hex));
                          setPinnedHexes((prev) => prev.filter((h) => h !== hex));
                          setMaxColors((prev) => Math.max(Math.max(1, pinnedHexes.filter((h) => h !== hex).length), prev - 1));
                          setSelectedSeqHex(null);
                        }}
                        style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "var(--ion-color-danger)", lineHeight: 1, padding: "0 2px" }}
                      >
                        🗑
                      </button>
                      <button
                        type="button"
                        aria-label="Close panel"
                        onClick={() => setSelectedSeqHex(null)}
                        style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--ion-color-medium)", lineHeight: 1, padding: "0 2px" }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  {alternatives.length === 0 ? (
                    <span style={{ fontSize: 12, color: "var(--ion-color-medium)" }}>No alternatives on shelf — all palette colors are in the gradient.</span>
                  ) : (
                    <>
                      <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--ion-color-medium)" }}>
                        Tap to swap in nearest {isDmcMode ? "DMC thread" : "palette color"}:
                      </p>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {alternatives.map((hex) => {
                          const dmcEntry = isDmcMode ? dmcPool.find((d) => d.hex === hex) : null;
                          return (
                            <button
                              key={hex}
                              type="button"
                              aria-label={`Swap in ${hex}`}
                              title={dmcEntry ? `${dmcEntry.id} — ${dmcEntry.name}` : hex}
                              onClick={() => handleSwapAlternative(hex)}
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 6,
                                background: hex,
                                border: "2px solid rgba(0,0,0,0.12)",
                                cursor: "pointer",
                                flexShrink: 0,
                              }}
                            />
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {[...outlierMap.values()].some(Boolean) && (
                <p style={{ fontSize: 12, color: "#f59e0b", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, border: "3px solid #f59e0b", flexShrink: 0 }} />
                  Amber outline = may not blend smoothly with neighbours.
                </p>
              )}
            </>
          )}

          {/* ── Shelf ─────────────────────────────────────────────────── */}
          {(shelf.length > 0 || (activeId && !activeId.startsWith("shelf:"))) && (
            // The ref covers the label + chips so the whole section is the drop zone.
            <div
              ref={setShelfDropRef}
              data-drop-zone="shelf-drop-zone"
              style={{
                marginBottom: 16,
                borderRadius: 8,
                padding: 4,
                background: isOverShelf ? "rgba(var(--ion-color-primary-rgb), 0.15)" : "transparent",
                border: isOverShelf ? "2px dashed var(--ion-color-primary)" : (activeId && !activeId.startsWith("shelf:") ? "2px dashed rgba(128,128,128,0.3)" : "2px solid transparent"),
                transition: "background 0.15s, border-color 0.15s",
              }}
            >
              <p style={{ margin: "4px 0 6px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ion-color-medium)" }}>
                {isDmcMode ? "Available DMC threads" : "Palette"} — drag to position or back here to remove, tap to add
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minHeight: 44 }}>
                {shelf.map((hex) => {
                  const dmcEntry = isDmcMode ? dmcPool.find((d) => d.hex === hex) : null;
                  return (
                    <ShelfItem
                      key={hex}
                      hex={hex}
                      title={dmcEntry ? `${dmcEntry.id} — ${dmcEntry.name}` : hex}
                      onTap={() => {
                        setSequence((prev) => prev.includes(hex) ? prev : [...prev, hex]);
                        setPinnedHexes((prev) => prev.includes(hex) ? prev : [...prev, hex]);
                      }}
                    />
                  );
                })}
                {activeId && !activeId.startsWith("shelf:") && shelf.length === 0 && (
                  <span style={{ fontSize: 12, color: "var(--ion-color-medium)", alignSelf: "center", padding: "0 4px" }}>
                    Drop here to remove
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── DMC actions ───────────────────────────────────────────── */}
          {isDmcMode && sequence.length >= 2 && (
            <IonButton fill="outline" expand="block" onClick={handleAddToShelf} style={{ marginBottom: 8 }}>
              Add to shelf
            </IonButton>
          )}
          {/* ── Trash zone (DMC only — removes from collection) ─────── */}
          {isDmcMode && sequence.length > 0 && (
            <div
              ref={setTrashRef}
              data-drop-zone="trash-zone"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "10px 16px",
                marginBottom: 12,
                borderRadius: 8,
                border: isOverTrash
                  ? "2px dashed var(--ion-color-danger)"
                  : "2px dashed rgba(128,128,128,0.3)",
                background: isOverTrash ? "rgba(var(--ion-color-danger-rgb),0.08)" : "transparent",
                transition: "background 0.15s, border-color 0.15s",
                color: isOverTrash ? "var(--ion-color-danger)" : "var(--ion-color-medium)",
                fontSize: 13,
                cursor: "default",
                userSelect: "none",
              }}
            >
              🗑 Drop here to remove{isDmcMode ? " from gradient or collection" : ""}
            </div>
          )}

          {createPortal(
            <DragOverlay zIndex={9999} dropAnimation={null} style={{ pointerEvents: "none" }}>
              {activeHex && (
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  background: activeHex,
                  border: "3px solid white",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                  opacity: 0.9,
                  pointerEvents: "none",
                }} />
              )}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>

        <IonButton expand="block" onClick={handleSave} disabled={sequence.length < 2}>
          Save PNG
        </IonButton>

        <OklabPlane
          colorSpace={colorSpace}
          sequence={sequence}
          anchorAHex={oklabAnalysis?.anchorAHex}
          anchorBHex={oklabAnalysis?.anchorBHex}
          maxPerp={oklabAnalysis?.maxPerp}
        />

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

function SeqItem({
  hex,
  index,
  total,
  isOutlier,
  isPinned,
  isSelected,
  label,
  title,
  onSelect,
}: {
  hex: string;
  index: number;
  total: number;
  isOutlier: boolean;
  isPinned: boolean;
  isSelected: boolean;
  label: string;
  title: string;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: hex });

  // TouchSensor delay:150 distinguishes tap from drag, so standard onClick is safe.
  const boxShadow = isSelected
    ? "0 0 0 2px white, 0 0 0 4px rgba(0,0,0,0.35)"
    : undefined;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      title={title}
      style={{
        position: "relative",
        flex: 1,
        minWidth: 32,
        background: hex,
        borderRadius:
          total === 1 ? 10 :
          index === 0 ? "10px 0 0 10px" :
          index === total - 1 ? "0 10px 10px 0" : 0,
        cursor: "pointer",
        touchAction: "none",
        opacity: isDragging ? 0.35 : 1,
        outline: isOutlier && !isSelected ? "3px solid #f59e0b" : "none",
        outlineOffset: -3,
        boxShadow,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {/* Pin indicator — small white dot with dark halo, visible on any color */}
      {isPinned && (
        <div style={{
          position: "absolute",
          top: 4,
          right: 4,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.95)",
          border: "1px solid rgba(0,0,0,0.35)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
          pointerEvents: "none",
        }} />
      )}
      <div style={{
        position: "absolute",
        bottom: 2,
        left: 0,
        right: 0,
        textAlign: "center",
        fontSize: 8,
        color: "rgba(255,255,255,0.7)",
        textShadow: "0 1px 2px rgba(0,0,0,0.8)",
        pointerEvents: "none",
      }}>
        {label}
      </div>
    </div>
  );
}

// ── OKLab Scatter Plot ────────────────────────────────────────────────────
// Maps (t, perp) coordinates for all palette colors onto an SVG with:
//   X axis: t (projection parameter, 0=anchorA, 1=anchorB), range -0.1..1.1
//   Y axis: perp (OKLab perpendicular distance), range 0..0.4
// Colors below the threshold line AND with t ∈ (0,1) = full opacity (included).
// Colors above or outside t range = 40% opacity (excluded).
function OklabScatter({
  points,
  maxPerp,
}: {
  points: { hex: string; t: number; perp: number; included: boolean }[];
  maxPerp: number;
}) {
  // SVG coordinate system: viewBox="0 0 320 160"
  // t ∈ [-0.1, 1.1] → x ∈ [20, 300]
  // perp ∈ [0, 0.4] → y ∈ [150, 10] (inverted: high perp = low on screen)
  const tToX = (t: number) => 20 + ((t - (-0.1)) / 1.2) * 280;
  const perpToY = (perp: number) => 150 - (perp / 0.4) * 140;
  const thresholdY = perpToY(Math.min(maxPerp, 0.4));

  const PERP_AXIS_MAX = 0.4;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox="0 0 320 160"
        style={{ width: "100%", maxWidth: 320, display: "block", fontFamily: "monospace" }}
        aria-label="OKLab scatter plot of palette colors"
      >
        {/* Axis lines */}
        <line x1={20} y1={150} x2={300} y2={150} stroke="var(--ion-color-medium)" strokeWidth={1} />
        <line x1={20} y1={10} x2={20} y2={150} stroke="var(--ion-color-medium)" strokeWidth={1} />

        {/* X axis tick marks and labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => {
          const x = tToX(v);
          return (
            <g key={v}>
              <line x1={x} y1={148} x2={x} y2={152} stroke="var(--ion-color-medium)" strokeWidth={1} />
              <text x={x} y={159} fontSize={7} textAnchor="middle" fill="var(--ion-color-medium)">{v}</text>
            </g>
          );
        })}

        {/* Y axis tick marks and labels */}
        {[0, 0.1, 0.2, 0.3, 0.4].map((v) => {
          const y = perpToY(v);
          return (
            <g key={v}>
              <line x1={18} y1={y} x2={22} y2={y} stroke="var(--ion-color-medium)" strokeWidth={1} />
              <text x={17} y={y + 3} fontSize={7} textAnchor="end" fill="var(--ion-color-medium)">{v.toFixed(1)}</text>
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={160} y={159} fontSize={7} textAnchor="middle" fill="var(--ion-color-medium)" dy={0}>t →</text>
        <text x={7} y={82} fontSize={7} textAnchor="middle" fill="var(--ion-color-medium)" transform="rotate(-90, 7, 82)">perp</text>

        {/* Threshold line */}
        {maxPerp <= PERP_AXIS_MAX && (
          <line
            x1={tToX(0)}
            y1={thresholdY}
            x2={tToX(1)}
            y2={thresholdY}
            stroke="rgba(239,68,68,0.7)"
            strokeWidth={1.5}
            strokeDasharray="4 2"
          />
        )}
        {maxPerp <= PERP_AXIS_MAX && (
          <text
            x={tToX(1) + 2}
            y={thresholdY + 3}
            fontSize={6}
            fill="rgba(239,68,68,0.8)"
          >
            cap
          </text>
        )}

        {/* Anchor squares at (0,0) and (1,0) */}
        {([0, 1] as const).map((tVal) => {
          const x = tToX(tVal);
          const y = perpToY(0);
          return (
            <rect
              key={tVal}
              x={x - 5}
              y={y - 5}
              width={10}
              height={10}
              fill="white"
              stroke="rgba(0,0,0,0.6)"
              strokeWidth={1.5}
            />
          );
        })}

        {/* Palette color dots */}
        {points.map(({ hex, t, perp, included }) => {
          const clampedT = Math.max(-0.1, Math.min(1.1, t));
          const clampedPerp = Math.max(0, Math.min(PERP_AXIS_MAX, perp));
          const x = tToX(clampedT);
          const y = perpToY(clampedPerp);
          const opacity = included ? 1 : 0.4;
          const isAtEdge = t < -0.05 || t > 1.05;
          return (
            <g key={hex} opacity={opacity}>
              <circle
                cx={x}
                cy={y}
                r={5}
                fill={hex}
                stroke="rgba(0,0,0,0.5)"
                strokeWidth={1}
              />
              {isAtEdge && (
                <text
                  x={x}
                  y={y - 7}
                  fontSize={5}
                  textAnchor="middle"
                  fill="rgba(0,0,0,0.5)"
                >
                  {t < 0 ? "←" : "→"}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--ion-color-medium)" }}>
        X = t (0=A, 1=B) · Y = perp distance · dashed line = current threshold · dim = excluded
      </p>
    </div>
  );
}

function OklabPlane({
  colorSpace,
  sequence,
  anchorAHex,
  anchorBHex,
  maxPerp,
}: {
  colorSpace: string[];
  sequence: string[];
  anchorAHex?: string;
  anchorBHex?: string;
  maxPerp?: number;
}) {
  const PAD = 16;
  const SZ = 360;
  const TW = SZ + PAD * 2;
  const TH = SZ + PAD * 2;
  const A_RANGE = 0.38, B_RANGE = 0.38;
  const aToX = (a: number) => PAD + ((a + A_RANGE) / (A_RANGE * 2)) * SZ;
  const bToY = (b: number) => PAD + SZ - ((b + B_RANGE) / (B_RANGE * 2)) * SZ;

  const seqSet = new Set(sequence);
  const anchorALab = anchorAHex ? hexToOklab(anchorAHex) : null;
  const anchorBLab = anchorBHex ? hexToOklab(anchorBHex) : null;

  const seqPts = sequence
    .map(h => { const { a, b } = hexToOklab(h); return `${aToX(a)},${bToY(b)}`; })
    .join(" ");

  let refLine: React.ReactNode = null;
  if (anchorALab && anchorBLab) {
    const da = anchorBLab.a - anchorALab.a, db = anchorBLab.b - anchorALab.b;
    refLine = (
      <line
        x1={aToX(anchorALab.a - da * 0.2)} y1={bToY(anchorALab.b - db * 0.2)}
        x2={aToX(anchorBLab.a + da * 0.2)} y2={bToY(anchorBLab.b + db * 0.2)}
        stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4 3"
      />
    );
  }

  let band: React.ReactNode = null;
  if (anchorALab && anchorBLab && maxPerp && maxPerp > 0) {
    const da = anchorBLab.a - anchorALab.a, db = anchorBLab.b - anchorALab.b;
    const len = Math.sqrt(da * da + db * db);
    if (len > 0.001) {
      const px = -db / len, py = da / len;
      const off = Math.min(maxPerp, B_RANGE * 0.9);
      const ext = 0.2;
      const x1a = anchorALab.a - da * ext, y1a = anchorALab.b - db * ext;
      const x2a = anchorBLab.a + da * ext, y2a = anchorBLab.b + db * ext;
      band = (
        <>
          <line x1={aToX(x1a + px * off)} y1={bToY(y1a + py * off)} x2={aToX(x2a + px * off)} y2={bToY(y2a + py * off)} stroke="rgba(239,68,68,0.4)" strokeWidth={1} strokeDasharray="3 2" />
          <line x1={aToX(x1a - px * off)} y1={bToY(y1a - py * off)} x2={aToX(x2a - px * off)} y2={bToY(y2a - py * off)} stroke="rgba(239,68,68,0.4)" strokeWidth={1} strokeDasharray="3 2" />
        </>
      );
    }
  }

  // Render the ab-plane as actual color pixels at the median lightness of the sequence.
  const bgL = useMemo(() => {
    if (sequence.length === 0) return 0.65;
    const ls = sequence.map(h => hexToOklab(h).L).sort((x, y) => x - y);
    return ls[Math.floor(ls.length / 2)];
  }, [sequence]);

  const [bgUrl, setBgUrl] = useState("");
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = SZ; canvas.height = SZ;
    const ctx = canvas.getContext("2d")!;
    const id = ctx.createImageData(SZ, SZ);
    const d = id.data;
    const srgbGamma = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
    for (let py = 0; py < SZ; py++) {
      for (let px = 0; px < SZ; px++) {
        const a = -A_RANGE + (px / (SZ - 1)) * (A_RANGE * 2);
        const b = B_RANGE - (py / (SZ - 1)) * (B_RANGE * 2);
        const l_ = bgL + 0.3963377774 * a + 0.2158037573 * b;
        const m_ = bgL - 0.1055613458 * a - 0.0638541728 * b;
        const s_ = bgL - 0.0894841775 * a - 1.2914855480 * b;
        const l3 = l_ ** 3, m3 = m_ ** 3, s3 = s_ ** 3;
        const R = Math.max(0, Math.min(1, +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3));
        const G = Math.max(0, Math.min(1, -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3));
        const B = Math.max(0, Math.min(1, -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3));
        const i = (py * SZ + px) * 4;
        d[i] = srgbGamma(R); d[i+1] = srgbGamma(G); d[i+2] = srgbGamma(B); d[i+3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    setBgUrl(canvas.toDataURL());
  }, [bgL]);

  return (
    <div style={{ marginTop: 12, marginBottom: 12 }}>
      <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ion-color-medium)" }}>
        OKLab color space (a/b plane, L={bgL.toFixed(2)})
      </p>
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${TW} ${TH}`}
          style={{ width: "100%", maxWidth: TW, display: "block", borderRadius: 8, background: "#111" }}
          aria-label="OKLab ab-plane showing colors and gradient path"
        >
          {/* Pixel-rendered color space background */}
          {bgUrl && <image x={PAD} y={PAD} width={SZ} height={SZ} href={bgUrl} />}
          {/* Axes */}
          <line x1={PAD} y1={bToY(0)} x2={PAD + SZ} y2={bToY(0)} stroke="rgba(0,0,0,0.3)" strokeWidth={1} />
          <line x1={aToX(0)} y1={PAD} x2={aToX(0)} y2={PAD + SZ} stroke="rgba(0,0,0,0.3)" strokeWidth={1} />
          {/* A→B reference */}
          {refLine}
          {/* Filter band */}
          {band}
          {/* Gradient path */}
          {sequence.length >= 2 && (
            <polyline points={seqPts} fill="none" stroke="rgba(255,255,255,0.7)"
              strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {/* Shelf dots */}
          {colorSpace.filter(h => !seqSet.has(h) && h !== anchorAHex && h !== anchorBHex).map(h => {
            const { a, b } = hexToOklab(h);
            return <circle key={h} cx={aToX(a)} cy={bToY(b)} r={4} fill={h} stroke="rgba(0,0,0,0.6)" strokeWidth={1} opacity={0.75} />;
          })}
          {/* Sequence dots */}
          {sequence.map((h, i) => {
            if (h === anchorAHex || h === anchorBHex) return null;
            const { a, b } = hexToOklab(h);
            return <circle key={`seq-${i}`} cx={aToX(a)} cy={bToY(b)} r={6} fill={h} stroke="white" strokeWidth={2} />;
          })}
          {/* Anchor A */}
          {anchorALab && anchorAHex && (
            <g>
              <circle cx={aToX(anchorALab.a)} cy={bToY(anchorALab.b)} r={9} fill={anchorAHex} stroke="white" strokeWidth={2.5} />
              <text x={aToX(anchorALab.a)} y={bToY(anchorALab.b) + 3.5} fontSize={8} textAnchor="middle" fill="white" fontWeight="bold">A</text>
            </g>
          )}
          {/* Anchor B */}
          {anchorBLab && anchorBHex && (
            <g>
              <circle cx={aToX(anchorBLab.a)} cy={bToY(anchorBLab.b)} r={9} fill={anchorBHex} stroke="white" strokeWidth={2.5} />
              <text x={aToX(anchorBLab.a)} y={bToY(anchorBLab.b) + 3.5} fontSize={8} textAnchor="middle" fill="white" fontWeight="bold">B</text>
            </g>
          )}
          {/* Axis labels */}
          <text x={PAD + SZ - 2} y={bToY(0) - 3} fontSize={6} fill="rgba(0,0,0,0.4)" textAnchor="end">a+</text>
          <text x={aToX(0) + 3} y={PAD + 7} fontSize={6} fill="rgba(0,0,0,0.4)">b+</text>
        </svg>
      </div>
      <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--ion-color-medium)" }}>
        Background = OKLab ab-plane at current lightness · white path = gradient · dashed = A→B & filter band
      </p>
    </div>
  );
}

function ShelfItem({ hex, title, onTap }: { hex: string; title: string; onTap: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `shelf:${hex}` });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      aria-label={`Add ${hex} to sequence`}
      title={title}
      onClick={onTap}
      style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        background: hex,
        border: "2px solid rgba(0,0,0,0.12)",
        cursor: "grab",
        flexShrink: 0,
        touchAction: "none",
        opacity: isDragging ? 0.5 : 1,
      }}
    />
  );
}
