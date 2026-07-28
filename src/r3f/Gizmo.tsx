/**
 * R3F surface-aligned transform gizmo.
 *
 * Interaction model (matches the proven pre-extraction implementation):
 * - Capture-phase native pointerdown on the canvas — pick gizmo handles via
 *   raycast against the gizmo subtree only (avoids R3F distance sorting and
 *   depthTest:false occlusion issues).
 * - Hover via window pointermove raycast → visual emphasis + cursor overlay.
 * - Drag updates batched with rAF (onUpdate) to avoid React thrash.
 * - userData.isGizmo / gizmoHandle markers for pick + raycast filtering.
 */

"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { computeGizmoCursorState, EMPTY_GIZMO_CURSOR } from "../cursor.js";
import type { GizmoCursorState } from "../types.js";
import type { GizmoPatch, GizmoTransform, HandleMode } from "../types.js";
import {
  GIZMO_COLOR,
  GIZMO_COLOR_MOVE,
  GIZMO_TARGET_PIXEL_RADIUS,
  RING_RADIUS,
  RING_TUBE_RADIUS,
} from "../types.js";
import {
  absQuaternionFromNormalAndRef,
  extractRefAxesFromAbsQuaternion,
  extractSpinAroundNormal,
  orientToNormalQ,
} from "../orientation.js";
import {
  angleInGizmoLocal,
  decalRotationFromRingDrag,
  decalRotationToYaw,
  gizmoDragFrameQInv,
} from "../rotate.js";

/** Hit-test userData for native raycast pick (bypasses R3F distance sorting) */
interface GizmoHandleData {
  isGizmo: true;
  gizmoHandle: HandleMode;
  gizmoCornerIndex?: number;
}

export type GizmoProps = GizmoTransform & {
  /** Model root (move-mode raycast target; supports cross-mesh move) */
  object: Object3D;
  /** Current binding mesh */
  targetMesh: Mesh;
  /** Minimum uniform scale */
  minScale: number;
  /** Maximum uniform scale */
  maxScale: number;
  /** Drag produces patches; caller updates data model / rebuilds geometry */
  onUpdate: (patch: GizmoPatch) => void;
  /** Drag start/end (caller may switch low/high fidelity rebuild) */
  onInteractChange?: (active: boolean) => void;
  /** Dynamic cursor state (render outside Canvas as DOM) */
  onCursorChange?: (state: GizmoCursorState) => void;
};

interface HoverState {
  mode: HandleMode;
  cornerIndex?: number;
  point?: Vector3;
}

interface DragState {
  mode: HandleMode;
  /** Shared tangent plane for rotate/scale (normal = target normal, through center) */
  plane: Plane;
  centerWorld: Vector3;
  /** Inverse gizmo world quaternion — world dir → gizmo-local atan2 */
  gizmoWorldQInv: Quaternion;
  startAngle: number;
  startDist: number;
  startYaw: number;
  startScale: number;
  /**
   * Move: lock pattern local +X/+Y world directions at pointer-down.
   * Each frame project onto new normal tangent plane → path-independent, no holonomy.
   */
  refXWorld?: Vector3;
  refYWorld?: Vector3;
  absQWorld?: Quaternion;
  lastHitWorld?: Vector3;
  cornerIndex?: number;
  cornerWorld?: Vector3;
}

const SCALE_HANDLE_AXES: Array<[number, number]> = [
  [0, RING_RADIUS],
  [RING_RADIUS, 0],
  [0, -RING_RADIUS],
  [-RING_RADIUS, 0],
];

const _lerpWhite = new Color(0xffffff);
const _lerpBase = new Color();

function lerpColor(base: number, t: number): Color {
  return _lerpBase.setHex(base).lerp(_lerpWhite, t);
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

export function Gizmo({
  position,
  normal,
  rotation,
  scale,
  object,
  targetMesh,
  minScale,
  maxScale,
  onUpdate,
  onInteractChange,
  onCursorChange,
}: GizmoProps) {
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  const rootRef = useRef<Group>(null);
  const baseRingRef = useRef<Mesh>(null);
  const movePuckRef = useRef<Mesh>(null);
  const movePuckRingRef = useRef<Mesh>(null);
  const scaleGroupRefs = useRef<(Group | null)[]>([]);

  // Read/write via refs — avoid mutating hook return values directly
  const controlsRef = useRef(controls);
  const glRef = useRef(gl);
  const cameraRef = useRef(camera);

  const setControlsEnabled = useCallback((enabled: boolean) => {
    const c = controlsRef.current;
    if (c) c.enabled = enabled;
  }, []);

  const [nrmX, nrmY, nrmZ] = normal;

  const localOrientQ = useMemo(() => {
    const [qx, qy, qz, qw] = orientToNormalQ(nrmX, nrmY, nrmZ, rotation);
    return new Quaternion(qx, qy, qz, qw);
  }, [nrmX, nrmY, nrmZ, rotation]);

  const dragRef = useRef<DragState | null>(null);
  const hoverRef = useRef<HoverState | null>(null);
  const raycaster = useRef(new Raycaster());
  const ndc = useRef(new Vector2());
  const rafId = useRef<number | null>(null);
  const pendingPatch = useRef<GizmoPatch | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });
  const centerWorldRef = useRef(new Vector3());

  // Native pointer listeners read latest props via layout-synced refs
  const propsRef = useRef({
    position,
    normal,
    rotation,
    scale,
    object,
    targetMesh,
    minScale,
    maxScale,
    nrmX,
    nrmY,
    nrmZ,
  });
  const onUpdateRef = useRef(onUpdate);
  const onInteractChangeRef = useRef(onInteractChange);
  const onCursorChangeRef = useRef(onCursorChange);

  useLayoutEffect(() => {
    controlsRef.current = controls;
    glRef.current = gl;
    cameraRef.current = camera;
    propsRef.current = {
      position,
      normal,
      rotation,
      scale,
      object,
      targetMesh,
      minScale,
      maxScale,
      nrmX,
      nrmY,
      nrmZ,
    };
    onUpdateRef.current = onUpdate;
    onInteractChangeRef.current = onInteractChange;
    onCursorChangeRef.current = onCursorChange;
  });

  // Mark gizmo subtree; end interaction on unmount
  useEffect(() => {
    const root = rootRef.current;
    if (root) {
      root.traverse((o) => {
        o.userData.isGizmo = true;
      });
    }
    return () => {
      onInteractChangeRef.current?.(false);
      setControlsEnabled(true);
      glRef.current.domElement.style.cursor = "auto";
    };
  }, [setControlsEnabled]);

  const tmp = useMemo(
    () => ({
      localPos: new Vector3(),
      centerWorld: new Vector3(),
      normalWorld: new Vector3(),
      meshWorldQ: new Quaternion(),
      meshWorldQInv: new Quaternion(),
      desiredMat: new Matrix4(),
      q: new Quaternion(),
      absLocalQ: new Quaternion(),
      v1: new Vector3(),
      v2: new Vector3(),
      parentInv: new Matrix4(),
      cornerWorld: new Vector3(),
      nLocal: new Vector3(),
      refX: new Vector3(),
      refY: new Vector3(),
    }),
    [],
  );

  const currentEmphasis = useCallback((mode: HandleMode, cornerIndex?: number): number => {
    const drag = dragRef.current;
    if (drag && drag.mode === mode && drag.cornerIndex === cornerIndex) return 1;
    const hover = hoverRef.current;
    if (!drag && hover && hover.mode === mode && hover.cornerIndex === cornerIndex) return 0.55;
    return 0;
  }, []);

  const refreshHandleVisuals = useCallback(() => {
    const baseRing = baseRingRef.current;
    const movePuck = movePuckRef.current;
    const movePuckRing = movePuckRingRef.current;
    if (baseRing) applyVisual(baseRing, GIZMO_COLOR, 0.42, currentEmphasis("rotate"), 1);
    if (movePuck) applyVisual(movePuck, GIZMO_COLOR_MOVE, 0.96, currentEmphasis("move"), 1.2);
    if (movePuckRing) applyVisual(movePuckRing, GIZMO_COLOR, 0.5, currentEmphasis("move"), 1);
    scaleGroupRefs.current.forEach((g, i) => {
      if (!g) return;
      const gem = g.children[0] as Mesh | undefined;
      if (gem?.isMesh) applyVisual(gem, GIZMO_COLOR, 0.95, currentEmphasis("scale", i), 1.4, g);
    });
  }, [currentEmphasis]);

  const resolveCornerWorld = useCallback(
    (cornerIndex?: number): Vector3 | null => {
      if (cornerIndex == null) return null;
      const g = scaleGroupRefs.current[cornerIndex];
      if (!g) return null;
      return g.getWorldPosition(tmp.cornerWorld);
    },
    [tmp],
  );

  /**
   * Sync cursor overlay to pointer (same as pre-extraction Gizmo).
   * Must update lastPointer immediately — useFrame reuses it for angle refresh.
   * Host should apply via imperative overlay (ref.setState) so Canvas does not re-render.
   */
  const updateCursorVisual = useCallback(
    (clientX: number, clientY: number) => {
      lastPointer.current = { x: clientX, y: clientY };
      const drag = dragRef.current;
      const hover = hoverRef.current;
      const active = drag ? drag.mode : hover ? hover.mode : null;
      const cornerIndex = drag ? drag.cornerIndex : hover?.cornerIndex;

      const canvas = glRef.current.domElement;
      canvas.style.cursor = active ? "none" : "auto";

      const cornerWorld = drag?.cornerWorld ?? resolveCornerWorld(cornerIndex);

      let hoverPoint = hover?.point ?? null;
      if (drag?.mode === "rotate") {
        const rect = canvas.getBoundingClientRect();
        ndc.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        ndc.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.current.setFromCamera(ndc.current, cameraRef.current);
        if (raycaster.current.ray.intersectPlane(drag.plane, tmp.v1)) hoverPoint = tmp.v1;
      }

      const next = computeGizmoCursorState({
        camera: cameraRef.current,
        canvas,
        clientX,
        clientY,
        active,
        isDragging: drag != null,
        centerWorld: centerWorldRef.current,
        gizmoRoot: rootRef.current,
        hoverPoint,
        cornerWorld,
      });
      onCursorChangeRef.current?.(next);
    },
    [resolveCornerWorld, tmp],
  );

  useFrame(() => {
    const root = rootRef.current;
    if (!root) return;
    const parent = root.parent;
    if (!parent) return;

    targetMesh.updateWorldMatrix(true, false);
    tmp.localPos.set(position[0], position[1], position[2]);
    targetMesh.localToWorld(tmp.centerWorld.copy(tmp.localPos));
    centerWorldRef.current.copy(tmp.centerWorld);
    const distance = tmp.centerWorld.distanceTo(camera.position);

    // Screen-constant size: target pixel radius → world radius via canvas height + vFOV
    const vFov = ((camera as PerspectiveCamera).fov ?? 50) * (Math.PI / 180);
    const worldPerPixel = (2 * Math.tan(vFov / 2) * distance) / Math.max(size.height, 1);
    const targetWorldRadius = GIZMO_TARGET_PIXEL_RADIUS * worldPerPixel;

    const targetWorldScale = targetMesh.getWorldScale(tmp.v1).x;
    const gizmoLocalScale = targetWorldRadius / (RING_RADIUS * Math.max(targetWorldScale, 1e-6));
    tmp.desiredMat
      .compose(tmp.localPos, localOrientQ, tmp.v2.setScalar(gizmoLocalScale))
      .premultiply(targetMesh.matrixWorld);

    parent.updateWorldMatrix(true, false);
    tmp.parentInv.copy(parent.matrixWorld).invert();
    tmp.parentInv.multiply(tmp.desiredMat);
    tmp.parentInv.decompose(root.position, root.quaternion, root.scale);

    targetMesh.getWorldQuaternion(tmp.meshWorldQ);
    tmp.normalWorld.set(nrmX, nrmY, nrmZ).applyQuaternion(tmp.meshWorldQ);
    tmp.v2.copy(tmp.centerWorld).sub(camera.position).normalize();
    root.visible = tmp.normalWorld.dot(tmp.v2) < 0;

    refreshHandleVisuals();
    if (hoverRef.current || dragRef.current) {
      updateCursorVisual(lastPointer.current.x, lastPointer.current.y);
    }
  });

  const setRayFromEvent = useCallback((e: PointerEvent) => {
    const canvas = glRef.current.domElement;
    const rect = canvas.getBoundingClientRect();
    ndc.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.current.setFromCamera(ndc.current, cameraRef.current);
  }, []);

  const rayToPlane = useCallback(
    (plane: Plane): Vector3 | null => {
      const hit = raycaster.current.ray.intersectPlane(plane, tmp.v1);
      return hit ? tmp.v1.clone() : null;
    },
    [tmp],
  );

  const scheduleUpdate = useCallback((patch: GizmoPatch) => {
    pendingPatch.current = patch;
    if (rafId.current != null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      const p = pendingPatch.current;
      pendingPatch.current = null;
      if (p) onUpdateRef.current(p);
    });
  }, []);

  const flushSchedule = useCallback(() => {
    if (rafId.current != null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    const p = pendingPatch.current;
    pendingPatch.current = null;
    if (p) onUpdateRef.current(p);
  }, []);

  /** Raycast gizmo subtree only; resolve handle via gizmoHandle userData */
  const pickGizmoHandle = useCallback(
    (e: PointerEvent): { mode: HandleMode; cornerIndex?: number; point: Vector3 } | null => {
      const root = rootRef.current;
      if (!root?.visible) return null;
      setRayFromEvent(e);
      const hits = raycaster.current.intersectObject(root, true);
      for (const hit of hits) {
        let obj: Object3D | null = hit.object;
        while (obj) {
          const data = obj.userData as Partial<GizmoHandleData>;
          if (data.gizmoHandle) {
            return {
              mode: data.gizmoHandle,
              cornerIndex: data.gizmoCornerIndex,
              point: hit.point.clone(),
            };
          }
          obj = obj.parent;
        }
      }
      return null;
    },
    [setRayFromEvent],
  );

  const initDrag = useCallback(
    (mode: HandleMode, downEvent: PointerEvent, cornerIndex?: number) => {
      const p = propsRef.current;
      setRayFromEvent(downEvent);
      p.targetMesh.updateWorldMatrix(true, false);
      p.targetMesh.getWorldQuaternion(tmp.meshWorldQ);
      tmp.normalWorld.set(p.nrmX, p.nrmY, p.nrmZ).applyQuaternion(tmp.meshWorldQ);
      tmp.localPos.set(p.position[0], p.position[1], p.position[2]);
      p.targetMesh.localToWorld(tmp.centerWorld.copy(tmp.localPos));

      const plane = new Plane().setFromNormalAndCoplanarPoint(tmp.normalWorld, tmp.centerWorld);
      const startYaw = decalRotationToYaw(p.rotation);
      const gizmoWorldQInv = gizmoDragFrameQInv(
        tmp.normalWorld.x,
        tmp.normalWorld.y,
        tmp.normalWorld.z,
        startYaw,
      ).clone();
      const startHit = rayToPlane(plane);

      let cornerWorld: Vector3 | undefined;
      if (mode === "scale" && cornerIndex != null) {
        const cw = resolveCornerWorld(cornerIndex);
        if (cw) cornerWorld = cw.clone();
      }

      let absQWorld: Quaternion | undefined;
      let refXWorld: Vector3 | undefined;
      let refYWorld: Vector3 | undefined;
      let lastHitWorld: Vector3 | undefined;
      if (mode === "move") {
        const [qx, qy, qz, qw] = orientToNormalQ(p.nrmX, p.nrmY, p.nrmZ, p.rotation);
        tmp.absLocalQ.set(qx, qy, qz, qw);
        absQWorld = tmp.meshWorldQ.clone().multiply(tmp.absLocalQ);
        extractRefAxesFromAbsQuaternion(absQWorld, tmp.refX, tmp.refY);
        refXWorld = tmp.refX.clone();
        refYWorld = tmp.refY.clone();
        lastHitWorld = tmp.centerWorld.clone();
      }

      dragRef.current = {
        mode,
        plane,
        centerWorld: tmp.centerWorld.clone(),
        gizmoWorldQInv,
        startAngle: startHit
          ? angleInGizmoLocal(startHit, tmp.centerWorld, gizmoWorldQInv, tmp.v2)
          : 0,
        startDist: startHit ? startHit.distanceTo(tmp.centerWorld) : 1,
        startYaw,
        startScale: p.scale,
        absQWorld,
        refXWorld,
        refYWorld,
        lastHitWorld,
        cornerIndex,
        cornerWorld,
      };
    },
    [rayToPlane, resolveCornerWorld, setRayFromEvent, tmp],
  );

  // Capture-phase pick only: depthTest:false visuals sit on top but geometry may
  // be occluded by the model. Avoid R3F global distance sort / events.filter.
  useEffect(() => {
    const dom = glRef.current.domElement;

    const beginDrag = (e: PointerEvent, mode: HandleMode, cornerIndex?: number) => {
      e.preventDefault();
      e.stopPropagation();
      setControlsEnabled(false);
      dom.setPointerCapture?.(e.pointerId);
      initDrag(mode, e, cornerIndex);
      hoverRef.current = { mode, cornerIndex };
      onInteractChangeRef.current?.(true);
      refreshHandleVisuals();
      updateCursorVisual(e.clientX, e.clientY);
    };

    const onPointerDownCapture = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (dragRef.current) return;
      const picked = pickGizmoHandle(e);
      if (!picked) return;
      beginDrag(e, picked.mode, picked.cornerIndex);
    };

    const onPointerMoveHover = (e: PointerEvent) => {
      if (dragRef.current) return;
      const picked = pickGizmoHandle(e);
      if (picked) {
        hoverRef.current = {
          mode: picked.mode,
          cornerIndex: picked.cornerIndex,
          point: picked.mode === "rotate" ? picked.point : undefined,
        };
      } else if (hoverRef.current) {
        hoverRef.current = null;
      }
      refreshHandleVisuals();
      updateCursorVisual(e.clientX, e.clientY);
    };

    const onMove = (e: PointerEvent) => {
      const ds = dragRef.current;
      if (!ds) {
        onPointerMoveHover(e);
        return;
      }
      setRayFromEvent(e);
      updateCursorVisual(e.clientX, e.clientY);
      const p = propsRef.current;

      if (ds.mode === "move") {
        const hits = raycaster.current
          .intersectObject(p.object, true)
          .filter(
            (h) =>
              !h.object.userData.isDecal &&
              !h.object.userData.isGizmo &&
              (h.object as Mesh).isMesh,
          );
        if (hits.length === 0) return;

        // Prefer hit near previous frame to reduce punch-through to the far side
        let hit = hits[0];
        if (ds.lastHitWorld) {
          let best = hit;
          let bestDist = hit.point.distanceTo(ds.lastHitWorld);
          for (let i = 1; i < hits.length; i++) {
            const d = hits[i].point.distanceTo(ds.lastHitWorld);
            if (d < bestDist) {
              best = hits[i];
              bestDist = d;
            }
          }
          hit = best;
        }

        const hitMesh = hit.object as Mesh;
        tmp.v1.copy(hit.point);
        hitMesh.worldToLocal(tmp.v1);
        if (ds.lastHitWorld) ds.lastHitWorld.copy(hit.point);
        else ds.lastHitWorld = hit.point.clone();

        const rawN = hit.normal ?? hit.face?.normal;
        if (!rawN || !ds.absQWorld || !ds.refXWorld || !ds.refYWorld) {
          scheduleUpdate({
            position: [tmp.v1.x, tmp.v1.y, tmp.v1.z],
            targetMesh: hitMesh,
          });
          return;
        }

        tmp.nLocal.copy(rawN).normalize();
        if (hit.face && tmp.nLocal.dot(hit.face.normal) < 0) {
          tmp.nLocal.negate();
        }
        hitMesh.updateWorldMatrix(true, false);
        hitMesh.getWorldQuaternion(tmp.meshWorldQ);
        tmp.normalWorld.copy(tmp.nLocal).applyQuaternion(tmp.meshWorldQ).normalize();

        // Fixed ref axes projected onto new normal plane → path-independent orientation
        const ok = absQuaternionFromNormalAndRef(
          ds.absQWorld,
          tmp.normalWorld.x,
          tmp.normalWorld.y,
          tmp.normalWorld.z,
          ds.refXWorld.x,
          ds.refXWorld.y,
          ds.refXWorld.z,
          ds.refYWorld.x,
          ds.refYWorld.y,
          ds.refYWorld.z,
        );
        if (!ok) {
          scheduleUpdate({
            position: [tmp.v1.x, tmp.v1.y, tmp.v1.z],
            normal: [tmp.nLocal.x, tmp.nLocal.y, tmp.nLocal.z],
            targetMesh: hitMesh,
          });
          return;
        }

        tmp.meshWorldQInv.copy(tmp.meshWorldQ).invert();
        tmp.absLocalQ.copy(tmp.meshWorldQInv).multiply(ds.absQWorld);
        const nextRotation = extractSpinAroundNormal(
          tmp.absLocalQ,
          tmp.nLocal.x,
          tmp.nLocal.y,
          tmp.nLocal.z,
        );

        scheduleUpdate({
          position: [tmp.v1.x, tmp.v1.y, tmp.v1.z],
          normal: [tmp.nLocal.x, tmp.nLocal.y, tmp.nLocal.z],
          rotation: nextRotation,
          targetMesh: hitMesh,
        });
        return;
      }

      const hit = rayToPlane(ds.plane);
      if (!hit) return;

      if (ds.mode === "rotate") {
        const curAngle = angleInGizmoLocal(hit, ds.centerWorld, ds.gizmoWorldQInv, tmp.v2);
        const finalRotation = decalRotationFromRingDrag(
          ds.startYaw,
          ds.startAngle,
          curAngle,
          e.shiftKey,
        );
        scheduleUpdate({ rotation: finalRotation });
      } else {
        if (ds.startDist < 1e-4) return;
        const curDist = hit.distanceTo(ds.centerWorld);
        const next = ds.startScale * (curDist / ds.startDist);
        scheduleUpdate({ scale: Math.max(p.minScale, Math.min(p.maxScale, next)) });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setControlsEnabled(true);
      dom.releasePointerCapture?.(e.pointerId);
      flushSchedule();
      onInteractChangeRef.current?.(false);
      refreshHandleVisuals();
      updateCursorVisual(e.clientX, e.clientY);
    };

    const onLeave = () => {
      if (dragRef.current) return;
      hoverRef.current = null;
      refreshHandleVisuals();
      updateCursorVisual(lastPointer.current.x, lastPointer.current.y);
    };

    // Capture: handle before R3F / OrbitControls so gizmo is always clickable
    dom.addEventListener("pointerdown", onPointerDownCapture, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("pointerleave", onLeave);
    return () => {
      dom.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointerleave", onLeave);
    };
  }, [
    flushSchedule,
    initDrag,
    pickGizmoHandle,
    rayToPlane,
    refreshHandleVisuals,
    scheduleUpdate,
    setControlsEnabled,
    setRayFromEvent,
    tmp,
    updateCursorVisual,
  ]);

  useEffect(() => {
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      setControlsEnabled(true);
      glRef.current.domElement.style.cursor = "auto";
      onCursorChangeRef.current?.(EMPTY_GIZMO_CURSOR);
    };
  }, [setControlsEnabled]);

  const hitMaterialProps = {
    colorWrite: false as const,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  };

  const rotateHandleData = useMemo<GizmoHandleData>(
    () => ({ isGizmo: true, gizmoHandle: "rotate" }),
    [],
  );
  const moveHandleData = useMemo<GizmoHandleData>(
    () => ({ isGizmo: true, gizmoHandle: "move" }),
    [],
  );
  const scaleHandleData = useMemo(
    () =>
      SCALE_HANDLE_AXES.map(
        (_, i): GizmoHandleData => ({
          isGizmo: true,
          gizmoHandle: "scale",
          gizmoCornerIndex: i,
        }),
      ),
    [],
  );

  return (
    <group ref={rootRef} renderOrder={1000} userData={{ isGizmo: true }}>
      {/* Rotate: hit torus (userData only; pointers via native capture raycast) */}
      <mesh userData={rotateHandleData} renderOrder={998}>
        <torusGeometry args={[RING_RADIUS, 0.26, 8, 32]} />
        <meshBasicMaterial {...hitMaterialProps} />
      </mesh>
      <mesh ref={baseRingRef} userData={{ isGizmo: true }} renderOrder={999}>
        <torusGeometry args={[RING_RADIUS, RING_TUBE_RADIUS, 12, 72]} />
        <meshBasicMaterial
          color={GIZMO_COLOR}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.42}
          toneMapped={false}
        />
      </mesh>

      {/* Move: center puck */}
      <mesh userData={moveHandleData} renderOrder={998}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial {...hitMaterialProps} />
      </mesh>
      <mesh
        ref={movePuckRef}
        userData={{ isGizmo: true }}
        rotation={[Math.PI / 2, 0, 0]}
        renderOrder={1001}
      >
        <cylinderGeometry args={[0.3, 0.3, 0.1, 28]} />
        <meshBasicMaterial
          color={GIZMO_COLOR_MOVE}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.96}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={movePuckRingRef} userData={{ isGizmo: true }} renderOrder={1000}>
        <ringGeometry args={[0.32, 0.37, 32]} />
        <meshBasicMaterial
          color={GIZMO_COLOR}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.5}
          toneMapped={false}
        />
      </mesh>

      {/* Scale: four corner diamonds */}
      {SCALE_HANDLE_AXES.map(([x, y], i) => (
        <group
          key={i}
          ref={(el) => {
            scaleGroupRefs.current[i] = el;
          }}
          position={[x, y, 0]}
          userData={{ isGizmo: true }}
        >
          <mesh userData={{ isGizmo: true }} rotation={[0, 0, Math.PI / 4]} renderOrder={1001}>
            <boxGeometry args={[0.26, 0.26, 0.14]} />
            <meshBasicMaterial
              color={GIZMO_COLOR}
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={0.95}
              toneMapped={false}
            />
          </mesh>
          <mesh userData={scaleHandleData[i]} renderOrder={998}>
            <sphereGeometry args={[0.4, 12, 12]} />
            <meshBasicMaterial {...hitMaterialProps} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
