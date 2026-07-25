/**
 * GizmoCursorOverlay — DOM SVG overlay for gizmo cursor icons.
 *
 * Renders three SVG icons (rotate arc, move cross, scale horizontal arrows)
 * that follow the mouse position and rotate to indicate the gizmo's current
 * orientation. Must be rendered outside the R3F Canvas (in DOM space).
 *
 * ## Usage
 * ```tsx
 * const [cursor, setCursor] = useState(EMPTY_GIZMO_CURSOR);
 * <Gizmo onCursorChange={setCursor} />
 * <GizmoCursorOverlay {...cursor} />
 * ```
 */

"use client";

import type { GizmoCursorMode, GizmoCursorState } from "../cursor";
export type { GizmoCursorMode, GizmoCursorState };

const ICON_CLASS =
  "absolute top-0 left-0 w-[42px] h-[42px] opacity-0 transition-opacity duration-[120ms] ease-out pointer-events-none will-change-[transform,opacity]";
const STROKE_OUTER = {
  stroke: "white",
  strokeWidth: 5,
  vectorEffect: "non-scaling-stroke" as const,
};
const STROKE_INNER = {
  stroke: "#135bec",
  strokeWidth: 2.4,
  vectorEffect: "non-scaling-stroke" as const,
};

function CursorIcon({
  mode,
  active,
  clientX,
  clientY,
  angleDeg,
  isDragging,
}: GizmoCursorState & { mode: GizmoCursorMode }) {
  const visible = active === mode;
  const pop = isDragging ? 1.12 : 1;

  return (
    <svg
      className={ICON_CLASS}
      style={{
        left: clientX,
        top: clientY,
        opacity: visible ? 1 : 0,
        transform: `translate(-50%, -50%) rotate(${angleDeg}deg) scale(${pop})`,
        filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))",
      }}
      viewBox="0 0 42 42"
      fill="none"
      aria-hidden
    >
      {mode === "rotate" && (
        <>
          <path d="M9 17Q21 8 33 17" strokeLinecap="round" {...STROKE_OUTER} />
          <path
            d="M12.4 10.5L9 17L16 15.7M26 15.5L33 17L29.6 10.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...STROKE_OUTER}
          />
          <path d="M9 17Q21 8 33 17" strokeLinecap="round" {...STROKE_INNER} />
          <path
            d="M12.4 10.5L9 17L16 15.7M26 15.5L33 17L29.6 10.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...STROKE_INNER}
          />
        </>
      )}
      {mode === "move" && (
        <>
          <path
            d="M21 5V37M5 21H37M15 11L21 5L27 11M15 31L21 37L27 31M11 15L5 21L11 27M31 15L37 21L31 27"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...STROKE_OUTER}
          />
          <path
            d="M21 5V37M5 21H37M15 11L21 5L27 11M15 31L21 37L27 31M11 15L5 21L11 27M31 15L37 21L31 27"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...STROKE_INNER}
          />
        </>
      )}
      {mode === "scale" && (
        <>
          <path
            d="M6 21H36M13 14L6 21L13 28M29 14L36 21L29 28"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...STROKE_OUTER}
          />
          <path
            d="M6 21H36M13 14L6 21L13 28M29 14L36 21L29 28"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...STROKE_INNER}
          />
        </>
      )}
    </svg>
  );
}

/** Gizmo cursor DOM overlay (rendered outside Canvas, pointer-events: none) */
export function GizmoCursorOverlay(props: GizmoCursorState) {
  return (
    <div className="fixed inset-0 pointer-events-none z-20 overflow-hidden" aria-hidden>
      <CursorIcon {...props} mode="rotate" />
      <CursorIcon {...props} mode="move" />
      <CursorIcon {...props} mode="scale" />
    </div>
  );
}