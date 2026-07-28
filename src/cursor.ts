/**
 * Gizmo dynamic cursor: world-space coordinates → screen angle.
 *
 * Pure computation — no React dependency. Called from both the R3F gizmo
 * (pointer / useFrame) and the native integration.
 */

import type { Camera, Object3D, Vector3 } from "three";
import { Quaternion, Vector3 as V3 } from "three";
import type { GizmoCursorMode, GizmoCursorState } from "./types.js";
export type { GizmoCursorMode, GizmoCursorState };
export { EMPTY_GIZMO_CURSOR } from "./types.js";

export interface ComputeGizmoCursorInput {
  camera: Camera;
  canvas: HTMLCanvasElement;
  clientX: number;
  clientY: number;
  active: GizmoCursorMode | null;
  isDragging: boolean;
  centerWorld: Vector3;
  gizmoRoot: Object3D | null;
  /** World-space hit point on the ring (rotate hover/drag) */
  hoverPoint: Vector3 | null;
  /** World-space corner position (scale) */
  cornerWorld: Vector3 | null;
}

const _tmpA = new V3();
const _tmpB = new V3();
const _tmpQ = new Quaternion();

function worldToScreen(
  v: Vector3,
  camera: Camera,
  width: number,
  height: number,
): { x: number; y: number } {
  _tmpA.copy(v).project(camera);
  return {
    x: ((_tmpA.x + 1) / 2) * width,
    y: ((1 - _tmpA.y) / 2) * height,
  };
}

function screenAngleDeg(
  aWorld: Vector3,
  bWorld: Vector3,
  camera: Camera,
  width: number,
  height: number,
): number {
  const a = worldToScreen(aWorld, camera, width, height);
  const b = worldToScreen(bWorld, camera, width, height);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/**
 * Compute the cursor overlay state based on the current hover/drag semantics.
 */
export function computeGizmoCursorState(input: ComputeGizmoCursorInput): GizmoCursorState {
  const { active, clientX, clientY, isDragging, centerWorld, gizmoRoot, hoverPoint, cornerWorld } =
    input;

  if (!active) {
    return { active: null, clientX, clientY, angleDeg: 0, isDragging: false };
  }

  const rect = input.canvas.getBoundingClientRect();
  let angle = 0;

  if (active === "rotate") {
    const ref = hoverPoint ?? centerWorld;
    angle = screenAngleDeg(centerWorld, ref, input.camera, rect.width, rect.height) + 90;
  } else if (active === "scale" && cornerWorld) {
    angle = screenAngleDeg(centerWorld, cornerWorld, input.camera, rect.width, rect.height);
  } else if (active === "move" && gizmoRoot) {
    gizmoRoot.getWorldQuaternion(_tmpQ);
    _tmpB.set(1, 0, 0).applyQuaternion(_tmpQ).add(centerWorld);
    angle = screenAngleDeg(centerWorld, _tmpB, input.camera, rect.width, rect.height);
  }

  return { active, clientX, clientY, angleDeg: angle, isDragging };
}