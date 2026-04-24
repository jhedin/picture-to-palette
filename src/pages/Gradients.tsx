import { useEffect, useMemo, useState } from "react";
import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonRange,
  IonText,
  IonTitle,
  IonToast,
  IonToolbar,
} from "@ionic/react";
import { useHistory } from "react-router-dom";
import { usePalette } from "../lib/palette-store";
import {
  gradientBetween,
  pickEvenly,
  shadeRamp,
  swatchMeta,
  scoreGradientOutliers,
  type GradientMode,
} from "../lib/color";
import { renderGradientPng } from "../lib/gradient-canvas";

type Mode = GradientMode | "shade";
const MODES: Mode[] = ["natural", "lightness", "saturation", "hue", "shade"];
const SHADE_MAX_STEPS = 4;

export default function Gradients() {
  const { state } = usePalette();
  const history = useHistory();
  const [mode, setMode] = useState<Mode>("natural");
  const [count, setCount] = useState(1);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const anchorA = state.colors.find((c) => c.id === state.anchorA)?.hex ?? null;
  const anchorB = state.colors.find((c) => c.id === state.anchorB)?.hex ?? null;
  const paletteHexes = state.colors.map((c) => c.hex);

  const isShadeMode = mode === "shade";

  // --- Shade mode ---
  const shadeResult = useMemo(() => {
    if (!isShadeMode || !anchorA) return null;
    return shadeRamp(paletteHexes, anchorA, count);
  }, [isShadeMode, anchorA, paletteHexes, count]);

  const shadeGradient = useMemo(() => {
    if (!shadeResult || !anchorA) return [];
    return [...shadeResult.shadows, anchorA, ...shadeResult.highlights];
  }, [shadeResult, anchorA]);

  // --- Gradient mode (natural / lightness / saturation / hue) ---
  const inbetween = useMemo(() => {
    if (isShadeMode || !anchorA || !anchorB) return [];
    return gradientBetween(paletteHexes, anchorA, anchorB, mode as GradientMode)
      .filter((h) => !excluded.has(h));
  }, [isShadeMode, anchorA, anchorB, paletteHexes, mode, excluded]);

  const allCandidates = useMemo(() => {
    if (isShadeMode || !anchorA || !anchorB) return [];
    return gradientBetween(paletteHexes, anchorA, anchorB, mode as GradientMode);
  }, [isShadeMode, anchorA, anchorB, paletteHexes, mode]);

  const excludedCandidates = useMemo(
    () => allCandidates.filter((h) => excluded.has(h)),
    [allCandidates, excluded],
  );

  const picked = useMemo(() => pickEvenly(inbetween, count), [inbetween, count]);

  const gradientModeStrip = useMemo(
    () => (anchorA && anchorB ? [anchorA, ...picked, anchorB] : []),
    [anchorA, anchorB, picked],
  );

  const gradient = isShadeMode ? shadeGradient : gradientModeStrip;
  const midtoneIndex = isShadeMode && shadeResult
    ? shadeResult.shadows.length
    : -1;

  const metas = useMemo(() => gradient.map(swatchMeta), [gradient]);

  const outlierMap = useMemo(() => {
    const results = scoreGradientOutliers(gradient);
    return new Map(results.map((r) => [r.hex, r.isOutlier]));
  }, [gradient]);

  useEffect(() => {
    setSavedMsg(null);
    setCount(1);
    setExcluded(new Set());
  }, [state.anchorA, state.anchorB, mode]);

  function toggleExclude(hex: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(hex) ? next.delete(hex) : next.add(hex);
      return next;
    });
  }

  async function handleSave() {
    if (gradient.length === 0) return;
    const dataUrl = await renderGradientPng(gradient, 1080, 240);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    a.href = dataUrl;
    a.download = `palette-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSavedMsg("Saved to downloads");
  }

  // Fallback when required anchors are missing.
  const missingAnchors = isShadeMode ? !anchorA : !anchorA || !anchorB;
  if (missingAnchors) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Gradient</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonText>
            <p>
              {isShadeMode
                ? "Pick one anchor on the Palette screen to use as the midtone."
                : "Pick two anchors on the Palette screen first."}
            </p>
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
          <IonTitle>Gradient</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {/* Mode selector */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
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

        {/* Shade mode: steps-per-side slider */}
        {isShadeMode && (
          <div style={{ marginBottom: 12 }}>
            <IonText>
              <p style={{ margin: "0 0 4px", fontSize: 13 }}>
                Steps per side: {count}
                {shadeResult && (shadeResult.shadows.length < count || shadeResult.highlights.length < count)
                  ? " (palette limited)"
                  : ""}
              </p>
            </IonText>
            <IonRange
              min={1}
              max={SHADE_MAX_STEPS}
              step={1}
              value={count}
              onIonChange={(e) => setCount(e.detail.value as number)}
            />
          </div>
        )}

        {/* Gradient mode: inbetween count slider */}
        {!isShadeMode && inbetween.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <IonText>
              <p style={{ margin: "0 0 8px" }}>
                {inbetween.length} colour{inbetween.length !== 1 ? "s" : ""} available between your anchors.
              </p>
              <p style={{ margin: "0 0 4px", fontSize: 13 }}>
                Inbetweens: {count} / {inbetween.length}
              </p>
            </IonText>
            <IonRange
              min={1}
              max={inbetween.length}
              step={1}
              value={count}
              onIonChange={(e) => setCount(e.detail.value as number)}
            />
          </div>
        )}

        {!isShadeMode && inbetween.length === 0 && (
          <IonText>
            <p style={{ margin: "0 0 8px" }}>No palette colours fall between these anchors.</p>
          </IonText>
        )}

        {/* Color strip */}
        <div
          style={{
            display: "flex",
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid rgba(0,0,0,0.12)",
            marginBottom: 12,
          }}
        >
          {gradient.map((hex, i) => {
            const meta = metas[i];
            const isMidtone = i === midtoneIndex;
            const isAnchor = !isShadeMode && (i === 0 || i === gradient.length - 1);
            const isOutlier = outlierMap.get(hex) ?? false;
            const tappable = !isAnchor && !isMidtone;
            return (
              <div
                key={`${hex}-${i}`}
                role={tappable ? "button" : undefined}
                aria-label={tappable ? `gradient candidate ${hex}` : undefined}
                data-outlier={isOutlier ? "true" : undefined}
                onClick={tappable ? () => toggleExclude(hex) : undefined}
                style={{
                  flex: 1,
                  background: hex,
                  height: 80,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  cursor: tappable ? "pointer" : "default",
                  outline: isMidtone
                    ? "2px solid rgba(255,255,255,0.8)"
                    : isOutlier
                    ? "2px solid #f59e0b"
                    : undefined,
                  outlineOffset: -2,
                }}
                title={hex}
              >
                <div
                  style={{
                    background: "rgba(0,0,0,0.45)",
                    color: "#fff",
                    fontSize: 9,
                    textAlign: "center",
                    padding: "1px 0",
                    lineHeight: 1.2,
                    pointerEvents: "none",
                  }}
                >
                  {isMidtone && <div style={{ fontSize: 8, opacity: 0.8 }}>mid</div>}
                  <div>L:{meta.L.toFixed(2)}</div>
                  <div>C:{meta.C.toFixed(3)}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Excluded candidates row (gradient modes only) */}
        {!isShadeMode && excludedCandidates.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <IonText>
              <p style={{ margin: "0 0 4px", fontSize: 12, opacity: 0.6 }}>
                Excluded — tap to restore:
              </p>
            </IonText>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {excludedCandidates.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => toggleExclude(hex)}
                  aria-label={`restore ${hex}`}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    background: hex,
                    border: "2px solid rgba(0,0,0,0.25)",
                    opacity: 0.5,
                    cursor: "pointer",
                  }}
                  title={hex}
                />
              ))}
            </div>
          </div>
        )}

        <IonButton expand="block" onClick={handleSave} disabled={gradient.length === 0}>
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
