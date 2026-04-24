import { useRef } from "react";
import type { CropBox } from "../lib/mean-shift.worker";

interface Props {
  box: CropBox;
  onChange: (box: CropBox) => void;
}

type Handle = "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r" | "move";

const MIN = 0.08;

const HANDLES: { id: Handle; cursor: string; style: React.CSSProperties }[] = [
  { id: "tl", cursor: "nw-resize", style: { top: -7,    left: -7  } },
  { id: "tr", cursor: "ne-resize", style: { top: -7,    right: -7 } },
  { id: "bl", cursor: "sw-resize", style: { bottom: -7, left: -7  } },
  { id: "br", cursor: "se-resize", style: { bottom: -7, right: -7 } },
  { id: "t",  cursor: "n-resize",  style: { top: -7,    left: "calc(50% - 7px)" } },
  { id: "b",  cursor: "s-resize",  style: { bottom: -7, left: "calc(50% - 7px)" } },
  { id: "l",  cursor: "w-resize",  style: { left: -7,   top: "calc(50% - 7px)"  } },
  { id: "r",  cursor: "e-resize",  style: { right: -7,  top: "calc(50% - 7px)"  } },
];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function applyDrag(h: Handle, s: CropBox, dx: number, dy: number): CropBox {
  if (h === "move") {
    return {
      x: clamp(s.x + dx, 0, 1 - s.w),
      y: clamp(s.y + dy, 0, 1 - s.h),
      w: s.w,
      h: s.h,
    };
  }
  let x = s.x, y = s.y, w = s.w, bh = s.h;
  if (h.includes("l")) { const nx = clamp(s.x + dx, 0, s.x + s.w - MIN); w = s.x + s.w - nx; x = nx; }
  if (h.includes("r")) { w = clamp(s.w + dx, MIN, 1 - s.x); }
  if (h.includes("t")) { const ny = clamp(s.y + dy, 0, s.y + s.h - MIN); bh = s.y + s.h - ny; y = ny; }
  if (h.includes("b")) { bh = clamp(s.h + dy, MIN, 1 - s.y); }
  return { x, y, w, h: bh };
}

export function CropOverlay({ box, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; start: CropBox; px: number; py: number } | null>(null);

  function startDrag(handle: Handle, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { handle, start: { ...box }, px: e.clientX, py: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.current.px) / rect.width;
    const dy = (e.clientY - drag.current.py) / rect.height;
    onChange(applyDrag(drag.current.handle, drag.current.start, dx, dy));
  }

  function stopDrag() { drag.current = null; }

  const { x, y, w, h } = box;

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, touchAction: "none", userSelect: "none" }}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      {/* Dark mask outside the crop rect */}
      {maskDiv(0,   0,   1,   y        )}
      {maskDiv(0,   y+h, 1,   1 - y - h)}
      {maskDiv(0,   y,   x,   h        )}
      {maskDiv(x+w, y,   1-x-w, h      )}

      {/* Crop rectangle — interior drag to move */}
      <div
        onPointerDown={(e) => startDrag("move", e)}
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: `${w * 100}%`,
          height: `${h * 100}%`,
          border: "2px solid rgba(255,255,255,0.9)",
          boxSizing: "border-box",
          cursor: "move",
        }}
      >
        {/* Rule-of-thirds guide lines */}
        {[1/3, 2/3].map((t) => (
          <div key={`v${t}`} style={{ position: "absolute", left: `${t*100}%`, top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.25)", pointerEvents: "none" }} />
        ))}
        {[1/3, 2/3].map((t) => (
          <div key={`h${t}`} style={{ position: "absolute", top: `${t*100}%`, left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.25)", pointerEvents: "none" }} />
        ))}

        {HANDLES.map(({ id, cursor, style: hs }) => (
          <div
            key={id}
            onPointerDown={(e) => startDrag(id, e)}
            style={{
              position: "absolute",
              width: 14, height: 14,
              background: "white",
              border: "2px solid rgba(0,0,0,0.35)",
              borderRadius: 2,
              cursor,
              ...hs,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function maskDiv(x: number, y: number, w: number, h: number) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x * 100}%`, top: `${y * 100}%`,
        width: `${w * 100}%`, height: `${h * 100}%`,
        background: "rgba(0,0,0,0.5)",
        pointerEvents: "none",
      }}
    />
  );
}
