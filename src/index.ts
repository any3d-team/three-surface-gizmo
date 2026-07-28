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
} from "./types.js";
export {
  EMPTY_GIZMO_CURSOR,
  GIZMO_TARGET_PIXEL_RADIUS,
  GIZMO_COLOR,
  GIZMO_COLOR_MOVE,
  RING_RADIUS,
  RING_TUBE_RADIUS,
  ROTATE_SNAP_STEP,
  ROTATE_SNAP_TOLERANCE,
} from "./types.js";

// Controller
export { GizmoController } from "./controller.js";
export type { GizmoControllerConfig, GizmoFrameResult, HandleEmphasis } from "./controller.js";

// Visuals
export { createGizmoVisuals, updateGizmoVisuals } from "./visuals.js";
export type { GizmoVisuals } from "./visuals.js";

// Math
export {
  orientToNormalQ,
  transportRotation,
  extractSpinAroundNormal,
  absQuaternionFromNormalAndRef,
  extractRefAxesFromAbsQuaternion,
} from "./orientation.js";
export {
  angleInGizmoLocal,
  snapRotation,
  yawFromRingDrag,
  decalRotationToYaw,
  decalRotationFromRingDrag,
  gizmoDragFrameQInv,
} from "./rotate.js";
export { computeGizmoCursorState } from "./cursor.js";

// Native
export { createGizmo } from "./native.js";
export type { NativeGizmo, NativeGizmoOptions } from "./native.js";