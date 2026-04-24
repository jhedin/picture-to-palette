import { useEffect, useRef, useState } from "react";
import {
  IonBackButton,
  IonButton,
  IonButtons,
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
import { hexToOklab, oklabToHex } from "../lib/color";
import { usePalette } from "../lib/palette-store";
import { CropOverlay } from "../components/CropOverlay";

type Status = "idle" | "scanning" | "cropping" | "extracting" | "ready" | "error";

export default function Capture() {
  const inputRef = useRef<HTMLInputElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
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
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeFirst, setMergeFirst] = useState<string | null>(null);
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
      setMergeMode(false);
      setMergeFirst(null);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Extraction failed");
    }
  }

  function addOne(hex: string) {
    if (accepted.has(hex)) return;
    dispatch({ type: "ADD_COLOR", hex });
    setAccepted((prev) => new Set(prev).add(hex));
  }

  function removeAccepted(hex: string) {
    const entry = state.colors.find((c) => c.hex === hex);
    if (entry) dispatch({ type: "REMOVE_COLOR", id: entry.id });
    setAccepted((prev) => { const next = new Set(prev); next.delete(hex); return next; });
  }

  function acceptAll() {
    for (const hex of candidates) {
      if (!accepted.has(hex)) dispatch({ type: "ADD_COLOR", hex });
    }
    setAccepted(new Set(candidates));
  }

  function clearUnselected() {
    setCandidates(Array.from(accepted));
  }

  function handleCandidateTap(hex: string) {
    if (!mergeMode) { addOne(hex); return; }
    if (mergeFirst === null) { setMergeFirst(hex); return; }
    if (mergeFirst === hex) { setMergeFirst(null); return; }
    // Two different chips tapped — average in OKLab and replace both.
    const labA = hexToOklab(mergeFirst);
    const labB = hexToOklab(hex);
    const merged = oklabToHex({ L: (labA.L + labB.L) / 2, a: (labA.a + labB.a) / 2, b: (labA.b + labB.b) / 2 });
    setCandidates((prev) => {
      const idx = Math.min(prev.indexOf(mergeFirst), prev.indexOf(hex));
      const without = prev.filter((h) => h !== mergeFirst && h !== hex);
      without.splice(idx, 0, merged);
      return without;
    });
    setMergeFirst(null);
    setMergeMode(false);
  }

  function clearAll() {
    for (const hex of accepted) {
      const entry = state.colors.find((c) => c.hex === hex);
      if (entry) dispatch({ type: "REMOVE_COLOR", id: entry.id });
    }
    setCandidates([]);
    setAccepted(new Set());
  }

  const isCroppedSignificantly =
    cropBox.w < 0.95 || cropBox.h < 0.95 || cropBox.x > 0.02 || cropBox.y > 0.02;

  const totalSegPixels = debugData ? debugData.segWidth * debugData.segHeight : 1;
  const unadded = candidates.filter((h) => !accepted.has(h));
  const addedList = candidates.filter((h) => accepted.has(h));

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          {state.colors.length > 0 && (
            <IonButtons slot="start">
              <IonBackButton defaultHref="/palette" text="Palette" />
            </IonButtons>
          )}
          <IonTitle>Capture <span style={{ fontSize: 11, opacity: 0.5, fontWeight: 400 }}>({__GIT_SHA__})</span></IonTitle>
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
                  ticks={[0.04, 0.06, 0.08, 0.10, 0.15, 0.20, 0.25]}
                  format={(v) => v.toFixed(2)}
                  onChange={(v) => setOptions((o) => ({ ...o, mergeBandwidth: v }))}
                />
                <ExtractionSlider
                  label="Within-region detail"
                  hint="Low = more sub-colours per region · High = one bold colour per region"
                  value={options.segBandwidthCap}
                  min={0.04} max={0.20} step={0.01}
                  ticks={[0.04, 0.06, 0.08, 0.10, 0.14, 0.20]}
                  format={(v) => v.toFixed(2)}
                  onChange={(v) => setOptions((o) => ({ ...o, segBandwidthCap: v }))}
                />
                <ExtractionSlider
                  label="Region size"
                  hint="Small = fine spatial detail · Large = broad areas, ignores small objects"
                  value={options.segmentSize}
                  min={300} max={5000} step={100}
                  ticks={[300, 500, 1000, 1500, 2000, 3000, 5000]}
                  format={(v) => `${v} px`}
                  onChange={(v) => setOptions((o) => ({ ...o, segmentSize: v }))}
                />
                <ExtractionSlider
                  label="Ignore small regions"
                  hint="Skip regions under this fraction of the target region size — filters labels, glints, slivers. 0 = off"
                  value={options.minSegmentFrac}
                  min={0} max={1.0} step={0.05}
                  ticks={[0, 0.25, 0.5, 0.75, 1.0]}
                  format={(v) => v === 0 ? "off" : `×${v.toFixed(2)}`}
                  onChange={(v) => setOptions((o) => ({ ...o, minSegmentFrac: v }))}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={options.kuwahara}
                    onChange={(e) => setOptions((o) => ({ ...o, kuwahara: e.target.checked }))}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Flatten texture (Kuwahara)</span>
                </label>
                <p style={{ fontSize: 11, color: "var(--ion-color-medium)", margin: "-8px 0 0 24px" }}>
                  Smooths knitted nubs and yarn highlights before segmenting — reduces spurious colour variants from texture
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={options.excludeBorder}
                    onChange={(e) => setOptions((o) => ({ ...o, excludeBorder: e.target.checked }))}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Remove border segments (SLIC)</span>
                </label>
                <p style={{ fontSize: 11, color: "var(--ion-color-medium)", margin: "-8px 0 0 24px" }}>
                  Excludes segments that touch the image edge — quick and safe for plain backgrounds
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={options.subtractBackground}
                    onChange={(e) => setOptions((o) => ({ ...o, subtractBackground: e.target.checked }))}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Remove background (MBD propagation)</span>
                </label>
                <p style={{ fontSize: 11, color: "var(--ion-color-medium)", margin: "-8px 0 0 24px" }}>
                  Propagates background removal inward via Minimum Barrier Distance — handles interior background gaps
                </p>
                <ExtractionSlider
                  label="Merge brightness sensitivity"
                  hint="1 = standard 3D merge · 0.2 = collapse shadows/highlights of same hue · 0 = hue-only (chroma plane)"
                  value={options.mergeL}
                  min={0} max={1.0} step={0.05}
                  ticks={[0, 0.2, 0.5, 1.0]}
                  format={(v) => v === 1 ? "full" : v === 0 ? "hue only" : v.toFixed(2)}
                  onChange={(v) => setOptions((o) => ({ ...o, mergeL: v }))}
                />
                <IonButton
                  fill="outline"
                  size="small"
                  onClick={() => setOptions({ ...DEFAULT_OPTIONS })}
                  style={{ alignSelf: "flex-start" }}
                >
                  Reset to defaults
                </IonButton>
              </div>
            )}
          </>
        )}

        {/* ── Palette chips ─────────────────────────────────────────────── */}
        {status === "ready" && (
          <>
            {/* Found colors */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <SectionLabel style={{ margin: 0 }}>
                {mergeMode
                  ? mergeFirst ? "Now tap the second color to merge" : "Tap the first color to merge"
                  : "Found in this crop"}
              </SectionLabel>
              {unadded.length >= 2 && (
                <button
                  type="button"
                  onClick={() => { setMergeMode((v) => !v); setMergeFirst(null); }}
                  style={{
                    background: mergeMode ? "var(--ion-color-primary)" : "none",
                    color: mergeMode ? "var(--ion-color-primary-contrast)" : "var(--ion-color-primary)",
                    border: "1px solid var(--ion-color-primary)",
                    borderRadius: 12, fontSize: 11, padding: "2px 10px", cursor: "pointer",
                  }}
                >
                  {mergeMode ? "Cancel merge" : "Merge…"}
                </button>
              )}
            </div>
            {unadded.length === 0 ? (
              <IonText color="medium">
                <p style={{ margin: "0 0 12px", fontSize: 13 }}>All found colors have been added.</p>
              </IonText>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {unadded.map((hex) => {
                  const extIdx = lastHexes.indexOf(hex);
                  const pct =
                    showDebug && debugData && extIdx >= 0
                      ? Math.round((debugData.clusterSizes[extIdx] / totalSegPixels) * 100)
                      : null;
                  const isFirstSelected = mergeFirst === hex;
                  return (
                    <div key={hex} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <button
                        type="button"
                        aria-label={mergeMode ? `Select ${hex} for merge` : `Add color ${hex}`}
                        draggable={!mergeMode}
                        onDragStart={(e) => !mergeMode && e.dataTransfer.setData("text/plain", hex)}
                        onClick={() => handleCandidateTap(hex)}
                        style={{
                          width: 52, height: 52, borderRadius: "50%", background: hex,
                          border: isFirstSelected
                            ? "3px solid var(--ion-color-warning)"
                            : mergeMode
                            ? "3px dashed var(--ion-color-primary)"
                            : "2px solid rgba(0,0,0,0.15)",
                          cursor: mergeMode ? "pointer" : "grab",
                          transform: isFirstSelected ? "scale(1.1)" : undefined,
                          transition: "transform 0.1s, border 0.1s",
                        }}
                      />
                      {pct !== null && (
                        <span style={{ fontSize: 10, color: "var(--ion-color-medium)" }}>{pct}%</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Accepted / drop zone */}
            <SectionLabel>Your palette — tap to add, drag here</SectionLabel>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const hex = e.dataTransfer.getData("text/plain");
                if (hex) addOne(hex);
              }}
              style={{
                minHeight: 68,
                borderRadius: 10,
                border: "2px dashed var(--ion-color-primary-tint, #a0c4ff)",
                padding: "8px 10px",
                marginBottom: 12,
              }}
            >
              {addedList.length === 0 ? (
                <IonText color="medium">
                  <p style={{ margin: 0, fontSize: 13 }}>Tap a color above to add it here, or drag it in.</p>
                </IonText>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {addedList.map((hex) => (
                    <div key={hex} style={{ position: "relative" }}>
                      <div
                        style={{
                          width: 52, height: 52, borderRadius: "50%", background: hex,
                          border: "2px solid var(--ion-color-primary)",
                        }}
                      />
                      <button
                        type="button"
                        aria-label={`Remove color ${hex}`}
                        onClick={() => removeAccepted(hex)}
                        style={{
                          position: "absolute", top: -3, right: -3,
                          width: 20, height: 20, borderRadius: "50%",
                          background: "var(--ion-background-color, #fff)",
                          border: "1px solid rgba(0,0,0,0.25)",
                          cursor: "pointer", padding: 0,
                          fontSize: 14, lineHeight: "18px", textAlign: "center",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action row */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <IonButton
                onClick={acceptAll}
                disabled={unadded.length === 0}
              >
                Accept all
              </IonButton>
              {unadded.length > 0 && (
                <IonButton fill="outline" onClick={clearUnselected}>
                  Clear found
                </IonButton>
              )}
              {candidates.length > 0 && (
                <IonButton fill="outline" color="danger" onClick={clearAll}>
                  Clear all
                </IonButton>
              )}
              <IonButton fill="outline" onClick={() => { setStatus("cropping"); }}>
                Re-crop
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
          onDidDismiss={() => setStatus(imageDataRef.current ? "cropping" : "idle")}
        />
      </IonContent>
    </IonPage>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ion-color-medium)", ...style }}>
      {children}
    </p>
  );
}

interface SliderProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  ticks?: number[];
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function ExtractionSlider({ label, hint, value, min, max, step, ticks, format, onChange }: SliderProps) {
  const listId = `ticks-${label.replace(/\s+/g, "-").toLowerCase()}`;
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
        list={ticks ? listId : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", margin: "2px 0" }}
      />
      {ticks && (
        <datalist id={listId}>
          {ticks.map((t) => <option key={t} value={t} />)}
        </datalist>
      )}
      <p style={{ fontSize: 11, color: "var(--ion-color-medium)", margin: 0 }}>{hint}</p>
    </div>
  );
}
