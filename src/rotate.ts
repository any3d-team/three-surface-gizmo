/**
 * Ring-drag rotation logic for the surface-aligned gizmo.
 *
 * Conventions (mirroring the original gizmo-redesign-demo):
 * - Storage: state.yaw (≈ mesh.rotation.y)
 * - Gizmo display: orientToNormalQ(normal, -yaw)
 * - Drag frame: orientToNormalQ(normal, +yaw) — sign opposite to display, frozen during drag
 * - Update: yaw = startYaw - delta → snap unless Shift key held
 *
 * Decal rotation = orientToNormalQ spin parameter = demo's -yaw (same as display).
 * Therefore startYaw = -rotation, and after update rotation = -yaw.
 */

import { Quaternion, Vector3 } from "three";
import { orientToNormalQ } from "./orientation";

export const ROTATE_SNAP_STEP = Math.PI / 2;
export const ROTATE_SNAP_TOLERANCE = Math.PI / 24;

/** Decal rotation → demo state.yaw (rotation = -yaw) */
export function decalRotationToYaw(rotation: number): number {
  return -rotation;
}

/**
 * Compute the signed angle around +Z (normal) in gizmo-local space from
 * a world-space hit point.
 */
export function angleInGizmoLocal(
  hitWorld: Vector3,
  centerWorld: Vector3,
  gizmoWorldQInv: Quaternion,
  dir = new Vector3(),
): number {
  dir.copy(hitWorld).sub(centerWorld).normalize();
  dir.applyQuaternion(gizmoWorldQInv);
  return Math.atan2(dir.y, dir.x);
}

/** Snap a rotation angle to the nearest 90° multiple within tolerance */
export function snapRotation(rad: number): number {
  const snapped = Math.round(rad / ROTATE_SNAP_STEP) * ROTATE_SNAP_STEP;
  return Math.abs(rad - snapped) <= ROTATE_SNAP_TOLERANCE ? snapped : rad;
}

/**
 * Compute the inverse gizmo drag-frame quaternion for a given world normal
 * and start yaw. Used to transform world-space directions into gizmo-local
 * space for angle calculation.
 */
export function gizmoDragFrameQInv(
  worldNx: number,
  worldNy: number,
  worldNz: number,
  startYaw: number,
  out = new Quaternion(),
): Quaternion {
  const [qx, qy, qz, qw] = orientToNormalQ(worldNx, worldNy, worldNz, startYaw);
  return out.set(qx, qy, qz, qw).invert();
}

/**
 * Compute new yaw from ring drag. raw = startYaw - delta.
 * Snaps to 90° unless Shift key is held.
 * @returns new demo state.yaw
 */
export function yawFromRingDrag(
  startYaw: number,
  startAngle: number,
  curAngle: number,
  shiftKey: boolean,
): number {
  let delta = curAngle - startAngle;
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  const raw = startYaw - delta;
  return shiftKey ? raw : snapRotation(raw);
}

/** Ring drag result mapped to decal rotation (rotation = -yaw) */
export function decalRotationFromRingDrag(
  startYaw: number,
  startAngle: number,
  curAngle: number,
  shiftKey: boolean,
): number {
  return -yawFromRingDrag(startYaw, startAngle, curAngle, shiftKey);
}