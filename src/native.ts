/**
 * Native three.js integration for the surface-aligned gizmo.
 *
 * Wires the GizmoController to a real three.js render loop (requestAnimationFrame),
 * creates the visual meshes via GizmoVisuals, and handles DOM pointer events.
 *
 * ## Usage
 * ```ts
 * const gizmo = createGizmo({
 *   scene, camera, renderer,
 *   object: modelObject,
 *   targetMesh: selectedMesh,
 *   position: [0, 0, 0],
 *   normal: [0, 1, 0],
 *   rotation: 0,
 *   scale: 1,
 *   minScale: 0.05,
 *   maxScale: 0.6,
 *   onUpdate: (patch) => { /* update data model *\/ },
 * });
 * // ... later:
 * gizmo.dispose();
 * ```
 */

import {
  Camera,
  Matrix4,
  Mesh,
  Object3D,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GizmoController } from "./controller.js";
import { createGizmoVisuals, updateGizmoVisuals, type GizmoVisuals } from "./visuals.js";
import type { GizmoEvents, GizmoTransform } from "./types.js";
import type { HandleMode } from "./types.js";

// ── Options ─────────────────────────────────────────────────────────

export type NativeGizmoOptions = GizmoTransform & {
  /** The three.js scene (gizmo root is added to it) */
  scene: Scene;
  /** Active camera */
  camera: Camera;
  /** WebGL renderer (used for DOM event canvas) */
  renderer: WebGLRenderer;
  /** Model root object (raycast target for move mode) */
  object: Object3D;
  /** Current binding mesh */
  targetMesh: Mesh;
  /** Minimum uniform scale */
  minScale: number;
  /** Maximum uniform scale */
  maxScale: number;
} & Partial<GizmoEvents>;

// ── Return type ─────────────────────────────────────────────────────

export interface NativeGizmo {
  /** The underlying controller (for advanced use) */
  controller: GizmoController;
  /** The three.js visual meshes root group (already in scene) */
  visuals: GizmoVisuals;
  /** Explicit dispose — stops rAF, removes from scene, disposes geometries */
  dispose(): void;
  /** Manually trigger an update (if not using the built-in rAF loop) */
  update(): void;
}

// ── Factory ─────────────────────────────────────────────────────────

export function createGizmo(options: NativeGizmoOptions): NativeGizmo {
  const {
    scene,
    camera,
    renderer,
    object,
    targetMesh,
    position,
    normal,
    rotation,
    scale,
    minScale,
    maxScale,
    onCursorChange,
    onMoveStart,
    onMove,
    onMoveEnd,
    onRotateStart,
    onRotate,
    onRotateEnd,
    onScaleStart,
    onScale,
    onScaleEnd,
  } = options;

  // Create controller
  const controller = new GizmoController({
    object,
    targetMesh,
    minScale,
    maxScale,
  });
  controller.setEvents({
    onCursorChange, onMoveStart, onMove, onMoveEnd,
    onRotateStart, onRotate, onRotateEnd,
    onScaleStart, onScale, onScaleEnd,
  });
  controller.setCamera(camera);
  controller.setCanvasElement(renderer.domElement);
  controller.setTransform(
    new Vector3(position[0], position[1], position[2]),
    new Vector3(normal[0], normal[1], normal[2]),
    rotation,
    scale,
  );

  // Create visuals
  const visuals = createGizmoVisuals();
  scene.add(visuals.root);

  const parentMatrixHelper = new Matrix4();

  // Pointer event routing: hit-test visuals.hitMeshes on pointer down
  const canvas = renderer.domElement;

  const onPointerDown = (e: PointerEvent) => {
    // Hit-test against visible handle meshes
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Use the controller's raycaster
    controller._setRayFromScreen(e.clientX, e.clientY, rect, camera);

    // Simplification: we use the raycaster from controller to hit-test
    // In practice, hitMeshes raycasting needs to happen here
    // For now we delegate to a simpler approach using intersects below
    void 0;
  };

  // rAF loop
  let rafId = 0;
  let alive = true;

  function tick() {
    if (!alive) return;
    rafId = requestAnimationFrame(tick);

    // Update parent matrix (identity for scene-level root)
    parentMatrixHelper.identity();

    const result = controller.update(camera, {
      width: renderer.domElement.width,
      height: renderer.domElement.height,
    }, parentMatrixHelper);

    // Apply transform to visuals root
    visuals.root.position.copy(result.worldPosition);
    visuals.root.quaternion.copy(result.worldQuaternion);
    visuals.root.scale.copy(result.worldScale);
    visuals.root.visible = result.visible;

    // Apply emphasis
    updateGizmoVisuals(visuals, result.emphasis);
  }

  // Start loop
  rafId = requestAnimationFrame(tick);

  // Pointer down: hit-test and start drag
  const handlePointerDown = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    controller._setRayFromScreen(e.clientX, e.clientY, rect, camera);

    const hits = controller["_raycaster"].intersectObjects(visuals.hitMeshes, false);
    if (hits.length === 0) return;
    const hitObj = hits[0].object as Mesh;
    const mode = hitObj.userData.handleMode as HandleMode | undefined;
    if (!mode) return;
    const cornerIndex = hitObj.userData.cornerIndex as number | undefined;

    canvas.setPointerCapture(e.pointerId);
    controller.handlePointerDown(e, mode, cornerIndex);
  };

  const handlePointerMove = (e: PointerEvent) => {
    controller.handlePointerMove(e);
  };

  const handlePointerUp = (e: PointerEvent) => {
    controller.handlePointerUp(e);
    canvas.releasePointerCapture?.(e.pointerId);
  };

  canvas.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);

  return {
    controller,
    visuals,
    dispose() {
      alive = false;
      if (rafId) cancelAnimationFrame(rafId);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      scene.remove(visuals.root);
      visuals.dispose();
      controller.dispose();
    },
    update() {
      if (!alive) return;
      parentMatrixHelper.identity();
      const result = controller.update(camera, {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
      }, parentMatrixHelper);
      visuals.root.position.copy(result.worldPosition);
      visuals.root.quaternion.copy(result.worldQuaternion);
      visuals.root.scale.copy(result.worldScale);
      visuals.root.visible = result.visible;
      updateGizmoVisuals(visuals, result.emphasis);
    },
  };
}