/**
 * Normal-aligned orientation quaternion (+Z to normal, spin around normal).
 *
 * Shared by the gizmo (handle orientation) and decal geometry construction —
 * guarantees controller orientation and geometry orientation stay consistent.
 */

import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

/** Reusable temporaries (module-level singletons, JS single-thread safe) */
const _orientObj = new Object3D();
const _orientNormal = new Vector3();
const _UP_Y = new Vector3(0, 1, 0);
const _UP_Z = new Vector3(0, 0, 1);

/** Temporaries for spin extraction / reference-axis projection */
const _tBaseNew = new Quaternion();
const _tLocal = new Quaternion();
const _tOldQ = new Quaternion();
const _tN1 = new Vector3();
const _tN2 = new Vector3();
const _tX = new Vector3();
const _tY = new Vector3();
const _tZ = new Vector3();
const _tRef = new Vector3();
const _tMat = new Matrix4();

/**
 * Compute an orientation quaternion that aligns +Z with the given normal
 * and applies a spin around that normal.
 *
 * Implementation: lookAt(normal) + rotateZ(π) + rotateY(π) + rotateZ(rotation).
 * When the normal is close to ±Y (parallel to default up=(0,1,0)), the up
 * vector is switched to +Z to avoid lookAt degeneracy.
 *
 * Axis convention (do not change lightly — locked with decals/Gizmo):
 * after lookAt + rotateZ(π)+rotateY(π), **+Z ≈ -normal**.
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
 * Extract spin around normal relative to the orientToNormalQ(N, 0) base frame.
 * Assumes absQ ≈ orientToNormalQ(N, r) under the same axis convention.
 */
export function extractSpinAroundNormal(
  absQ: Quaternion,
  nx: number,
  ny: number,
  nz: number,
): number {
  const [bx, by, bz, bw] = orientToNormalQ(nx, ny, nz, 0);
  _tBaseNew.set(bx, by, bz, bw);
  _tLocal.copy(_tBaseNew).invert().multiply(absQ);
  return 2 * Math.atan2(_tLocal.z, _tLocal.w);
}

/**
 * Rebuild absolute orientation from a fixed reference tangent + new normal
 * (path-independent, no holonomy drift).
 *
 * On move drag: lock local +X world direction (refX) at pointer-down, then each
 * frame project refX onto the new normal's tangent plane and rebuild an
 * orthonormal frame. Same normal → same spin; no lookAt(up) twist.
 *
 * Axis convention matches orientToNormalQ: world +Z ≈ -normal.
 * If refX is near-parallel to the normal, fall back to refY; if still degenerate,
 * return false (caller keeps previous frame).
 *
 * @returns whether outQ was written successfully
 */
export function absQuaternionFromNormalAndRef(
  outQ: Quaternion,
  normalX: number,
  normalY: number,
  normalZ: number,
  refXx: number,
  refXy: number,
  refXz: number,
  refYx: number,
  refYy: number,
  refYz: number,
): boolean {
  _tN1.set(normalX, normalY, normalZ).normalize();
  // +Z ≈ -normal (same as orientToNormalQ)
  _tZ.copy(_tN1).negate();

  const tryProject = (rx: number, ry: number, rz: number): boolean => {
    _tRef.set(rx, ry, rz);
    // Project onto tangent plane: t = ref - n (ref·n)
    _tX.copy(_tRef).addScaledVector(_tN1, -_tRef.dot(_tN1));
    if (_tX.lengthSq() < 1e-12) return false;
    _tX.normalize();
    return true;
  };

  if (!tryProject(refXx, refXy, refXz) && !tryProject(refYx, refYy, refYz)) {
    return false;
  }

  // Right-handed: Y = Z × X, then re-orthogonalize X = Y × Z
  _tY.crossVectors(_tZ, _tX).normalize();
  _tX.crossVectors(_tY, _tZ).normalize();
  _tMat.makeBasis(_tX, _tY, _tZ);
  outQ.setFromRotationMatrix(_tMat);
  return true;
}

/** Extract world-space local +X / +Y from an absolute orientation (drag ref axes). */
export function extractRefAxesFromAbsQuaternion(
  absQ: Quaternion,
  outX: Vector3,
  outY: Vector3,
): void {
  outX.set(1, 0, 0).applyQuaternion(absQ);
  outY.set(0, 1, 0).applyQuaternion(absQ);
}

/**
 * Parallel transport (shortest stepwise rotation). Accumulates holonomy on
 * curved surfaces — prefer absQuaternionFromNormalAndRef for surface move.
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
  const [ox, oy, oz, ow] = orientToNormalQ(oldNx, oldNy, oldNz, oldR);
  _tOldQ.set(ox, oy, oz, ow);
  _tN1.set(oldNx, oldNy, oldNz).normalize();
  _tN2.set(newNx, newNy, newNz).normalize();
  if (_tN1.dot(_tN2) <= 0.999999) {
    _tLocal.setFromUnitVectors(_tN1, _tN2);
    _tOldQ.premultiply(_tLocal);
  }
  return extractSpinAroundNormal(_tOldQ, newNx, newNy, newNz);
}
