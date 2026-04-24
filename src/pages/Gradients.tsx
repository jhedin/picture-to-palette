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
