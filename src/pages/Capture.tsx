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
import { extractPalette, type DebugData } from "../lib/mean-shift.worker";
import { usePalette } from "../lib/palette-store";

type Status = "idle" | "extracting" | "ready" | "error";

export default function Capture() {
  const inputRef = useRef<HTMLInputElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [lastHexes, setLastHexes] = useState<string[]>([]);
  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { state, dispatch } = usePalette();
  const history = useHistory();

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  useEffect(() => {
    if (!showDebug || !debugData || !debugCanvasRef.current) return;
    const canvas = debugCanvasRef.current;
    canvas.width = debugData.segWidth;
    canvas.height = debugData.segHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imgData = new ImageData(
      new Uint8ClampedArray(debugData.segPixels),
      debugData.segWidth,
      debugData.segHeight,
    );
    ctx.putImageData(imgData, 0, 0);
  }, [showDebug, debugData]);

  async function handleFile(file: File) {
    setStatus("extracting");
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
      const { hexes, debug } = extractPalette(imageData);
      if (hexes.length === 0) {
        setStatus("error");
        setErrorMsg("Couldn't find distinct colors in this photo");
        return;
      }
      setDebugData(debug);
      setLastHexes(hexes);
      // Accumulate new unique candidates across photos
      setCandidates((prev) => {
        const existing = new Set(prev);
        return [...prev, ...hexes.filter((h) => !existing.has(h))];
      });
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

  const totalSegPixels = debugData ? debugData.segWidth * debugData.segHeight : 1;

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
            // Reset so the same file can be selected again on the next upload
            e.target.value = "";
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
                Tap a swatch to add it to your palette. Already added:{" "}
                {accepted.size} / {candidates.length}.
              </p>
            </IonText>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
              {candidates.map((hex) => {
                const isAdded = accepted.has(hex);
                const extIdx = lastHexes.indexOf(hex);
                const pct =
                  showDebug && debugData && extIdx >= 0
                    ? Math.round((debugData.clusterSizes[extIdx] / totalSegPixels) * 100)
                    : null;
                return (
                  <div
                    key={hex}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
                  >
                    <button
                      type="button"
                      aria-label={isAdded ? `Added color ${hex}` : `Add color ${hex}`}
                      onClick={() => !isAdded && addOne(hex)}
                      disabled={isAdded}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: "50%",
                        background: hex,
                        border: isAdded
                          ? "3px solid var(--ion-color-primary)"
                          : "2px solid rgba(0,0,0,0.15)",
                        cursor: isAdded ? "default" : "pointer",
                      }}
                    />
                    {pct !== null && (
                      <span style={{ fontSize: 10, color: "var(--ion-color-medium)" }}>
                        {pct}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <IonButton
                onClick={acceptAll}
                disabled={candidates.every((h) => accepted.has(h))}
              >
                Accept all
              </IonButton>
              <IonButton onClick={() => inputRef.current?.click()} fill="outline">
                Add another photo
              </IonButton>
            </div>

            {debugData && (
              <button
                type="button"
                onClick={() => setShowDebug((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--ion-color-medium)",
                  fontSize: 12,
                  cursor: "pointer",
                  padding: "4px 0",
                  marginBottom: 8,
                  display: "block",
                }}
              >
                {showDebug ? "▲ Hide debug" : "▼ Show debug"}
              </button>
            )}

            {showDebug && debugData && (
              <div style={{ marginBottom: 12 }}>
                <canvas
                  ref={debugCanvasRef}
                  style={{
                    width: "100%",
                    imageRendering: "pixelated",
                    borderRadius: 4,
                    display: "block",
                  }}
                />
                <IonText color="medium">
                  <p style={{ fontSize: 11, margin: "4px 0 0" }}>
                    Segmented at {debugData.segWidth}×{debugData.segHeight}px ·{" "}
                    bandwidth {debugData.bandwidth.toFixed(3)} ·{" "}
                    {lastHexes.length} cluster{lastHexes.length !== 1 ? "s" : ""}
                  </p>
                </IonText>
              </div>
            )}

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
