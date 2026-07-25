/**
 * Core types for the surface-aligned 3D gizmo controller.
 *
 * Pure data types — no three.js runtime dependency in the type definitions.
 * GizmoTransform / GizmoPatch are the contract between the controller and
 * the data model (decoupled from any specific schema like DecalItem).
 */

import type { Mesh } from "three";

/** Gizmo handle interaction mode */
export type HandleMode = "move" | "rotate" | "scale";

/**
 * Gizmo transform state (target mesh local space).
 *
 * - position / normal: the surface point and its normal in the target mesh's
 *   local coordinate system
 * - rotation: spin angle around the normal (radians)
 * - scale: uniform scale (world units, consistent with the model)
 */
export interface GizmoTransform {
  position: [number, number, number];
  normal: [number, number, number];
  rotation: number;
  scale: number;
}

/**
 * Partial transform patch produced by a drag interaction.
 *
 * `targetMesh` is set when the move mode re-projects onto a different mesh
 * (cross-mesh movement). Consumers should update their data model accordingly.
 */
export type GizmoPatch = Partial<GizmoTransform> & { targetMesh?: Mesh };

// ── Granular interaction events ─────────────────────────────────────

/** Move event payload */
export interface MoveEvent {
  position: [number, number, number];
  normal: [number, number, number];
  targetMesh: Mesh;
}

/** Rotate event payload */
export interface RotateEvent {
  rotation: number;
}

/** Scale event payload */
export interface ScaleEvent {
  scale: number;
}

/** Granular gizmo interaction callbacks */
export interface GizmoEvents {
  onMoveStart?: () => void;
  onMove?: (event: MoveEvent) => void;
  onMoveEnd?: () => void;

  onRotateStart?: () => void;
  onRotate?: (event: RotateEvent) => void;
  onRotateEnd?: () => void;

  onScaleStart?: () => void;
  onScale?: (event: ScaleEvent) => void;
  onScaleEnd?: () => void;

  /** Dynamic cursor state */
  onCursorChange?: (state: GizmoCursorState) => void;
}

/** Cursor mode for the DOM overlay icon */
export type GizmoCursorMode = "rotate" | "move" | "scale";

/** State consumed by the DOM cursor overlay SVG */
export interface GizmoCursorState {
  active: GizmoCursorMode | null;
  clientX: number;
  clientY: number;
  angleDeg: number;
  isDragging: boolean;
}

/** Empty / default cursor state (hidden, no mode) */
export const EMPTY_GIZMO_CURSOR: GizmoCursorState = {
  active: null,
  clientX: 0,
  clientY: 0,
  angleDeg: 0,
  isDragging: false,
};

// ── Visual constants ────────────────────────────────────────────────

/** Gizmo target screen pixel radius (outer ring, CSS px) */
export const GIZMO_TARGET_PIXEL_RADIUS = 84;

/** Gizmo primary color (brand blue) */
export const GIZMO_COLOR = 0x135bec;

/** Move puck color (slightly whitened) */
export const GIZMO_COLOR_MOVE = 0xf4f6fb;

/** Ring radius (shared by rotate ring and scale handles) */
export const RING_RADIUS = 1.5;

/** Ring tube radius (visual thickness) */
export const RING_TUBE_RADIUS = 0.065;

/** Rotation snap step (90°) */
export const ROTATE_SNAP_STEP = Math.PI / 2;

/** Rotation snap tolerance (7.5°) */
export const ROTATE_SNAP_TOLERANCE = Math.PI / 24;