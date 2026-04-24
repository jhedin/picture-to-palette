import React, { useEffect, useMemo, useRef, useState } from "react";
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
  gradientBetween,
  swatchMeta,
  scoreGradientOutliers,
  type GradientMode,
} from "../lib/color";
import { renderGradientPng } from "../lib/gradient-canvas";

const MODES: GradientMode[] = ["natural", "lightness", "saturation", "hue"];

const MODE_DESC: Record<GradientMode, string> = {
  natural:    "Colors that perceptually sit on the line between your endpoints in OKLab space.",
  lightness:  "Colors sorted by brightness — dark to light or light to dark depending on your endpoints.",
  saturation: "Colors sorted by intensity — from muted to vivid or vice versa.",
  hue:        "Colors sorted along the shortest arc of the color wheel between your endpoints.",
};

export default function Gradients() {
  const { state } = usePalette();
  const history = useHistory();
  const [mode, setMode] = useState<GradientMode>("natural");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);

  // Color space: DMC if loaded, otherwise the extracted palette.
  const dmcSet = state.dmcSet;
  const colorSpace: string[] = useMemo(
    () => (dmcSet.length > 0 ? dmcSet.map((d) => d.hex) : state.colors.map((c) => c.hex)),
    [dmcSet, state.colors],
  );
  const isDmcMode = dmcSet.length > 0;

  // Sequence: ordered set-points the user builds from the shelf.
  const [sequence, setSequence] = useState<string[]>([]);
  // Pre-seed from anchorA/B the first time they appear (runs after Seeder effects settle).
  const seededFromAnchors = useRef(false);
  useEffect(() => {
    if (seededFromAnchors.current) return;
    if (state.anchorA === null && state.anchorB === null) return;
    seededFromAnchors.current = true;
    const a = state.colors.find((c) => c.id === state.anchorA)?.hex ?? null;
    const b = state.colors.find((c) => c.id === state.anchorB)?.hex ?? null;
    const initial = [a, b].filter((h): h is string => h !== null);
    if (initial.length > 0) setSequence(initial);
  }, [state.anchorA, state.anchorB, state.colors]);

  // Candidates only for the currently open gap — O(colorSpace) instead of
  // O(colorSpace × pairs) on every mode or sequence change.
  const activeCandidates = useMemo(() => {
    if (insertAt === null || insertAt < 1 || insertAt > sequence.length - 1) return [];
    const hexA = sequence[insertAt - 1];
    const hexB = sequence[insertAt];
    return gradientBetween(colorSpace, hexA, hexB, mode).filter(
      (h) => !sequence.includes(h),
    );
  }, [insertAt, sequence, colorSpace, mode]);

  const metas = useMemo(() => sequence.map(swatchMeta), [sequence]);
  const outlierMap = useMemo(() => {
    const results = scoreGradientOutliers(sequence);
    return new Map(results.map((r) => [r.hex, r.isOutlier]));
  }, [sequence]);

  function appendToSequence(hex: string) {
    setSequence((prev) => [...prev, hex]);
    setInsertAt(null);
  }

  function removeFromSequence(index: number) {
    setSequence((prev) => prev.filter((_, i) => i !== index));
    if (insertAt !== null && insertAt > index) setInsertAt(insertAt - 1);
    else setInsertAt(null);
  }

  function insertCandidate(hex: string, beforeIndex: number) {
    setSequence((prev) => {
      const next = [...prev];
      next.splice(beforeIndex, 0, hex);
      return next;
    });
    setInsertAt(null);
  }

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

  // Empty state — no colors in scope yet.
  if (colorSpace.length === 0) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonBackButton defaultHref="/capture" text="Back" />
            </IonButtons>
            <IonTitle>Gradient</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonText>
            <p>Extract some colors on the Capture screen first, then come back here to build a gradient.</p>
          </IonText>
          <IonButton expand="block" onClick={() => history.push("/capture")}>
            Go to Capture
          </IonButton>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton
              defaultHref={isDmcMode ? "/dmc" : "/palette"}
              text={isDmcMode ? "DMC" : "Palette"}
            />
          </IonButtons>
          <IonTitle>
            Gradient{" "}
            {isDmcMode && (
              <span style={{ fontSize: 11, opacity: 0.55, fontWeight: 400 }}>DMC</span>
            )}
          </IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {/* ── Mode selector ─────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setInsertAt(null); }}
              style={{
                padding: "4px 12px",
                borderRadius: 20,
                border: "1px solid var(--ion-color-primary)",
                background: mode === m ? "var(--ion-color-primary)" : "transparent",
                color: mode === m ? "var(--ion-color-primary-contrast)" : "var(--ion-color-primary)",
                fontSize: 13,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {m}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "var(--ion-color-medium)", margin: "0 0 14px" }}>
          {MODE_DESC[mode]}
        </p>

        {/* ── Color shelf ───────────────────────────────────────────── */}
        <ShelfLabel>
          {isDmcMode ? "DMC set" : "Palette"} — tap to add to sequence
        </ShelfLabel>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {colorSpace.map((hex) => {
            const inSeq = sequence.includes(hex);
            const dmcEntry = isDmcMode ? dmcSet.find((d) => d.hex === hex) : null;
            return (
              <button
                key={hex}
                type="button"
                aria-label={`Add ${hex} to sequence`}
                title={dmcEntry ? `${dmcEntry.id} — ${dmcEntry.name}` : hex}
                disabled={inSeq}
                onClick={() => appendToSequence(hex)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: hex,
                  border: inSeq
                    ? "3px solid var(--ion-color-primary)"
                    : "2px solid rgba(0,0,0,0.12)",
                  opacity: inSeq ? 0.3 : 1,
                  cursor: inSeq ? "default" : "pointer",
                  flexShrink: 0,
                }}
              />
            );
          })}
        </div>

        {/* ── Sequence builder ──────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
          <ShelfLabel style={{ margin: 0 }}>
            Sequence{sequence.length > 0 ? ` (${sequence.length})` : ""}
          </ShelfLabel>
          {sequence.length > 0 && (
            <button
              type="button"
              onClick={() => { setSequence([]); setInsertAt(null); }}
              style={{
                background: "none",
                border: "none",
                color: "var(--ion-color-medium)",
                fontSize: 12,
                cursor: "pointer",
                padding: "2px 4px",
                textDecoration: "underline",
              }}
            >
              Clear
            </button>
          )}
        </div>
        {sequence.length === 0 ? (
          <IonText color="medium">
            <p style={{ fontSize: 13, marginTop: 0 }}>
              Tap colors above to build your sequence — the gradient is whatever you place here.
            </p>
          </IonText>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 4,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            {sequence.map((hex, i) => {
              const isOutlier = outlierMap.get(hex) ?? false;
              const dmcEntry = isDmcMode ? dmcSet.find((d) => d.hex === hex) : null;
              return (
                <React.Fragment key={`${hex}-${i}`}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ position: "relative" }}>
                      <div
                        title={isOutlier ? "Perceptual outlier — this color may not blend smoothly with its neighbours. Try removing it or inserting a bridging color with the + button." : undefined}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 8,
                          background: hex,
                          border: isOutlier
                            ? "3px solid #f59e0b"
                            : "2px solid rgba(0,0,0,0.10)",
                        }}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${hex} from sequence`}
                        onClick={() => removeFromSequence(i)}
                        style={{
                          position: "absolute",
                          top: -5,
                          right: -5,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: "var(--ion-background-color,#fff)",
                          border: "1px solid rgba(0,0,0,0.2)",
                          cursor: "pointer",
                          padding: 0,
                          fontSize: 13,
                          lineHeight: "16px",
                          textAlign: "center",
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <span style={{ fontSize: 9, color: "var(--ion-color-medium)", marginTop: 2 }}>
                      {dmcEntry ? dmcEntry.id : `L${metas[i].L.toFixed(2)}`}
                    </span>
                  </div>

                  {/* + button between i and i+1 */}
                  {i < sequence.length - 1 && (
                    <button
                      type="button"
                      aria-label={`Find colors between position ${i + 1} and ${i + 2}`}
                      onClick={() => setInsertAt(insertAt === i + 1 ? null : i + 1)}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        marginTop: 9,
                        background:
                          insertAt === i + 1
                            ? "var(--ion-color-primary)"
                            : "rgba(0,0,0,0.07)",
                        color:
                          insertAt === i + 1
                            ? "white"
                            : "var(--ion-color-medium)",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 18,
                        lineHeight: "24px",
                        textAlign: "center",
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      +
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Outlier legend — only shown when at least one item is flagged */}
        {[...outlierMap.values()].some(Boolean) && (
          <p style={{ fontSize: 12, color: "#f59e0b", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, border: "3px solid #f59e0b", flexShrink: 0 }} />
            Amber border = perceptual outlier. This color may not blend smoothly — remove it or use + to insert a bridging color.
          </p>
        )}

        {/* ── Candidate picker for the active gap ───────────────────── */}
        {insertAt !== null && (
          <div
            style={{
              background: "var(--ion-color-light,#f4f5f8)",
              borderRadius: 10,
              padding: "10px 12px",
              marginBottom: 12,
            }}
          >
            {activeCandidates.length === 0 ? (
              <IonText color="medium">
                <p style={{ margin: 0, fontSize: 13 }}>
                  No {mode}-mode candidates between these two — try a different mode.
                </p>
              </IonText>
            ) : (
              <>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--ion-color-medium)" }}>
                  Fits here — tap to insert:
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {activeCandidates.slice(0, 8).map((hex) => {
                    const dmcEntry = isDmcMode ? dmcSet.find((d) => d.hex === hex) : null;
                    return (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`Insert ${hex}`}
                        title={dmcEntry ? `${dmcEntry.id} — ${dmcEntry.name}` : hex}
                        onClick={() => insertCandidate(hex, insertAt!)}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 8,
                          background: hex,
                          border: "2px solid rgba(0,0,0,0.12)",
                          cursor: "pointer",
                        }}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Preview strip ─────────────────────────────────────────── */}
        {sequence.length >= 2 && (
          <div
            style={{
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid rgba(0,0,0,0.12)",
              marginBottom: 14,
              height: 60,
              background: `linear-gradient(to right, ${sequence.join(", ")})`,
            }}
          />
        )}

        {sequence.length === 1 && (
          <p style={{ fontSize: 13, color: "var(--ion-color-medium)", margin: "0 0 8px", textAlign: "center" }}>
            Add at least one more color to enable Save PNG.
          </p>
        )}
        <IonButton
          expand="block"
          onClick={handleSave}
          disabled={sequence.length < 2}
        >
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

function ShelfLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p
      style={{
        margin: "0 0 6px",
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "var(--ion-color-medium)",
        ...style,
      }}
    >
      {children}
    </p>
  );
}
