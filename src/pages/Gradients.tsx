import { useEffect, useMemo, useState } from "react";
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
import { gradientBetween } from "../lib/color";
import { renderGradientPng } from "../lib/gradient-canvas";

export default function Gradients() {
  const { state } = usePalette();
  const history = useHistory();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const anchorA = state.colors.find((c) => c.id === state.anchorA)?.hex ?? null;
  const anchorB = state.colors.find((c) => c.id === state.anchorB)?.hex ?? null;
  const paletteHexes = state.colors.map((c) => c.hex);

  // Build the gradient sequence: anchorA → inbetween palette colours → anchorB.
  // Only palette colours that project strictly between the two anchors in OKLab
  // are included — colours that fall outside the A–B segment are excluded.
  const inbetween = useMemo(() => {
    if (!anchorA || !anchorB) return [];
    return gradientBetween(paletteHexes, anchorA, anchorB);
  }, [anchorA, anchorB, paletteHexes]);

  const gradient = useMemo(
    () => (anchorA && anchorB ? [anchorA, ...inbetween, anchorB] : []),
    [anchorA, anchorB, inbetween],
  );

  // Reset saved message when anchors change.
  useEffect(() => {
    setSavedMsg(null);
  }, [state.anchorA, state.anchorB]);

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
        <IonText>
          <p>
            {inbetween.length > 0
              ? `${inbetween.length} colour${inbetween.length !== 1 ? "s" : ""} between your anchors.`
              : "No palette colours fall between these anchors."}
          </p>
        </IonText>

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
