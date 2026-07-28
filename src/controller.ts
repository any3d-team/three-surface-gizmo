/**
 * GizmoController — core state machine for the surface-aligned transform gizmo.
 *
 * Encapsulates ALL interactive logic (drag/hover state, raycasting, plane math,
 * emphasis computation) with zero coupling to any rendering framework.
 *
 * The rendering layer is responsible for:
 * 1. Creating the visual meshes (via GizmoVisuals or JSX)
 * 2. Calling `update()` each frame and applying the returned transform
 * 3. Calling `handlePointerDown/Move/Up` with raw PointerEvent from the DOM
 * 4. Rendering the cursor overlay based on the returned cursor state
 *
 * ## Lifecycle
 * ```
 * const ctrl = new GizmoController(config)
 * ctrl.setEvents({ onMove: (e) => ..., onRotate: (e) => ... })
 * // each frame:
 * const result = ctrl.update(camera, size, parent.matrixWorld)
 * // on events:
 * ctrl.handlePointerDown(event, "rotate")
 * ctrl.handlePointerMove(event)
 * ctrl.handlePointerUp(event)
 * // cleanup:
 * ctrl.dispose()
 * ```
 */

import {
  Color,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import type { Camera } from "three";
import type { GizmoCursorState, GizmoEvents, HandleMode } from "./types.js";
import { RING_RADIUS } from "./types.js";
import { computeGizmoCursorState, EMPTY_GIZMO_CURSOR } from "./cursor.js";
import {
  angleInGizmoLocal,
  decalRotationFromRingDrag,
  decalRotationToYaw,
  gizmoDragFrameQInv,
} from "./rotate.js";
import {
  absQuaternionFromNormalAndRef,
  extractRefAxesFromAbsQuaternion,
  extractSpinAroundNormal,
  orientToNormalQ,
} from "./orientation.js";

// ── Constants ───────────────────────────────────────────────────────

const GIZMO_TARGET_PIXEL_RADIUS = 84;

// ── Internal types ──────────────────────────────────────────────────

interface HoverState {
  mode: HandleMode;
  cornerIndex?: number;
  point?: Vector3;
}

interface DragState {
  mode: HandleMode;
  plane: Plane;
  centerWorld: Vector3;
  gizmoWorldQInv: Quaternion;
  startAngle: number;
  startDist: number;
  startYaw: number;
  startRotation: number;
  startScale: number;
  curNormal: Vector3;
  curRotation: number;
  /** Move: fixed pattern axes + abs orientation (path-independent) */
  refXWorld?: Vector3;
  refYWorld?: Vector3;
  absQWorld?: Quaternion;
  lastHitWorld?: Vector3;
  cornerIndex?: number;
  cornerWorld?: Vector3;
}

// ── Scale handle layout ─────────────────────────────────────────────

const SCALE_HANDLE_AXES: Array<[number, number]> = [
  [0, RING_RADIUS],
  [RING_RADIUS, 0],
  [0, -RING_RADIUS],
  [-RING_RADIUS, 0],
];

// ── Emphasized visual state ─────────────────────────────────────────

export interface HandleEmphasis {
  rotate: number;
  move: number;
  scale: number[];
}

// ── Frame update result ─────────────────────────────────────────────

export interface GizmoFrameResult {
  /**
   * Position for the gizmo root group (parent-local space).
   * Field names keep the historical `world*` prefix for API stability.
   */
  worldPosition: Vector3;
  /** Quaternion for the gizmo root group (parent-local space) */
  worldQuaternion: Quaternion;
  /** Scale for the gizmo root group (parent-local space; screen-constant sizing) */
  worldScale: Vector3;
  /** Whether the gizmo is visible (faces camera) */
  visible: boolean;
  /** Emphasis values for each handle (0 = idle, 0.55 = hover, 1 = active/drag) */
  emphasis: HandleEmphasis;
  /** Cursor overlay state */
  cursorState: GizmoCursorState;
}

// ── Controller config ───────────────────────────────────────────────

export interface GizmoControllerConfig {
  object: Object3D;
  targetMesh: Mesh;
  minScale: number;
  maxScale: number;
}

// ── Controller ──────────────────────────────────────────────────────

export class GizmoController {
  // ── Config (mutable via setters) ──
  private _object: Object3D;
  private _targetMesh: Mesh;
  private _minScale: number;
  private _maxScale: number;
  private _events: GizmoEvents = {};

  // ── Transform state (target mesh local space) ──
  private _position = new Vector3();
  private _normal = new Vector3();
  private _rotation = 0;
  private _scale = 1;

  // ── Drag / hover state ──
  private _dragState: DragState | null = null;
  private _hoverState: HoverState | null = null;

  // ── Raycasting ──
  private _raycaster = new Raycaster();
  private _ndc = new Vector2();
  private _camera: Camera | null = null;
  private _canvasEl: HTMLElement | null = null;

  // ── Cursor tracking ──
  private _lastPointer = { x: 0, y: 0 };
  private _centerWorld = new Vector3();

  // ── Reusable temporaries ──
  private _tmp = {
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
    /** View direction for backface culling — must not alias scale (v2) */
    viewDir: new Vector3(),
    parentInv: new Matrix4(),
    cornerWorld: new Vector3(),
    nLocal: new Vector3(),
    refX: new Vector3(),
    refY: new Vector3(),
  };

  constructor(config: GizmoControllerConfig) {
    this._object = config.object;
    this._targetMesh = config.targetMesh;
    this._minScale = config.minScale;
    this._maxScale = config.maxScale;
  }

  /** Set interaction events (onMove, onRotate, onScale, onCursorChange, etc.) */
  setEvents(events: GizmoEvents): void {
    this._events = events;
  }

  // ── Public setters (for reactive updates) ──

  setObject(object: Object3D): void {
    this._object = object;
  }

  setTargetMesh(mesh: Mesh): void {
    this._targetMesh = mesh;
  }

  setMinMaxScale(min: number, max: number): void {
    this._minScale = min;
    this._maxScale = max;
  }

  setTransform(position: Vector3, normal: Vector3, rotation: number, scale: number): void {
    this._position.copy(position);
    this._normal.copy(normal);
    this._rotation = rotation;
    this._scale = scale;
  }

  setCamera(camera: Camera): void {
    this._camera = camera;
  }

  setCanvasElement(el: HTMLElement): void {
    this._canvasEl = el;
  }

  // ── State queries ──

  get isDragging(): boolean {
    return this._dragState != null;
  }

  get dragMode(): HandleMode | null {
    return this._dragState?.mode ?? null;
  }

  get hoverMode(): HandleMode | null {
    return this._hoverState?.mode ?? null;
  }

  get centerWorld(): Vector3 {
    return this._centerWorld;
  }

  // ── Emphasis computation ──

  private _currentEmphasis(mode: HandleMode, cornerIndex?: number): number {
    const ds = this._dragState;
    if (ds && ds.mode === mode && ds.cornerIndex === cornerIndex) return 1;
    const hs = this._hoverState;
    if (!ds && hs && hs.mode === mode && hs.cornerIndex === cornerIndex) return 0.55;
    return 0;
  }

  get emphasis(): HandleEmphasis {
    return {
      rotate: this._currentEmphasis("rotate"),
      move: this._currentEmphasis("move"),
      scale: SCALE_HANDLE_AXES.map((_, i) => this._currentEmphasis("scale", i)),
    };
  }

  // ── Per-frame update ──

  /**
   * Per-frame update: compute gizmo transform in the parent object's local space.
   *
   * @param parentMatrix - Parent object's `matrixWorld` (not the inverse).
   *   Pass identity when the gizmo root is a direct child of the scene.
   * @returns Position / quaternion / scale for the gizmo root group (parent-local),
   *   plus visibility, handle emphasis, and cursor state.
   */
  update(
    camera: Camera,
    size: { width: number; height: number },
    parentMatrix: Matrix4,
  ): GizmoFrameResult {
    const t = this._tmp;

    // Compute world position from local position + targetMesh world matrix
    this._targetMesh.updateWorldMatrix(true, false);
    t.localPos.copy(this._position);
    this._targetMesh.localToWorld(t.centerWorld.copy(t.localPos));
    this._centerWorld.copy(t.centerWorld);

    // Compute pixel-radius → world-scale (screen-constant size)
    const distance = t.centerWorld.distanceTo(camera.position);
    const vFov = ((camera as PerspectiveCamera).fov ?? 50) * (Math.PI / 180);
    const worldPerPixel = (2 * Math.tan(vFov / 2) * distance) / Math.max(size.height, 1);
    const targetWorldRadius = GIZMO_TARGET_PIXEL_RADIUS * worldPerPixel;

    const targetWorldScale = this._targetMesh.getWorldScale(t.v1).x;
    const gizmoLocalScale = targetWorldRadius / (RING_RADIUS * Math.max(targetWorldScale, 1e-6));

    // Build gizmo world matrix
    const [qx, qy, qz, qw] = orientToNormalQ(
      this._normal.x,
      this._normal.y,
      this._normal.z,
      this._rotation,
    );
    t.q.set(qx, qy, qz, qw);
    t.desiredMat
      .compose(t.localPos, t.q, t.v2.setScalar(gizmoLocalScale))
      .premultiply(this._targetMesh.matrixWorld);

    // Convert world matrix → parent local space (parentMatrix is matrixWorld)
    t.parentInv.copy(parentMatrix).invert();
    t.parentInv.multiply(t.desiredMat);
    t.parentInv.decompose(t.v1, t.q, t.v2);

    // Backface visibility — use viewDir so we do not clobber the decomposed scale in v2
    this._targetMesh.getWorldQuaternion(t.meshWorldQ);
    t.normalWorld.set(this._normal.x, this._normal.y, this._normal.z).applyQuaternion(t.meshWorldQ);
    t.viewDir.copy(t.centerWorld).sub(camera.position).normalize();
    const visible = t.normalWorld.dot(t.viewDir) < 0;

    // Cursor state (only if hover or drag active)
    let cursorState = EMPTY_GIZMO_CURSOR;
    if (this._hoverState || this._dragState) {
      cursorState = this._computeCursorState(this._lastPointer.x, this._lastPointer.y);
    }

    return {
      worldPosition: t.v1.clone(),
      worldQuaternion: t.q.clone(),
      worldScale: t.v2.clone(),
      visible,
      emphasis: this.emphasis,
      cursorState,
    };
  }

  // ── Event handlers ──

  handlePointerDown(
    event: PointerEvent,
    mode: HandleMode,
    cornerIndex?: number,
  ): void {
    this._setRayFromEvent(event);
    this._initDrag(mode, event, cornerIndex);
    this._hoverState = {
      mode,
      cornerIndex,
      point: mode === "rotate" ? this._tmp.v1.clone() : undefined,
    };
    this._lastPointer.x = event.clientX;
    this._lastPointer.y = event.clientY;

    if (mode === "move") this._events.onMoveStart?.();
    else if (mode === "rotate") this._events.onRotateStart?.();
    else if (mode === "scale") this._events.onScaleStart?.();
  }

  handlePointerMove(event: PointerEvent): void {
    this._lastPointer.x = event.clientX;
    this._lastPointer.y = event.clientY;

    const ds = this._dragState;
    if (!ds) return;

    this._setRayFromEvent(event);

    if (ds.mode === "move") {
      this._handleMoveDrag();
    } else {
      const hit = this._rayToPlane(ds.plane);
      if (!hit) return;

      if (ds.mode === "rotate") {
        this._handleRotateDrag(hit, ds, event);
      } else {
        this._handleScaleDrag(hit, ds);
      }
    }
  }

  handlePointerUp(event: PointerEvent): void {
    const ds = this._dragState;
    if (!ds) return;

    const mode = ds.mode;
    this._dragState = null;
    this._lastPointer.x = event.clientX;
    this._lastPointer.y = event.clientY;

    if (mode === "move") this._events.onMoveEnd?.();
    else if (mode === "rotate") this._events.onRotateEnd?.();
    else if (mode === "scale") this._events.onScaleEnd?.();
  }

  handlePointerLeave(): void {
    if (this._dragState) return;
    this._hoverState = null;
    this._events.onCursorChange?.(EMPTY_GIZMO_CURSOR);
  }

  // ── Lifecycle ──

  dispose(): void {
    this._dragState = null;
    this._hoverState = null;
    this._events.onCursorChange?.(EMPTY_GIZMO_CURSOR);
  }

  // ── Private: cursor computation ──

  private _computeCursorState(clientX: number, clientY: number): GizmoCursorState {
    const ds = this._dragState;
    const hs = this._hoverState;
    const active = ds ? ds.mode : hs ? hs.mode : null;

    const canvas = this._canvasEl;
    const cam = this._camera;
    if (!canvas || !cam) return EMPTY_GIZMO_CURSOR;

    const rect = canvas.getBoundingClientRect();
    const cornerWorld = ds?.cornerWorld ?? null;

    let hoverPoint = hs?.point ?? null;
    if (ds?.mode === "rotate") {
      this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      this._raycaster.setFromCamera(this._ndc, cam);
      if (this._raycaster.ray.intersectPlane(ds.plane, this._tmp.v1)) {
        hoverPoint = this._tmp.v1.clone();
      }
    }

    return computeGizmoCursorState({
      camera: cam,
      canvas: canvas as HTMLCanvasElement,
      clientX,
      clientY,
      active,
      isDragging: ds != null,
      centerWorld: this._centerWorld,
      gizmoRoot: null,
      hoverPoint,
      cornerWorld,
    });
  }

  // ── Private: raycasting ──

  private _setRayFromEvent(e: PointerEvent): void {
    const canvas = this._canvasEl;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this._ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (this._camera) {
      this._raycaster.setFromCamera(this._ndc, this._camera);
    }
  }

  _setRayFromScreen(clientX: number, clientY: number, rect: DOMRect, camera: Camera): void {
    this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._ndc, camera);
  }

  private _rayToPlane(plane: Plane): Vector3 | null {
    const hit = this._raycaster.ray.intersectPlane(plane, this._tmp.v1);
    return hit ? this._tmp.v1.clone() : null;
  }

  // ── Private: drag init ──

  private _initDrag(mode: HandleMode, downEvent: PointerEvent, cornerIndex?: number): void {
    const t = this._tmp;
    this._targetMesh.updateWorldMatrix(true, false);
    this._targetMesh.getWorldQuaternion(t.meshWorldQ);
    t.normalWorld.set(this._normal.x, this._normal.y, this._normal.z).applyQuaternion(t.meshWorldQ);
    t.localPos.copy(this._position);
    this._targetMesh.localToWorld(t.centerWorld.copy(t.localPos));

    const plane = new Plane().setFromNormalAndCoplanarPoint(t.normalWorld, t.centerWorld);
    const startYaw = decalRotationToYaw(this._rotation);
    const gizmoWorldQInv = gizmoDragFrameQInv(
      t.normalWorld.x,
      t.normalWorld.y,
      t.normalWorld.z,
      startYaw,
    ).clone();
    const startHit = this._rayToPlane(plane);

    let absQWorld: Quaternion | undefined;
    let refXWorld: Vector3 | undefined;
    let refYWorld: Vector3 | undefined;
    let lastHitWorld: Vector3 | undefined;
    if (mode === "move") {
      const [qx, qy, qz, qw] = orientToNormalQ(
        this._normal.x,
        this._normal.y,
        this._normal.z,
        this._rotation,
      );
      t.absLocalQ.set(qx, qy, qz, qw);
      absQWorld = t.meshWorldQ.clone().multiply(t.absLocalQ);
      extractRefAxesFromAbsQuaternion(absQWorld, t.refX, t.refY);
      refXWorld = t.refX.clone();
      refYWorld = t.refY.clone();
      lastHitWorld = t.centerWorld.clone();
    }

    this._dragState = {
      mode,
      plane,
      centerWorld: t.centerWorld.clone(),
      gizmoWorldQInv,
      startAngle: startHit
        ? angleInGizmoLocal(startHit, t.centerWorld, gizmoWorldQInv, t.v2)
        : 0,
      startDist: startHit ? startHit.distanceTo(t.centerWorld) : 1,
      startYaw,
      startRotation: this._rotation,
      startScale: this._scale,
      curNormal: this._normal.clone(),
      curRotation: this._rotation,
      absQWorld,
      refXWorld,
      refYWorld,
      lastHitWorld,
      cornerIndex,
      cornerWorld: undefined,
    };
  }

  // ── Private: move drag ──

  private _handleMoveDrag(): void {
    const ds = this._dragState;
    if (!ds) return;
    const t = this._tmp;

    const hits = this._raycaster
      .intersectObject(this._object, true)
      .filter(
        (h) =>
          !h.object.userData.isDecal && !h.object.userData.isGizmo && (h.object as Mesh).isMesh,
      );
    if (hits.length === 0) return;

    // Prefer hit near previous frame to reduce punch-through
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
    t.v1.copy(hit.point);
    hitMesh.worldToLocal(t.v1);
    if (ds.lastHitWorld) ds.lastHitWorld.copy(hit.point);
    else ds.lastHitWorld = hit.point.clone();

    const rawN = hit.normal ?? hit.face?.normal;
    if (!rawN || !ds.absQWorld || !ds.refXWorld || !ds.refYWorld) {
      this._events.onMove?.({
        position: [t.v1.x, t.v1.y, t.v1.z],
        normal: [this._normal.x, this._normal.y, this._normal.z],
        targetMesh: hitMesh,
      });
      return;
    }

    t.nLocal.copy(rawN).normalize();
    if (hit.face && t.nLocal.dot(hit.face.normal) < 0) {
      t.nLocal.negate();
    }
    hitMesh.updateWorldMatrix(true, false);
    hitMesh.getWorldQuaternion(t.meshWorldQ);
    t.normalWorld.copy(t.nLocal).applyQuaternion(t.meshWorldQ).normalize();

    const ok = absQuaternionFromNormalAndRef(
      ds.absQWorld,
      t.normalWorld.x,
      t.normalWorld.y,
      t.normalWorld.z,
      ds.refXWorld.x,
      ds.refXWorld.y,
      ds.refXWorld.z,
      ds.refYWorld.x,
      ds.refYWorld.y,
      ds.refYWorld.z,
    );
    if (!ok) {
      this._events.onMove?.({
        position: [t.v1.x, t.v1.y, t.v1.z],
        normal: [t.nLocal.x, t.nLocal.y, t.nLocal.z],
        targetMesh: hitMesh,
      });
      return;
    }

    t.meshWorldQInv.copy(t.meshWorldQ).invert();
    t.absLocalQ.copy(t.meshWorldQInv).multiply(ds.absQWorld);
    const nextRotation = extractSpinAroundNormal(
      t.absLocalQ,
      t.nLocal.x,
      t.nLocal.y,
      t.nLocal.z,
    );
    ds.curRotation = nextRotation;
    ds.curNormal.copy(t.nLocal);

    this._events.onMove?.({
      position: [t.v1.x, t.v1.y, t.v1.z],
      normal: [t.nLocal.x, t.nLocal.y, t.nLocal.z],
      targetMesh: hitMesh,
    });
    // Also fire rotation when move reorients (granular API consumers)
    this._events.onRotate?.({ rotation: nextRotation });
  }

  // ── Private: rotate drag ──

  private _handleRotateDrag(hit: Vector3, ds: DragState, event: PointerEvent): void {
    const curAngle = angleInGizmoLocal(hit, ds.centerWorld, ds.gizmoWorldQInv, this._tmp.v2);
    const finalRotation = decalRotationFromRingDrag(
      ds.startYaw,
      ds.startAngle,
      curAngle,
      event.shiftKey,
    );
    ds.curRotation = finalRotation;
    this._events.onRotate?.({ rotation: finalRotation });
  }

  // ── Private: scale drag ──

  private _handleScaleDrag(hit: Vector3, ds: DragState): void {
    if (ds.startDist < 1e-4) return;
    const curDist = hit.distanceTo(ds.centerWorld);
    const next = ds.startScale * (curDist / ds.startDist);
    const clamped = Math.max(this._minScale, Math.min(this._maxScale, next));
    this._events.onScale?.({ scale: clamped });
  }
}