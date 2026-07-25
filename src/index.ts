/**
 * three-surface-gizmo — public API
 */

// Core types
export type {
  HandleMode,
  GizmoTransform,
  GizmoPatch,
  GizmoCursorMode,
  GizmoCursorState,
  GizmoEvents,
  MoveEvent,
  RotateEvent,
  ScaleEvent,
} from "./types";
export {
  EMPTY_GIZMO_CURSOR,
  GIZMO_TARGET_PIXEL_RADIUS,
  GIZMO_COLOR,
  GIZMO_COLOR_MOVE,
  RING_RADIUS,
  RING_TUBE_RADIUS,
  ROTATE_SNAP_STEP,
  ROTATE_SNAP_TOLERANCE,
} from "./types";

// Controller
export { GizmoController } from "./controller";
export type { GizmoControllerConfig, GizmoFrameResult, HandleEmphasis } from "./controller";

// Visuals
export { createGizmoVisuals, updateGizmoVisuals } from "./visuals";
export type { GizmoVisuals } from "./visuals";

// Math
export { orientToNormalQ, transportRotation } from "./orientation";
export {
  angleInGizmoLocal,
  snapRotation,
  yawFromRingDrag,
  decalRotationToYaw,
  decalRotationFromRingDrag,
  gizmoDragFrameQInv,
} from "./rotate";
export { computeGizmoCursorState } from "./cursor";

// Native
export { createGizmo } from "./native";
export type { NativeGizmo, NativeGizmoOptions } from "./native";