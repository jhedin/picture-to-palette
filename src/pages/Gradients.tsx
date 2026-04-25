import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useHistory } from "react-router-dom";
import { usePalette } from "../lib/palette-store";
import {
  hexToOklab,
  sortGradient,
  swatchMeta,
  scoreGradientOutliers,
} from "../lib/color";
import { renderGradientPng } from "../lib/gradient-canvas";

export default function Gradients() {
  const { state } = usePalette();
  const history = useHistory();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const dmcSet = state.dmcSet;
  const colorSpace: string[] = useMemo(
    () => (dmcSet.length > 0 ? dmcSet.map((d) => d.hex) : state.colors.map((c) => c.hex)),
    [dmcSet, state.colors],
  );
  const isDmcMode = dmcSet.length > 0;

  const [sequence, setSequence] = useState<string[]>([]);

  // Seed: sort all colors along the darkest→lightest axis.
  // If anchors are set, use them as the sort axis.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || colorSpace.length === 0) return;
    seeded.current = true;
    const a = state.colors.find((c) => c.id === state.anchorA)?.hex;
    const b = state.colors.find((c) => c.id === state.anchorB)?.hex;
    if (a && b) {
      setSequence(sortGradient(colorSpace, a, b));
    } else {
      const byL = [...colorSpace].sort((x, y) => hexToOklab(x).L - hexToOklab(y).L);
      setSequence(sortGradient(colorSpace, byL[0], byL[byL.length - 1]));
    }
  }, [colorSpace, state.anchorA, state.anchorB, state.colors]);

  // ── Drag-to-reorder ─────────────────────────────────────────────────────
  type DragSrc = { hex: string; seqIdx?: number };
  const [drag, setDrag] = useState<DragSrc | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [dropAt, setDropAt] = useState(-1);

  // Per-element drag tracking via ref (avoids closure staleness issues).
  const activeDragRef = useRef<{
    src: DragSrc;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const seqElMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const seqLenRef = useRef(sequence.length);
  useEffect(() => { seqLenRef.current = sequence.length; }, [sequence]);

  const findDropAt = useCallback((px: number, py: number): number => {
    const entries: Array<{ i: number; r: DOMRect }> = [];
    seqElMap.current.forEach((el, i) => { if (el) entries.push({ i, r: el.getBoundingClientRect() }); });
    entries.sort((a, b) => a.r.top !== b.r.top ? a.r.top - b.r.top : a.r.left - b.r.left);
    for (const { i, r } of entries) {
      if (py < r.top + r.height * 0.5 || (py < r.bottom && px < r.left + r.width * 0.5)) return i;
    }
    return seqLenRef.current;
  }, []);

  const findDropAtRef = useRef(findDropAt);
  useEffect(() => { findDropAtRef.current = findDropAt; }, [findDropAt]);

  function startDrag(e: React.PointerEvent, src: DragSrc) {
    const el = e.currentTarget as HTMLElement;
    if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    activeDragRef.current = { src, startX: e.clientX, startY: e.clientY, moved: false };
  }

  function moveDrag(e: React.PointerEvent) {
    const active = activeDragRef.current;
    if (!active) return;
    const dx = e.clientX - active.startX, dy = e.clientY - active.startY;
    if (!active.moved && Math.sqrt(dx * dx + dy * dy) > 8) {
      active.moved = true;
      setDrag(active.src);
    }
    if (active.moved) {
      setDragPos({ x: e.clientX, y: e.clientY });
      setDropAt(findDropAtRef.current(e.clientX, e.clientY));
    }
  }

  function endDrag(e: React.PointerEvent, onTap?: () => void) {
    const active = activeDragRef.current;
    activeDragRef.current = null;
    if (!active) return;
    if (active.moved) {
      const idx = findDropAtRef.current(e.clientX, e.clientY);
      const src = active.src;
      setSequence(prev => {
        if (src.seqIdx !== undefined) {
          const next = prev.filter((_, j) => j !== src.seqIdx!);
          const adj = src.seqIdx! < idx ? idx - 1 : idx;
          next.splice(Math.max(0, Math.min(next.length, adj)), 0, src.hex);
          return next;
        } else {
          if (prev.includes(src.hex)) return prev;
          const next = [...prev];
          next.splice(Math.max(0, Math.min(next.length, idx)), 0, src.hex);
          return next;
        }
      });
    } else {
      onTap?.();
    }
    setDrag(null);
    setDropAt(-1);
  }

  function cancelDrag() {
    activeDragRef.current = null;
    setDrag(null);
    setDropAt(-1);
  }

  function removeFromSequence(index: number) {
    setSequence(prev => prev.filter((_, i) => i !== index));
  }

  const metas = useMemo(() => sequence.map(swatchMeta), [sequence]);
  const outlierMap = useMemo(() => {
    const results = scoreGradientOutliers(sequence);
    return new Map(results.map((r) => [r.hex, r.isOutlier]));
  }, [sequence]);

  const shelf = colorSpace.filter(h => !sequence.includes(h));

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

        {/* ── Gradient strip ────────────────────────────────────────────── */}
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

            <div style={{ display: "flex", marginBottom: 8, borderRadius: 10, overflow: "visible", minHeight: 80 }}>
              {/* Drop zone at position 0 */}
              {drag && dropAt === 0 && <DropBar />}

              {sequence.map((hex, i) => {
                const isOutlier = outlierMap.get(hex) ?? false;
                const dmcEntry = isDmcMode ? dmcSet.find((d) => d.hex === hex) : null;
                const isBeingDragged = drag?.seqIdx === i;
                return (
                  <React.Fragment key={`${hex}-${i}`}>
                    <div
                      ref={(el: HTMLDivElement | null) => {
                        if (el) seqElMap.current.set(i, el);
                        else seqElMap.current.delete(i);
                      }}
                      onPointerDown={(e) => startDrag(e, { hex, seqIdx: i })}
                      onPointerMove={moveDrag}
                      onPointerUp={(e) => endDrag(e)}
                      onPointerCancel={cancelDrag}
                      title={isOutlier ? "Perceptual outlier — may not blend smoothly" : (dmcEntry ? `${dmcEntry.id} — ${dmcEntry.name}` : hex)}
                      style={{
                        position: "relative",
                        flex: 1,
                        minWidth: 32,
                        background: hex,
                        borderRadius:
                          i === 0 && i === sequence.length - 1 ? 10 :
                          i === 0 ? "10px 0 0 10px" :
                          i === sequence.length - 1 ? "0 10px 10px 0" : 0,
                        cursor: "grab",
                        touchAction: "none",
                        opacity: isBeingDragged ? 0.35 : 1,
                        outline: isOutlier ? "3px solid #f59e0b" : "none",
                        outlineOffset: -3,
                        transition: "opacity 0.1s",
                      }}
                    >
                      {/* X button */}
                      <button
                        type="button"
                        aria-label={`Remove ${hex} from sequence`}
                        onClick={(e) => { e.stopPropagation(); removeFromSequence(i); }}
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
                      {/* Label */}
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
                        {dmcEntry ? dmcEntry.id : `L${metas[i].L.toFixed(2)}`}
                      </div>
                    </div>
                    {drag && dropAt === i + 1 && <DropBar />}
                  </React.Fragment>
                );
              })}

              {drag && dropAt === sequence.length && <DropBar />}
            </div>

            {/* Outlier note */}
            {[...outlierMap.values()].some(Boolean) && (
              <p style={{ fontSize: 12, color: "#f59e0b", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, border: "3px solid #f59e0b", flexShrink: 0 }} />
                Amber outline = may not blend smoothly with neighbours.
              </p>
            )}
          </>
        )}

        {/* ── Shelf (colors not in gradient) ────────────────────────────── */}
        {shelf.length > 0 && (
          <>
            <p style={{ margin: "12px 0 6px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ion-color-medium)" }}>
              {isDmcMode ? "DMC set" : "Palette"} — drag to position, tap to append
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
              {shelf.map((hex) => {
                const dmcEntry = isDmcMode ? dmcSet.find((d) => d.hex === hex) : null;
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Add ${hex} to sequence`}
                    title={dmcEntry ? `${dmcEntry.id} — ${dmcEntry.name}` : hex}
                    onPointerDown={(e) => startDrag(e, { hex })}
                    onPointerMove={moveDrag}
                    onPointerUp={(e) => endDrag(e, () => {
                      setSequence(prev => prev.includes(hex) ? prev : [...prev, hex]);
                    })}
                    onPointerCancel={cancelDrag}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: hex,
                      border: "2px solid rgba(0,0,0,0.12)",
                      cursor: "grab",
                      flexShrink: 0,
                      touchAction: "none",
                    }}
                  />
                );
              })}
            </div>
          </>
        )}

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

      {/* ── Drag ghost ───────────────────────────────────────────────────── */}
      {drag && (
        <div
          style={{
            position: "fixed",
            left: dragPos.x - 22,
            top: dragPos.y - 30,
            width: 44,
            height: 44,
            borderRadius: 8,
            background: drag.hex,
            border: "3px solid white",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            pointerEvents: "none",
            zIndex: 9999,
            opacity: 0.9,
          }}
        />
      )}
    </IonPage>
  );
}

function DropBar() {
  return (
    <div style={{
      width: 4,
      alignSelf: "stretch",
      borderRadius: 2,
      background: "var(--ion-color-primary)",
      flexShrink: 0,
    }} />
  );
}
