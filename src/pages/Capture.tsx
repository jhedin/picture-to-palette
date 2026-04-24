import { useEffect, useRef, useState } from "react";
import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonProgressBar,
  IonText,
  IonTitle,
  IonToast,
  IonToolbar,
} from "@ionic/react";
import { useHistory } from "react-router-dom";
import { extractPalette } from "../lib/mean-shift.worker";
import { usePalette } from "../lib/palette-store";

type Status = "idle" | "extracting" | "ready" | "error";

export default function Capture() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { state, dispatch } = usePalette();
  const history = useHistory();

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  async function handleFile(file: File) {
    setStatus("extracting");
    setCandidates([]);
    setAccepted(new Set());
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));

    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas context");
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const hexes = extractPalette(imageData);
      if (hexes.length === 0) {
        setStatus("error");
        setErrorMsg("Couldn't find distinct colors in this photo");
        return;
      }
      setCandidates(hexes);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Extraction failed");
    }
  }

  function addOne(hex: string) {
    dispatch({ type: "ADD_COLOR", hex });
    setAccepted((prev) => new Set(prev).add(hex));
  }

  function acceptAll() {
    for (const hex of candidates) {
      if (!accepted.has(hex)) dispatch({ type: "ADD_COLOR", hex });
    }
    setAccepted(new Set(candidates));
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Capture</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        {!photoUrl && (
          <IonButton expand="block" onClick={() => inputRef.current?.click()}>
            Take or upload photo
          </IonButton>
        )}

        {photoUrl && (
          <img
            src={photoUrl}
            alt="captured"
            style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 8 }}
          />
        )}

        {status === "extracting" && <IonProgressBar type="indeterminate" />}

        {status === "ready" && (
          <>
            <IonText>
              <p>
                Tap a swatch to add it to your palette. Already added: {accepted.size} /{" "}
                {candidates.length}.
              </p>
            </IonText>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
              {candidates.map((hex) => {
                const isAdded = accepted.has(hex);
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={isAdded ? `Added color ${hex}` : `Add color ${hex}`}
                    onClick={() => !isAdded && addOne(hex)}
                    disabled={isAdded}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: "50%",
                      background: hex,
                      border: isAdded ? "3px solid var(--ion-color-primary)" : "none",
                      cursor: isAdded ? "default" : "pointer",
                    }}
                  />
                );
              })}
            </div>
            <IonButton onClick={acceptAll} disabled={accepted.size === candidates.length}>
              Accept all
            </IonButton>
            <IonButton onClick={() => inputRef.current?.click()} fill="outline">
              Add another photo
            </IonButton>
            <IonButton
              expand="block"
              onClick={() => history.push("/palette")}
              disabled={state.colors.length < 2}
            >
              Next → Palette ({state.colors.length})
            </IonButton>
          </>
        )}

        <IonToast
          isOpen={status === "error"}
          message={errorMsg ?? ""}
          duration={3000}
          onDidDismiss={() => setStatus("idle")}
        />
      </IonContent>
    </IonPage>
  );
}
