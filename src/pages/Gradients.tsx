import { useEffect, useMemo, useRef, useState } from "react";
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
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
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
  type GradientMode,
} from "../lib/color";

const MODES: GradientMode[] = ["natural", "lightness", "saturation", "hue"];
const MODE_DESC: Record<GradientMode, string> = {
  natural:    "Colors that perceptually sit on the line between your endpoints in OKLab space.",
  lightness:  "Colors sorted by brightness — dark to light or light to dark depending on your endpoints.",
  saturation: "Colors sorted by intensity — from muted to vivid or vice versa.",
  hue:        "Colors sorted along the shortest arc of the color wheel between your endpoints.",
};
import { findDmcBridges, expandDmcPalette } from "../lib/dmc-match";
import { renderGradientPng } from "../lib/gradient-canvas";

function oklabDist(a: string, b: string): number {
  const la = hexToOklab(a), lb = hexToOklab(b);
  return Math.sqrt((la.L - lb.L) ** 2 + (la.a - lb.a) ** 2 + (la.b - lb.b) ** 2);
}

// Greedy nearest-neighbour sort starting from the lightest colour.
// Keeps perceptually similar colours adjacent — avoids the "grey between blues"
// problem that projection-onto-L-axis sort produces for diverse palettes.
function nearestNeighborSort(cs: string[]): string[] {
  if (cs.length <= 1) return cs;
  const remaining = [...cs].sort((a, b) => hexToOklab(b).L - hexToOklab(a).L); // lightest first
  const result = [remaining.shift()!];
  while (remaining.length > 0) {
    const last = result[result.length - 1];
    let minDist = Infinity, nearestIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      const d = oklabDist(last, remaining[i]);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    result.push(remaining.splice(nearestIdx, 1)[0]);
  }
  return result;
}

export default function Gradients() {
  const { state } = usePalette();
  const history = useHistory();
  const location = useLocation();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const dmcSet = state.dmcSet;
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isDmcMode = searchParams.get("mode") === "dmc" && dmcSet.length > 0;

  // Extra DMC colors discovered via "Fill gaps" or "Expand shades" — local to this page.
  const [dmcBridges, setDmcBridges] = useState<DmcColor[]>([]);
  const [dmcShades, setDmcShades] = useState<DmcColor[]>([]);
  const dmcPool = useMemo(
    () => isDmcMode ? [...dmcSet, ...dmcBridges, ...dmcShades] : [],
    [isDmcMode, dmcSet, dmcBridges, dmcShades],
  );

  const colorSpace: string[] = useMemo(
    () => isDmcMode ? dmcPool.map((d) => d.hex) : state.colors.map((c) => c.hex),
    [isDmcMode, dmcPool, state.colors],
  );

  const [sortMode, setSortMode] = useState<GradientMode>("natural");
  const [sequence, setSequence] = useState<string[]>([]);
  const [pinnedHexes, setPinnedHexes] = useState<string[]>([]);
  const [selectedSeqHex, setSelectedSeqHex] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [maxColors, setMaxColors] = useState<number>(0); // 0 = not yet set

  // Keep a ref so the seeding effect can check pins without adding them to its dep array.
  const pinnedRef = useRef<string[]>([]);
  useEffect(() => { pinnedRef.current = pinnedHexes; }, [pinnedHexes]);

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
    // hue
    const hueOf = (h: string) => { const lab = hexToOklab(h); return Math.atan2(lab.b, lab.a); };
    return [...cs].sort((x, y) => hueOf(x) - hueOf(y));
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
    if (anchorAHex && anchorBHex && colorSpace.includes(anchorAHex) && colorSpace.includes(anchorBHex)) {
      // Anchors set: start with A, the colors that lie between them, and B.
      const between = gradientBetween(colorSpace, anchorAHex, anchorBHex, sortMode);
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

  function applyMaxColors(n: number) {
    const effective = Math.max(n, pinnedHexes.length);
    setMaxColors(effective);
    setSequence((prev) => {
      if (effective >= prev.length) {
        const toAdd = effective - prev.length;
        const shelf = colorSpace.filter((h) => !prev.includes(h));
        if (shelf.length === 0 || toAdd <= 0) return prev;
        const allSorted = buildSorted(colorSpace);
        // When there are endpoints, only add colors that perceptually lie between them.
        // gradientBetween filters by perpendicular distance so off-axis colors (taupe between blues) are excluded.
        let candidatePool: string[];
        if (prev.length >= 2) {
          const firstHex = prev[0];
          const lastHex = prev[prev.length - 1];
          const between = gradientBetween(colorSpace, firstHex, lastHex, sortMode)
            .filter((h) => shelf.includes(h));
          candidatePool = between.length > 0 ? between : allSorted.filter((h) => shelf.includes(h));
        } else {
          candidatePool = allSorted.filter((h) => shelf.includes(h));
        }
        const candidates = candidatePool.slice(0, toAdd);
        if (candidates.length === 0) return prev;
        const combined = [...prev, ...candidates];
        const isReversed = prev.length >= 2 &&
          allSorted.indexOf(prev[prev.length - 1]) < allSorted.indexOf(prev[0]);
        combined.sort((a, b) => {
          const ai = allSorted.indexOf(a);
          const bi = allSorted.indexOf(b);
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return isReversed ? bi - ai : ai - bi;
        });
        return combined;
      } else {
        const pinned = prev.filter((h) => pinnedHexes.includes(h));
        const nonPinned = prev.filter((h) => !pinnedHexes.includes(h));
        const needed = Math.max(0, effective - pinned.length);
        const selected = needed > 0 ? pickEvenly(nonPinned, needed) : [];
        return prev.filter((h) => pinned.includes(h) || selected.includes(h));
      }
    });
  }

  function handleFillGaps() {
    const known = dmcPool.map((d) => d.hex);
    const bridges = findDmcBridges(sequence, known);
    if (bridges.length > 0) {
      const newHexes = bridges.map((d) => d.hex);
      setDmcBridges((prev) => {
        const existingIds = new Set(dmcPool.map((d) => d.id));
        return [...prev, ...bridges.filter((d) => !existingIds.has(d.id))];
      });
      setPinnedHexes((prev) => {
        const next = [...prev];
        for (const h of newHexes) if (!next.includes(h)) next.push(h);
        return next;
      });
    }
  }

  function handleExpandShades() {
    const expanded = expandDmcPalette(dmcPool, 1);
    const existingIds = new Set(dmcPool.map((d) => d.id));
    const newShades = expanded.filter((d) => !existingIds.has(d.id));
    if (newShades.length > 0) setDmcShades((prev) => [...prev, ...newShades]);
  }

  // ── dnd-kit ──────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    setSelectedSeqHex(null);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (activeIdStr.startsWith("shelf:")) {
      const hex = activeIdStr.slice(6);
      setSequence((prev) => {
        if (prev.includes(hex)) return prev;
        const overIdx = prev.indexOf(overIdStr);
        const insertAt = overIdx >= 0 ? overIdx : prev.length;
        const next = [...prev];
        next.splice(insertAt, 0, hex);
        return next;
      });
      setPinnedHexes((prev) => prev.includes(hex) ? prev : [...prev, hex]);
    } else if (overIdStr === "shelf-drop-zone") {
      // Dragged a sequence item back to the shelf — remove and unpin it.
      setSequence((prev) => prev.filter((h) => h !== activeIdStr));
      setPinnedHexes((prev) => prev.filter((h) => h !== activeIdStr));
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

  function handleModeChange(m: GradientMode) {
    setSortMode(m);
    setSequence((prev) => prev.length < 2 ? prev : sortWithMode(prev, m));
    setSelectedSeqHex(null);
  }

  // Alternatives for the selected slot: use gradientBetween between its neighbours (mode-aware).
  const alternatives = useMemo(() => {
    if (!selectedSeqHex) return [];
    const idx = sequence.indexOf(selectedSeqHex);
    const leftHex = idx > 0 ? sequence[idx - 1] : null;
    const rightHex = idx < sequence.length - 1 ? sequence[idx + 1] : null;
    if (leftHex && rightHex) {
      const between = gradientBetween(colorSpace, leftHex, rightHex, sortMode)
        .filter((h) => !sequence.includes(h));
      if (between.length > 0) return between.slice(0, 12);
    }
    // Endpoint or no between-candidates: nearest by OKLab distance.
    return colorSpace
      .filter((h) => !sequence.includes(h))
      .sort((a, b) => oklabDist(a, selectedSeqHex) - oklabDist(b, selectedSeqHex))
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

  const { setNodeRef: setShelfDropRef, isOver: isOverShelf } = useDroppable({ id: "shelf-drop-zone" });

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
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* ── Mode selector ─────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {MODES.map((m) => (
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

          {/* ── Max-colors slider ─────────────────────────────────────── */}
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

              <SortableContext items={sequence} strategy={horizontalListSortingStrategy}>
                <div style={{ display: "flex", marginBottom: 8, borderRadius: 10, overflow: "visible", minHeight: 80 }}>
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
            <>
              <p style={{ margin: "12px 0 6px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ion-color-medium)" }}>
                {isDmcMode ? "Available DMC threads" : "Palette"} — drag to position, tap to append & pin
              </p>
              <div
                ref={setShelfDropRef}
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  marginBottom: 16,
                  minHeight: 52,
                  borderRadius: 8,
                  padding: 4,
                  background: isOverShelf ? "rgba(var(--ion-color-primary-rgb), 0.1)" : "transparent",
                  border: isOverShelf ? "2px dashed var(--ion-color-primary)" : "2px solid transparent",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
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
            </>
          )}

          {/* ── DMC actions ───────────────────────────────────────────── */}
          {isDmcMode && sequence.length >= 2 && (
            <IonButton fill="outline" expand="block" onClick={handleFillGaps} style={{ marginBottom: 8 }}>
              Fill gaps with DMC colors
            </IonButton>
          )}
          {isDmcMode && (
            <IonButton fill="outline" expand="block" onClick={handleExpandShades} style={{ marginBottom: 8 }}>
              Expand shades
            </IonButton>
          )}

          <DragOverlay>
            {activeHex && (
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                background: activeHex,
                border: "3px solid white",
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                opacity: 0.9,
              }} />
            )}
          </DragOverlay>
        </DndContext>

        <IonButton expand="block" onClick={handleSave} disabled={sequence.length < 2}>
          Save PNG
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

  // Use onPointerUp with distance tracking for reliable tap detection on mobile
  // (onClick can be suppressed by touch-action:none on some iOS builds).
  const tapRef = useRef<{ x: number; y: number } | null>(null);
  const pointerHandlers = {
    onPointerDown(e: React.PointerEvent) {
      tapRef.current = { x: e.clientX, y: e.clientY };
      // Forward to dnd-kit's sensor so drag still works.
      (listeners as Record<string, (e: React.PointerEvent) => void>)?.onPointerDown?.(e);
    },
    onPointerUp(e: React.PointerEvent) {
      if (tapRef.current) {
        const dist = Math.hypot(e.clientX - tapRef.current.x, e.clientY - tapRef.current.y);
        tapRef.current = null;
        if (dist < 8) onSelect();
      }
    },
  };

  const boxShadow = isSelected
    ? "0 0 0 2px white, 0 0 0 4px rgba(0,0,0,0.35)"
    : undefined;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      {...pointerHandlers}
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
