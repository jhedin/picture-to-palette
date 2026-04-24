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
  swatchMeta,
  scoreGradientOutliers,
  type GradientMode,
} from "../lib/color";
import { renderGradientPng } from "../lib/gradient-canvas";

export default function Gradients() {
  const { state } = usePalette();
  const history = useHistory();
  const [mode, setMode] = useState<GradientMode>("natural");
  const [count, setCount] = useState(1);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const anchorA = state.colors.find((c) => c.id === state.anchorA)?.hex ?? null;
  const anchorB = state.colors.find((c) => c.id === state.anchorB)?.hex ?? null;
  const paletteHexes = state.colors.map((c) => c.hex);

  const inbetween = useMemo(() => {
    if (!anchorA || !anchorB) return [];
    return gradientBetween(paletteHexes, anchorA, anchorB, mode)
      .filter((h) => !excluded.has(h));
  }, [anchorA, anchorB, paletteHexes, mode, excluded]);

  // Full candidate list (before exclusions) so excluded swatches can be shown
  // in a re-include row.
  const allCandidates = useMemo(() => {
    if (!anchorA || !anchorB) return [];
    return gradientBetween(paletteHexes, anchorA, anchorB, mode);
  }, [anchorA, anchorB, paletteHexes, mode]);

  const excludedCandidates = useMemo(
    () => allCandidates.filter((h) => excluded.has(h)),
    [allCandidates, excluded],
  );

  const picked = useMemo(() => pickEvenly(inbetween, count), [inbetween, count]);

  const gradient = useMemo(
    () => (anchorA && anchorB ? [anchorA, ...picked, anchorB] : []),
    [anchorA, anchorB, picked],
  );

  const metas = useMemo(() => gradient.map(swatchMeta), [gradient]);

  const outlierMap = useMemo(() => {
    const results = scoreGradientOutliers(gradient);
    return new Map(results.map((r) => [r.hex, r.isOutlier]));
  }, [gradient]);

  // Reset on anchor/mode change.
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

  if (!anchorA || !anchorB) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Gradient</IonTitle>
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
          <IonTitle>Gradient</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {/* Mode selector */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {(["natural", "lightness", "saturation", "hue"] as GradientMode[]).map((m) => (
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

        <IonText>
          <p style={{ margin: "0 0 8px" }}>
            {inbetween.length > 0
              ? `${inbetween.length} colour${inbetween.length !== 1 ? "s" : ""} available between your anchors.`
              : "No palette colours fall between these anchors."}
          </p>
        </IonText>

        {inbetween.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <IonText>
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

        {/* Gradient strip with L/C readout and tap-to-exclude */}
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
            const isAnchor = i === 0 || i === gradient.length - 1;
            const isOutlier = outlierMap.get(hex) ?? false;
            return (
              <div
                key={`${hex}-${i}`}
                role={isAnchor ? undefined : "button"}
                aria-label={isAnchor ? undefined : hex}
                data-outlier={isOutlier ? "true" : undefined}
                onClick={isAnchor ? undefined : () => toggleExclude(hex)}
                style={{
                  flex: 1,
                  background: hex,
                  height: 80,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  cursor: isAnchor ? "default" : "pointer",
                  outline: isOutlier ? "2px solid #f59e0b" : undefined,
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
                  <div>L:{meta.L.toFixed(2)}</div>
                  <div>C:{meta.C.toFixed(3)}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Excluded candidates — tap to re-include */}
        {excludedCandidates.length > 0 && (
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
