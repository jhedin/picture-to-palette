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
} from "../lib/color";
import { findDmcBridges } from "../lib/dmc-match";
import { renderGradientPng } from "../lib/gradient-canvas";

export default function Gradients() {
  const { state } = usePalette();
  const history = useHistory();
  const location = useLocation();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const dmcSet = state.dmcSet;
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isDmcMode = searchParams.get("mode") === "dmc" && dmcSet.length > 0;

  // Extra DMC colors discovered via "Fill gaps" — local to this page.
  const [dmcBridges, setDmcBridges] = useState<DmcColor[]>([]);
  const dmcPool = useMemo(
    () => isDmcMode ? [...dmcSet, ...dmcBridges] : [],
    [isDmcMode, dmcSet, dmcBridges],
  );

  const colorSpace: string[] = useMemo(
    () => isDmcMode ? dmcPool.map((d) => d.hex) : state.colors.map((c) => c.hex),
    [isDmcMode, dmcPool, state.colors],
  );

  const [sequence, setSequence] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [maxColors, setMaxColors] = useState<number>(0); // 0 = not yet set

  // Build a sorted sequence from the current anchors (or lightness fallback).
  function buildSorted(cs: string[]): string[] {
    const a = state.colors.find((c) => c.id === state.anchorA)?.hex;
    const b = state.colors.find((c) => c.id === state.anchorB)?.hex;
    if (a && b) return sortGradient(cs, a, b);
    const byL = [...cs].sort((x, y) => hexToOklab(x).L - hexToOklab(y).L);
    return byL.length >= 2 ? sortGradient(cs, byL[0], byL[byL.length - 1]) : cs;
  }

  // Seed sequence on first load and whenever anchors change.
  const prevAnchorKey = useRef("");
  useEffect(() => {
    if (colorSpace.length === 0) return;
    const anchorKey = `${state.anchorA ?? ""}|${state.anchorB ?? ""}`;
    const anchorsChanged = anchorKey !== prevAnchorKey.current && !!(state.anchorA && state.anchorB);
    // Only re-seed automatically: on first load, or when anchors newly arrive.
    if (sequence.length > 0 && !anchorsChanged) return;
    prevAnchorKey.current = anchorKey;
    const sorted = buildSorted(colorSpace);
    const limit = maxColors > 0 ? maxColors : colorSpace.length;
    setSequence(limit < sorted.length ? pickEvenly(sorted, limit) : sorted);
    if (maxColors === 0) setMaxColors(colorSpace.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorSpace, state.anchorA, state.anchorB]);

  // When the user manually adds a color past the current limit, bump the limit.
  useEffect(() => {
    if (maxColors > 0 && sequence.length > maxColors) setMaxColors(sequence.length);
  }, [sequence.length, maxColors]);

  function applyMaxColors(n: number) {
    setMaxColors(n);
    const sorted = buildSorted(colorSpace);
    setSequence(n < sorted.length ? pickEvenly(sorted, n) : sorted);
  }

  function handleFillGaps() {
    const known = dmcPool.map((d) => d.hex);
    const bridges = findDmcBridges(sequence, known);
    if (bridges.length > 0) {
      setDmcBridges((prev) => {
        const existingIds = new Set(dmcPool.map((d) => d.id));
        return [...prev, ...bridges.filter((d) => !existingIds.has(d.id))];
      });
    }
  }

  // ── dnd-kit ──────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
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

  const shelf = colorSpace.filter((h) => !sequence.includes(h));
  const activeHex = activeId
    ? activeId.startsWith("shelf:") ? activeId.slice(6) : activeId
    : null;

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
          {/* ── Max-colors slider ─────────────────────────────────────── */}
          {colorSpace.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--ion-color-medium)", whiteSpace: "nowrap" }}>
                Colors: {maxColors > 0 ? maxColors : colorSpace.length}
              </span>
              <input
                type="range"
                min={1}
                max={colorSpace.length}
                value={maxColors > 0 ? maxColors : colorSpace.length}
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
                  Gradient ({sequence.length}) — drag to reorder
                </p>
                <button
                  type="button"
                  onClick={() => setSequence([])}
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
                        label={dmcEntry ? dmcEntry.id : `L${metas[i].L.toFixed(2)}`}
                        title={
                          outlierMap.get(hex)
                            ? "Perceptual outlier — may not blend smoothly"
                            : (dmcEntry ? `${dmcEntry.id} — ${dmcEntry.name}` : hex)
                        }
                        onRemove={() => setSequence((prev) => prev.filter((_, j) => j !== i))}
                      />
                    );
                  })}
                </div>
              </SortableContext>

              {[...outlierMap.values()].some(Boolean) && (
                <p style={{ fontSize: 12, color: "#f59e0b", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, border: "3px solid #f59e0b", flexShrink: 0 }} />
                  Amber outline = may not blend smoothly with neighbours.
                </p>
              )}
            </>
          )}

          {/* ── Shelf ─────────────────────────────────────────────────── */}
          {shelf.length > 0 && (
            <>
              <p style={{ margin: "12px 0 6px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ion-color-medium)" }}>
                {isDmcMode ? "Available DMC threads" : "Palette"} — drag to position, tap to append
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                {shelf.map((hex) => {
                  const dmcEntry = isDmcMode ? dmcPool.find((d) => d.hex === hex) : null;
                  return (
                    <ShelfItem
                      key={hex}
                      hex={hex}
                      title={dmcEntry ? `${dmcEntry.id} — ${dmcEntry.name}` : hex}
                      onTap={() => setSequence((prev) => prev.includes(hex) ? prev : [...prev, hex])}
                    />
                  );
                })}
              </div>
            </>
          )}

          {/* ── DMC fill-gaps ─────────────────────────────────────────── */}
          {isDmcMode && sequence.length >= 2 && (
            <IonButton fill="outline" expand="block" onClick={handleFillGaps} style={{ marginBottom: 8 }}>
              Fill gaps with DMC colors
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
  label,
  title,
  onRemove,
}: {
  hex: string;
  index: number;
  total: number;
  isOutlier: boolean;
  label: string;
  title: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: hex });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
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
        cursor: "grab",
        touchAction: "none",
        opacity: isDragging ? 0.35 : 1,
        outline: isOutlier ? "3px solid #f59e0b" : "none",
        outlineOffset: -3,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <button
        type="button"
        aria-label={`Remove ${hex} from sequence`}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 2,
          right: 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.85)",
          border: "1px solid rgba(0,0,0,0.15)",
          cursor: "pointer",
          padding: 0,
          fontSize: 12,
          lineHeight: "16px",
          textAlign: "center",
          color: "#222",
        }}
      >
        ×
      </button>
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
        borderRadius: "50%",
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
