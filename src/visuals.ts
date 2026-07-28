/**
 * GizmoVisuals — imperative three.js factory functions for the three handle meshes.
 *
 * Creates the visual representation of the gizmo (rotate ring, move puck, scale
 * diamonds) using plain three.js constructors. Used by the native integration;
 * the R3F integration may also use these or render JSX instead.
 */

import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { RING_RADIUS, RING_TUBE_RADIUS, GIZMO_COLOR, GIZMO_COLOR_MOVE } from "./types.js";

// ── Emphasized visual state ─────────────────────────────────────────

export interface HandleEmphasis {
  rotate: number;
  move: number;
  scale: number[];
}

// ── Color helpers ───────────────────────────────────────────────────

const _lerpWhite = new Color(0xffffff);
const _lerpBase = new Color();

function lerpColor(base: number, t: number): Color {
  return _lerpBase.setHex(base).lerp(_lerpWhite, t);
}

// ── Visuals container ───────────────────────────────────────────────

export interface GizmoVisuals {
  root: Group;
  /** Rotate ring (visible) */
  baseRing: Mesh;
  /** Rotate ring hit-test (invisible, expanded) */
  rotateHit: Mesh;
  /** Move puck (visible cylinder) */
  movePuck: Mesh;
  /** Move puck ring (visible ring around puck) */
  movePuckRing: Mesh;
  /** Move hit-test (invisible sphere) */
  moveHit: Mesh;
  /** Scale handle groups [4] — each contains a visual diamond + hit sphere */
  scaleGroups: Group[];
  /** Scale hit-test spheres [4] */
  scaleHits: Mesh[];
  /** Scale visual diamonds [4] */
  scaleGems: Mesh[];
  /** All hit-test meshes for pointer event routing */
  hitMeshes: Mesh[];
  /** Dispose all geometries and materials */
  dispose(): void;
}

// ── Hit material props (invisible, but intercepts events) ───────────

const HIT_MATERIAL_PROPS = {
  colorWrite: false as const,
  depthWrite: false,
  depthTest: false,
  toneMapped: false,
};

// ── Scale handle layout ─────────────────────────────────────────────

const SCALE_HANDLE_AXES: Array<[number, number]> = [
  [0, RING_RADIUS],
  [RING_RADIUS, 0],
  [0, -RING_RADIUS],
  [-RING_RADIUS, 0],
];

// ── Factory ─────────────────────────────────────────────────────────

export function createGizmoVisuals(): GizmoVisuals {
  const root = new Group();
  root.renderOrder = 1000;

  // ── Rotate ring ──
  // Hit test (invisible, coarse torus for easier clicking)
  const rotateHit = new Mesh(
    new TorusGeometry(RING_RADIUS, 0.26, 8, 32),
    new MeshBasicMaterial(HIT_MATERIAL_PROPS),
  );
  rotateHit.renderOrder = 998;
  rotateHit.userData.isGizmo = true;
  rotateHit.userData.handleMode = "rotate";
  root.add(rotateHit);

  // Visible ring
  const baseRing = new Mesh(
    new TorusGeometry(RING_RADIUS, RING_TUBE_RADIUS, 12, 72),
    new MeshBasicMaterial({
      color: GIZMO_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.42,
      toneMapped: false,
    }),
  );
  baseRing.renderOrder = 999;
  baseRing.userData.isGizmo = true;
  root.add(baseRing);

  // ── Move puck ──
  // Hit test (invisible sphere)
  const moveHit = new Mesh(
    new SphereGeometry(0.5, 16, 16),
    new MeshBasicMaterial(HIT_MATERIAL_PROPS),
  );
  moveHit.renderOrder = 998;
  moveHit.userData.isGizmo = true;
  moveHit.userData.handleMode = "move";
  root.add(moveHit);

  // Visible cylinder (puck)
  const movePuck = new Mesh(
    new CylinderGeometry(0.3, 0.3, 0.1, 28),
    new MeshBasicMaterial({
      color: GIZMO_COLOR_MOVE,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.96,
      toneMapped: false,
    }),
  );
  movePuck.rotation.x = Math.PI / 2;
  movePuck.renderOrder = 1001;
  movePuck.userData.isGizmo = true;
  root.add(movePuck);

  // Visible ring around puck
  const movePuckRing = new Mesh(
    new RingGeometry(0.32, 0.37, 32),
    new MeshBasicMaterial({
      color: GIZMO_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.5,
      toneMapped: false,
    }),
  );
  movePuckRing.renderOrder = 1000;
  movePuckRing.userData.isGizmo = true;
  root.add(movePuckRing);

  // ── Scale handles ──
  const scaleGroups: Group[] = [];
  const scaleHits: Mesh[] = [];
  const scaleGems: Mesh[] = [];

  for (const [x, y] of SCALE_HANDLE_AXES) {
    const group = new Group();
    group.position.set(x, y, 0);
    group.userData.isGizmo = true;

    // Visual diamond (rotated box)
    const gem = new Mesh(
      new BoxGeometry(0.26, 0.26, 0.14),
      new MeshBasicMaterial({
        color: GIZMO_COLOR,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
        toneMapped: false,
      }),
    );
    gem.rotation.z = Math.PI / 4;
    gem.renderOrder = 1001;
    gem.userData.isGizmo = true;
    group.add(gem);
    scaleGems.push(gem);

    // Hit test (invisible sphere)
    const hit = new Mesh(
      new SphereGeometry(0.4, 12, 12),
      new MeshBasicMaterial(HIT_MATERIAL_PROPS),
    );
    hit.renderOrder = 998;
    hit.userData.isGizmo = true;
    hit.userData.handleMode = "scale";
    hit.userData.cornerIndex = scaleGroups.length;
    group.add(hit);
    scaleHits.push(hit);

    root.add(group);
    scaleGroups.push(group);
  }

  const allHitMeshes = [rotateHit, moveHit, ...scaleHits];

  return {
    root,
    baseRing,
    rotateHit,
    movePuck,
    movePuckRing,
    moveHit,
    scaleGroups,
    scaleHits,
    scaleGems,
    hitMeshes: allHitMeshes,
    dispose() {
      root.traverse((child) => {
        const m = child as Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material?.dispose();
        }
      });
    },
  };
}

// ── Visual update ───────────────────────────────────────────────────

/**
 * Apply emphasis (hover/drag state) to the visual meshes.
 * Call this each frame after controller.update().
 */
export function updateGizmoVisuals(
  visuals: GizmoVisuals,
  emphasis: HandleEmphasis,
): void {
  applyVisual(visuals.baseRing, GIZMO_COLOR, 0.42, emphasis.rotate, 1);
  applyVisual(visuals.movePuck, GIZMO_COLOR_MOVE, 0.96, emphasis.move, 1.2);
  applyVisual(visuals.movePuckRing, GIZMO_COLOR, 0.5, emphasis.move, 1);
  for (let i = 0; i < visuals.scaleGems.length; i++) {
    const gem = visuals.scaleGems[i];
    const group = visuals.scaleGroups[i];
    const e = emphasis.scale[i] ?? 0;
    applyVisual(gem, GIZMO_COLOR, 0.95, e, 1.4, group);
  }
}

function applyVisual(
  mesh: Mesh,
  baseColor: number,
  baseOpacity: number,
  t: number,
  popScale: number,
  parentForScale?: Object3D,
): void {
  const mat = mesh.material as MeshBasicMaterial;
  mat.color.copy(lerpColor(baseColor, t * 0.6));
  mat.opacity = t >= 1 ? 1 : Math.min(1, baseOpacity + t * 0.15);
  (parentForScale ?? mesh).scale.setScalar(1 + t * (popScale - 1));
}