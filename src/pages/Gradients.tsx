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
import { gradientBetween, pickEvenly, type GradientMode } from "../lib/color";
import { renderGradientPng } from "../lib/gradient-canvas";

export default function Gradients() {
  const { state } = usePalette();
  const history = useHistory();
  const [mode, setMode] = useState<GradientMode>("natural");
  const [count, setCount] = useState(1);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const anchorA = state.colors.find((c) => c.id === state.anchorA)?.hex ?? null;
  const anchorB = state.colors.find((c) => c.id === state.anchorB)?.hex ?? null;
  const paletteHexes = state.colors.map((c) => c.hex);

  // Build the gradient sequence: anchorA → inbetween palette colours → anchorB.
  // Only palette colours that project strictly between the two anchors in OKLab
  // are included — colours that fall outside the A–B segment are excluded.
  const inbetween = useMemo(() => {
    if (!anchorA || !anchorB) return [];
    return gradientBetween(paletteHexes, anchorA, anchorB, mode);
  }, [anchorA, anchorB, paletteHexes, mode]);

  const picked = useMemo(() => pickEvenly(inbetween, count), [inbetween, count]);

  const gradient = useMemo(
    () => (anchorA && anchorB ? [anchorA, ...picked, anchorB] : []),
    [anchorA, anchorB, picked],
  );

  // Reset saved message and count when anchors or mode change.
  useEffect(() => {
    setSavedMsg(null);
    setCount(1);
  }, [state.anchorA, state.anchorB, mode]);

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

        {/* Solid colour blocks — equal width, no blending */}
        <div
          style={{
            display: "flex",
            height: 80,
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid rgba(0,0,0,0.12)",
            marginBottom: 16,
          }}
        >
          {gradient.map((hex) => (
            <div
              key={hex}
              style={{ flex: 1, background: hex }}
              title={hex}
            />
          ))}
        </div>

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
