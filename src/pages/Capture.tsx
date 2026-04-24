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
import { extractPalette, suggestCrop, type CropBox, type DebugData, type ExtractionOptions, DEFAULT_OPTIONS } from "../lib/mean-shift.worker";
import { usePalette } from "../lib/palette-store";
import { CropOverlay } from "../components/CropOverlay";

type Status = "idle" | "scanning" | "cropping" | "extracting" | "ready" | "error";

export default function Capture() {
  const inputRef = useRef<HTMLInputElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // Raw ImageData kept so we can re-crop without re-reading the file.
  const imageDataRef = useRef<ImageData | null>(null);
  const [cropBox, setCropBox] = useState<CropBox>({ x: 0, y: 0, w: 1, h: 1 });
  const [candidates, setCandidates] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [lastHexes, setLastHexes] = useState<string[]>([]);
  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [options, setOptions] = useState<ExtractionOptions>({ ...DEFAULT_OPTIONS });
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
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(debugData.segPixels), debugData.segWidth, debugData.segHeight),
      0, 0,
    );
  }, [showDebug, debugData]);

  async function handleFile(file: File) {
    setStatus("scanning");
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
      imageDataRef.current = imageData;

      // Quick SLIC pass to suggest a crop rectangle.
      const suggestion = suggestCrop(imageData);
      setCropBox(suggestion);
      setStatus("cropping");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to load photo");
    }
  }

  async function runExtraction(crop: CropBox) {
    if (!imageDataRef.current) return;
    setStatus("extracting");
    try {
      const { hexes, debug } = extractPalette(imageDataRef.current, crop, options);
      if (hexes.length === 0) {
        setStatus("error");
        setErrorMsg("Couldn't find distinct colors in this region");
        return;
      }
      setDebugData(debug);
      setLastHexes(hexes);
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

  const isCroppedSignificantly =
    cropBox.w < 0.95 || cropBox.h < 0.95 || cropBox.x > 0.02 || cropBox.y > 0.02;

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
            e.target.value = "";
            if (f) handleFile(f);
          }}
        />

        {!photoUrl && (
          <IonButton expand="block" onClick={() => inputRef.current?.click()}>
            Take or upload photo
          </IonButton>
        )}

        {/* ── Photo + crop overlay ───────────────────────────────────────── */}
        {photoUrl && (
          // Wrapper shrinks to actual rendered image size so the crop overlay
          // exactly covers the image pixels, not the surrounding whitespace.
          <div style={{ position: "relative", display: "block", width: "fit-content", maxWidth: "100%", margin: "0 auto 12px" }}>
            <img
              src={photoUrl}
              alt="captured"
              style={{ display: "block", maxWidth: "100%", maxHeight: 360, borderRadius: 8 }}
            />
            {status === "cropping" && (
              <CropOverlay box={cropBox} onChange={setCropBox} />
            )}
          </div>
        )}

        {status === "scanning" && <IonProgressBar type="indeterminate" />}
        {status === "extracting" && <IonProgressBar type="indeterminate" />}

        {/* ── Crop confirmation ─────────────────────────────────────────── */}
        {status === "cropping" && (
          <>
            <IonText color="medium">
              <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                {isCroppedSignificantly
                  ? "Subject detected — adjust the crop then tap Extract."
                  : "Drag the handles to crop to the area of interest."}
              </p>
            </IonText>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <IonButton onClick={() => runExtraction(cropBox)}>
                Extract colors
              </IonButton>
              <IonButton fill="outline" onClick={() => runExtraction({ x: 0, y: 0, w: 1, h: 1 })}>
                Use full image
              </IonButton>
            </div>

            {/* ── Extraction settings ─────────────────────────────────── */}
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              style={{ background: "none", border: "none", color: "var(--ion-color-medium)", fontSize: 12, cursor: "pointer", padding: "4px 0", display: "block" }}
            >
              {showSettings ? "▲ Hide settings" : "▼ Extraction settings"}
            </button>
            {showSettings && (
              <div style={{ padding: "8px 0 4px", display: "flex", flexDirection: "column", gap: 12 }}>
                <ExtractionSlider
                  label="Colour merge"
                  hint="Low = keep shadows/highlights separate · High = collapse variants"
                  value={options.mergeBandwidth}
                  min={0.04} max={0.25} step={0.01}
                  format={(v) => v.toFixed(2)}
                  onChange={(v) => setOptions((o) => ({ ...o, mergeBandwidth: v }))}
                />
                <ExtractionSlider
                  label="Within-region detail"
                  hint="Low = more sub-colours per region · High = one bold colour per region"
                  value={options.segBandwidthCap}
                  min={0.04} max={0.20} step={0.01}
                  format={(v) => v.toFixed(2)}
                  onChange={(v) => setOptions((o) => ({ ...o, segBandwidthCap: v }))}
                />
                <ExtractionSlider
                  label="Region size"
                  hint="Small = fine spatial detail · Large = broad areas, ignores small objects"
                  value={options.segmentSize}
                  min={300} max={5000} step={100}
                  format={(v) => `${v} px`}
                  onChange={(v) => setOptions((o) => ({ ...o, segmentSize: v }))}
                />
                <button
                  type="button"
                  onClick={() => setOptions({ ...DEFAULT_OPTIONS })}
                  style={{ background: "none", border: "none", color: "var(--ion-color-medium)", fontSize: 11, cursor: "pointer", padding: 0, textAlign: "left" }}
                >
                  Reset to defaults
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Palette chips ─────────────────────────────────────────────── */}
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
                  <div key={hex} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <button
                      type="button"
                      aria-label={isAdded ? `Added color ${hex}` : `Add color ${hex}`}
                      onClick={() => !isAdded && addOne(hex)}
                      disabled={isAdded}
                      style={{
                        width: 56, height: 56, borderRadius: "50%", background: hex,
                        border: isAdded ? "3px solid var(--ion-color-primary)" : "2px solid rgba(0,0,0,0.15)",
                        cursor: isAdded ? "default" : "pointer",
                      }}
                    />
                    {pct !== null && (
                      <span style={{ fontSize: 10, color: "var(--ion-color-medium)" }}>{pct}%</span>
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
              <IonButton fill="outline" onClick={() => { setStatus("cropping"); }}>
                Adjust crop
              </IonButton>
            </div>

            {debugData && (
              <button
                type="button"
                onClick={() => setShowDebug((v) => !v)}
                style={{
                  background: "none", border: "none",
                  color: "var(--ion-color-medium)", fontSize: 12,
                  cursor: "pointer", padding: "4px 0", marginBottom: 8, display: "block",
                }}
              >
                {showDebug ? "▲ Hide debug" : "▼ Show debug"}
              </button>
            )}

            {showDebug && debugData && (
              <div style={{ marginBottom: 12 }}>
                <canvas
                  ref={debugCanvasRef}
                  style={{ width: "100%", imageRendering: "pixelated", borderRadius: 4, display: "block" }}
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

interface SliderProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function ExtractionSlider({ label, hint, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "var(--ion-color-primary)" }}>
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", margin: "2px 0" }}
      />
      <p style={{ fontSize: 11, color: "var(--ion-color-medium)", margin: 0 }}>{hint}</p>
    </div>
  );
}
