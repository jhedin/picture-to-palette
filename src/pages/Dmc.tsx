import { useEffect, useRef, useState } from "react";
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { useHistory } from "react-router-dom";
import { usePalette } from "../lib/palette-store";
import { matchToDmc, expandDmcPalette } from "../lib/dmc-match";
import { DMC_COLORS, type DmcColor } from "../lib/dmc-colors";

export default function Dmc() {
  const { state, dispatch } = usePalette();
  const history = useHistory();
  const [search, setSearch] = useState("");
  const autoMatchedRef = useRef(false);

  // Auto-match when palette has colors and dmcSet is still empty.
  // Runs any time state.colors changes, but fires at most once (tracked by ref).
  useEffect(() => {
    if (!autoMatchedRef.current && state.dmcSet.length === 0 && state.colors.length > 0) {
      autoMatchedRef.current = true;
      const matched = matchToDmc(state.colors.map((c) => c.hex));
      dispatch({ type: "SET_DMC_SET", colors: matched });
    }
  }, [state.colors, state.dmcSet.length, dispatch]);

  function handleAutoMatch() {
    const matched = matchToDmc(state.colors.map((c) => c.hex));
    dispatch({ type: "SET_DMC_SET", colors: matched });
  }

  function handleExpandShades() {
    const expanded = expandDmcPalette(state.dmcSet, 1);
    dispatch({ type: "SET_DMC_SET", colors: expanded });
  }

  const existingIds = new Set(state.dmcSet.map((d) => d.id));

  const searchResults: DmcColor[] =
    search.trim().length === 0
      ? []
      : DMC_COLORS.filter(
          (d) =>
            !existingIds.has(d.id) &&
            (d.name.toLowerCase().includes(search.toLowerCase()) ||
              d.id.includes(search.trim())),
        ).slice(0, 8);

  if (state.colors.length === 0 && state.dmcSet.length === 0) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonBackButton defaultHref="/palette" text="Palette" />
            </IonButtons>
            <IonTitle>DMC Match</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonText>
            <p>Your palette is empty. Extract colors from an image first, then come back here to match DMC threads.</p>
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
            <IonBackButton defaultHref="/palette" text="Palette" />
          </IonButtons>
          <IonTitle>DMC Match</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Auto-match section */}
        <IonButton expand="block" onClick={handleAutoMatch}>
          Auto-match from palette
        </IonButton>

        {/* DMC set list */}
        <div style={{ margin: "16px 0" }}>
          {state.dmcSet.length === 0 ? (
            <IonText color="medium">
              <p>No threads selected yet.</p>
            </IonText>
          ) : (
            state.dmcSet.map((color) => (
              <div
                key={color.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--ion-color-light-shade, #eee)",
                }}
              >
                {/* Color swatch circle */}
                <div
                  aria-label={`Swatch ${color.id}`}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: color.hex,
                    border: "1px solid #ccc",
                    flexShrink: 0,
                  }}
                />
                {/* Thread info */}
                <IonText style={{ flex: 1 }}>
                  <strong>{color.id}</strong> — {color.name}
                </IonText>
                {/* Remove button */}
                <button
                  type="button"
                  aria-label={`Remove thread ${color.id}`}
                  onClick={() => dispatch({ type: "REMOVE_DMC", id: color.id })}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: "none",
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add more threads search */}
        <div style={{ margin: "16px 0" }}>
          <IonText>
            <p>
              <strong>Add more threads</strong>
            </p>
          </IonText>
          <input
            type="text"
            placeholder="Search by name or number…"
            aria-label="Search DMC threads"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: 16,
              border: "1px solid #ccc",
              borderRadius: 8,
              boxSizing: "border-box",
            }}
          />
          {searchResults.length > 0 && (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 8,
                marginTop: 4,
                overflow: "hidden",
              }}
            >
              {searchResults.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  aria-label={`Add thread ${d.id} ${d.name}`}
                  onClick={() => {
                    dispatch({ type: "ADD_DMC", color: d });
                    setSearch("");
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    borderBottom: "1px solid var(--ion-color-light-shade, #eee)",
                    background: "var(--ion-background-color, #fff)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: d.hex,
                      border: "1px solid #ccc",
                      flexShrink: 0,
                    }}
                  />
                  <span>
                    <strong>{d.id}</strong> — {d.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <IonButton fill="outline" expand="block" onClick={handleExpandShades}>
          Expand shades
        </IonButton>
        <IonButton
          expand="block"
          onClick={() => history.push("/gradients")}
        >
          Go to Gradients →
        </IonButton>
      </IonContent>
    </IonPage>
  );
}
