/**
 * Normal-aligned orientation quaternion (+Z to normal, spin around normal).
 *
 * Shared by the gizmo controller (handle orientation) and decal geometry
 * construction — guarantees the controller orientation and the geometry
 * orientation are consistent.
 */

import { Object3D, Quaternion, Vector3 } from "three";

/** Reusable temporaries (module-level singletons, JS single-thread safe) */
const _orientObj = new Object3D();
const _orientNormal = new Vector3();
const _UP_Y = new Vector3(0, 1, 0);
const _UP_Z = new Vector3(0, 0, 1);

const _tN1 = new Vector3();
const _tN2 = new Vector3();
const _tOldQ = new Quaternion();
const _tBaseNew = new Quaternion();
const _tTransport = new Quaternion();
const _tLocal = new Quaternion();

/**
 * Compute an orientation quaternion that aligns +Z with the given normal
 * and applies a spin around that normal.
 *
 * Implementation: lookAt(normal) + rotateZ(π) + rotateY(π) + rotateZ(rotation).
 * When the normal is close to ±Y (parallel to default up=(0,1,0)), the up
 * vector is switched to +Z to avoid lookAt degeneracy (cross product of
 * up×z being zero → NaN orientation).
 *
 * @returns quaternion [x, y, z, w]
 */
export function orientToNormalQ(
  nx: number,
  ny: number,
  nz: number,
  rotation: number,
): [number, number, number, number] {
  _orientNormal.set(nx, ny, nz);
  _orientObj.up.copy(Math.abs(ny) > 0.99 ? _UP_Z : _UP_Y);
  _orientObj.position.set(0, 0, 0);
  _orientObj.lookAt(_orientNormal);
  _orientObj.rotateZ(Math.PI);
  _orientObj.rotateY(Math.PI);
  if (rotation) _orientObj.rotateZ(rotation);
  const q = _orientObj.quaternion;
  return [q.x, q.y, q.z, q.w];
}

/**
 * Parallel transport: when a decal moves from an old normal to a new one,
 * compute the new spin angle that keeps the pattern's world orientation
 * continuous. This prevents the "spin jump" that occurs when the orientToNormalQ
 * lookAt reference (fixed world up) changes with the normal.
 *
 * Formula:
 *   orientToNormalQ(newN, newR) = qTransport · orientToNormalQ(oldN, oldR)
 *
 * where qTransport is the shortest rotation from oldN to newN.
 *
 * Both normals must be in the same coordinate space (both mesh-local or both
 * world). Degenerate case: oldN ≈ -newN — setFromUnitVectors picks an arbitrary
 * orthogonal axis, but such sharp-edge transitions are usually discarded by
 * the caller's backface threshold.
 *
 * @returns compensated spin angle (radians)
 */
export function transportRotation(
  oldNx: number,
  oldNy: number,
  oldNz: number,
  oldR: number,
  newNx: number,
  newNy: number,
  newNz: number,
): number {
  _tN1.set(oldNx, oldNy, oldNz).normalize();
  _tN2.set(newNx, newNy, newNz).normalize();

  // Old absolute orientation
  const [ox, oy, oz, ow] = orientToNormalQ(_tN1.x, _tN1.y, _tN1.z, oldR);
  _tOldQ.set(ox, oy, oz, ow);

  // New normal base frame (spin = 0) as reference for extracting newR
  const [bx, by, bz, bw] = orientToNormalQ(_tN2.x, _tN2.y, _tN2.z, 0);
  _tBaseNew.set(bx, by, bz, bw);

  // qTransport: shortest rotation from oldN → newN; right-multiply old frame
  _tTransport.setFromUnitVectors(_tN1, _tN2).multiply(_tOldQ);

  // Extract spin in the new normal base frame: baseNew⁻¹ · desired ≈ pure Z rotation
  _tLocal.copy(_tBaseNew).invert().multiply(_tTransport);

  // Z-rotation quaternion has form (0, 0, sin θ/2, cos θ/2) → θ = 2·atan2(z, w)
  return 2 * Math.atan2(_tLocal.z, _tLocal.w);
}