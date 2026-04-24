import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { useHistory } from "react-router-dom";
import { usePalette } from "../lib/palette-store";

export default function Palette() {
  const { state, dispatch } = usePalette();
  const history = useHistory();

  const canGenerate = state.anchorA !== null && state.anchorB !== null;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Palette</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText>
          <p>
            Tap two colors to pick anchors. {state.colors.length} color
            {state.colors.length === 1 ? "" : "s"} in palette.
          </p>
        </IonText>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
            gap: 12,
            margin: "12px 0",
          }}
        >
          {state.colors.map((color) => {
            const anchor =
              color.id === state.anchorA
                ? "A"
                : color.id === state.anchorB
                  ? "B"
                  : null;
            return (
              <div key={color.id} style={{ position: "relative" }}>
                <button
                  type="button"
                  aria-label={`Swatch ${color.hex}`}
                  data-anchor={anchor ?? ""}
                  onClick={() => dispatch({ type: "TAP_SWATCH", id: color.id })}
                  style={{
                    width: "100%",
                    paddingTop: "100%",
                    background: color.hex,
                    borderRadius: 8,
                    border: anchor
                      ? "4px solid var(--ion-color-primary)"
                      : "1px solid #ccc",
                    cursor: "pointer",
                    position: "relative",
                  }}
                >
                  {anchor && (
                    <span
                      style={{
                        position: "absolute",
                        top: 4,
                        left: 4,
                        background: "var(--ion-color-primary)",
                        color: "white",
                        padding: "2px 8px",
                        borderRadius: 6,
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      {anchor}
                    </span>
                  )}
                </button>
                <div
                  style={{
                    textAlign: "center",
                    fontFamily: "monospace",
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  {color.hex}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${color.hex}`}
                  onClick={() =>
                    dispatch({ type: "REMOVE_COLOR", id: color.id })
                  }
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "none",
                    background: "#000a",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <IonButton
          expand="block"
          onClick={() => history.push("/gradients")}
          disabled={!canGenerate}
        >
          Generate gradients
        </IonButton>
        <IonButton
          fill="outline"
          expand="block"
          onClick={() => history.push("/dmc")}
        >
          Match DMC threads
        </IonButton>
        <IonButton
          fill="outline"
          expand="block"
          onClick={() => history.push("/capture")}
        >
          Back to Capture
        </IonButton>
      </IonContent>
    </IonPage>
  );
}
