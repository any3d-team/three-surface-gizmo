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

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from "react";
import type { GizmoCursorMode, GizmoCursorState } from "../cursor.js";
import { EMPTY_GIZMO_CURSOR } from "../cursor.js";
export type { GizmoCursorMode, GizmoCursorState };

const ICON_PX = 42;

const ROOT_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  zIndex: 20,
  overflow: "hidden",
};

const ICON_BASE_STYLE: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: ICON_PX,
  height: ICON_PX,
  opacity: 0,
  transition: "opacity 120ms ease-out",
  pointerEvents: "none",
  willChange: "transform, opacity",
  filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))",
};

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

export interface GizmoCursorOverlayHandle {
  /** Imperative update — avoids React re-render of parent trees (Canvas). */
  setState: (state: GizmoCursorState) => void;
}

function applyIconStyle(
  el: SVGSVGElement | null,
  state: GizmoCursorState,
  mode: GizmoCursorMode,
): void {
  if (!el) return;
  const visible = state.active === mode;
  const pop = state.isDragging ? 1.12 : 1;
  el.style.left = `${state.clientX}px`;
  el.style.top = `${state.clientY}px`;
  el.style.opacity = visible ? "1" : "0";
  el.style.transform = `translate(-50%, -50%) rotate(${state.angleDeg}deg) scale(${pop})`;
}

type IconProps = {
  mode: GizmoCursorMode;
  svgRef: (el: SVGSVGElement | null) => void;
};

function CursorIconSvg({ mode, svgRef }: IconProps) {
  return (
    <svg
      ref={svgRef}
      style={ICON_BASE_STYLE}
      viewBox="0 0 42 42"
      width={ICON_PX}
      height={ICON_PX}
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

/** Gizmo cursor DOM overlay (outside Canvas, pointer-events: none) */
export const GizmoCursorOverlay = forwardRef<
  GizmoCursorOverlayHandle,
  Partial<GizmoCursorState>
>(function GizmoCursorOverlay(props, ref) {
  const rotateRef = useRef<SVGSVGElement | null>(null);
  const moveRef = useRef<SVGSVGElement | null>(null);
  const scaleRef = useRef<SVGSVGElement | null>(null);
  const stateRef = useRef<GizmoCursorState>({ ...EMPTY_GIZMO_CURSOR });

  const paint = useCallback((state: GizmoCursorState) => {
    stateRef.current = state;
    applyIconStyle(rotateRef.current, state, "rotate");
    applyIconStyle(moveRef.current, state, "move");
    applyIconStyle(scaleRef.current, state, "scale");
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setState: paint,
    }),
    [paint],
  );

  // Controlled props path (simple demos / when not using ref)
  useLayoutEffect(() => {
    if (props.active === undefined && props.clientX === undefined) return;
    paint({
      active: props.active ?? null,
      clientX: props.clientX ?? 0,
      clientY: props.clientY ?? 0,
      angleDeg: props.angleDeg ?? 0,
      isDragging: props.isDragging ?? false,
    });
  }, [props.active, props.clientX, props.clientY, props.angleDeg, props.isDragging, paint]);

  return (
    <div style={ROOT_STYLE} aria-hidden>
      <CursorIconSvg mode="rotate" svgRef={(el) => { rotateRef.current = el; }} />
      <CursorIconSvg mode="move" svgRef={(el) => { moveRef.current = el; }} />
      <CursorIconSvg mode="scale" svgRef={(el) => { scaleRef.current = el; }} />
    </div>
  );
});
