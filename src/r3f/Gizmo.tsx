/**
 * R3F Gizmo component — React wrapper for the surface-aligned transform gizmo.
 *
 * Uses the GizmoController internally but renders visual meshes in JSX (idiomatic
 * R3F), keeping the same GizmoProps interface as the original for backward compatibility.
 *
 * ## Usage
 * ```tsx
 * import { Gizmo, GizmoCursorOverlay } from "three-surface-gizmo/r3f";
 *
 * function Scene() {
 *   const [cursor, setCursor] = useState(EMPTY_GIZMO_CURSOR);
 *   return (
 *     <div className="relative w-full h-full">
 *       <Canvas>
 *         <Gizmo
 *           position={[0, 0, 0]}
 *           normal={[0, 1, 0]}
 *           rotation={0}
 *           scale={1}
 *           object={modelObject}
 *           targetMesh={selectedMesh}
 *           minScale={0.05}
 *           maxScale={0.6}
 *           onUpdate={handleUpdate}
 *           onInteractChange={setInteracting}
 *           onCursorChange={setCursor}
 *         />
 *       </Canvas>
 *       <GizmoCursorOverlay {...cursor} />
 *     </div>
 *   );
 * }
 * ```
 */

"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { GizmoController, type GizmoFrameResult } from "../controller";
import type { GizmoCursorState, GizmoEvents, GizmoTransform, HandleMode } from "../types";
import { EMPTY_GIZMO_CURSOR, RING_RADIUS, RING_TUBE_RADIUS, GIZMO_COLOR, GIZMO_COLOR_MOVE } from "../types";
import { orientToNormalQ } from "../orientation";

// ── Props ───────────────────────────────────────────────────────────

export type GizmoProps = GizmoTransform & {
  /** Model root object (raycast target for move mode) */
  object: Object3D;
  /** Current binding mesh */
  targetMesh: Mesh;
  /** Minimum uniform scale */
  minScale: number;
  /** Maximum uniform scale */
  maxScale: number;
  /** Dynamic cursor state callback (for DOM overlay) */
  onCursorChange?: (state: GizmoCursorState) => void;
} & Partial<GizmoEvents>;

// ── Visual helpers ──────────────────────────────────────────────────

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
) {
  const mat = mesh.material as MeshBasicMaterial;
  mat.color.copy(lerpColor(baseColor, t * 0.6));
  mat.opacity = t >= 1 ? 1 : Math.min(1, baseOpacity + t * 0.15);
  (parentForScale ?? mesh).scale.setScalar(1 + t * (popScale - 1));
}

// ── Scale handle layout ─────────────────────────────────────────────

const SCALE_HANDLE_AXES: Array<[number, number]> = [
  [0, RING_RADIUS],
  [RING_RADIUS, 0],
  [0, -RING_RADIUS],
  [-RING_RADIUS, 0],
];

// ── Component ───────────────────────────────────────────────────────

export function Gizmo({
  position,
  normal,
  rotation,
  scale,
  object,
  targetMesh,
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

  const controllerRef = useRef<GizmoController | null>(null);
  const lastFrameRef = useRef<GizmoFrameResult | null>(null);

  const setControlsEnabled = useCallback(
    (enabled: boolean) => {
      if (controls) controls.enabled = enabled;
    },
    [controls],
  );

  // Create controller once
  useEffect(() => {
    const ctrl = new GizmoController({
      object,
      targetMesh,
      minScale,
      maxScale,
    });
    ctrl.setCamera(camera);
    ctrl.setCanvasElement(gl.domElement);
    ctrl.setTransform(
      new Vector3(position[0], position[1], position[2]),
      new Vector3(normal[0], normal[1], normal[2]),
      rotation,
      scale,
    );
    controllerRef.current = ctrl;
    return () => ctrl.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update controller on prop changes
  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    ctrl.setObject(object);
    ctrl.setTargetMesh(targetMesh);
    ctrl.setMinMaxScale(minScale, maxScale);
    ctrl.setTransform(
      new Vector3(position[0], position[1], position[2]),
      new Vector3(normal[0], normal[1], normal[2]),
      rotation,
      scale,
    );
  }, [position, normal, rotation, scale, object, targetMesh, minScale, maxScale]);

  // Granular event refs
  const onCursorRef = useRef(onCursorChange);
  onCursorRef.current = onCursorChange;
  const onMoveStartRef = useRef(onMoveStart);
  onMoveStartRef.current = onMoveStart;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;
  const onRotateStartRef = useRef(onRotateStart);
  onRotateStartRef.current = onRotateStart;
  const onRotateRef = useRef(onRotate);
  onRotateRef.current = onRotate;
  const onRotateEndRef = useRef(onRotateEnd);
  onRotateEndRef.current = onRotateEnd;
  const onScaleStartRef = useRef(onScaleStart);
  onScaleStartRef.current = onScaleStart;
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;
  const onScaleEndRef = useRef(onScaleEnd);
  onScaleEndRef.current = onScaleEnd;

  useEffect(() => {
    controllerRef.current?.setEvents({
      onCursorChange: (s) => onCursorRef.current?.(s),
      onMoveStart: () => onMoveStartRef.current?.(),
      onMove: (e) => onMoveRef.current?.(e),
      onMoveEnd: () => onMoveEndRef.current?.(),
      onRotateStart: () => onRotateStartRef.current?.(),
      onRotate: (e) => onRotateRef.current?.(e),
      onRotateEnd: () => onRotateEndRef.current?.(),
      onScaleStart: () => onScaleStartRef.current?.(),
      onScale: (e) => onScaleRef.current?.(e),
      onScaleEnd: () => onScaleEndRef.current?.(),
    });
  }, []);

  // Local orientation quaternion for visual matrix
  const [nrmX, nrmY, nrmZ] = normal;
  const localOrientQ = useMemo(() => {
    const [qx, qy, qz, qw] = orientToNormalQ(nrmX, nrmY, nrmZ, rotation);
    return new Quaternion(qx, qy, qz, qw);
  }, [nrmX, nrmY, nrmZ, rotation]);

  // Hover state for visual emphasis
  const hoverRef = useRef<{ mode: HandleMode; cornerIndex?: number } | null>(null);

  useFrame(() => {
    const ctrl = controllerRef.current;
    const root = rootRef.current;
    if (!ctrl || !root) return;
    const parent = root.parent;
    if (!parent) return;

    // Update camera and canvas on controller
    ctrl.setCamera(camera);
    ctrl.setCanvasElement(gl.domElement);

    // Compute parent matrix inverse
    const parentInv = new Matrix4().copy(parent.matrixWorld).invert();

    const result = ctrl.update(camera, size, parentInv);
    lastFrameRef.current = result;

    // Apply world transform
    root.position.copy(result.worldPosition);
    root.quaternion.copy(result.worldQuaternion);
    root.scale.copy(result.worldScale);
    root.visible = result.visible;

    // Apply emphasis to visual meshes
    const e = result.emphasis;
    const baseRing = baseRingRef.current;
    const movePuck = movePuckRef.current;
    const movePuckRing = movePuckRingRef.current;
    if (baseRing) applyVisual(baseRing, GIZMO_COLOR, 0.42, e.rotate, 1);
    if (movePuck) applyVisual(movePuck, GIZMO_COLOR_MOVE, 0.96, e.move, 1.2);
    if (movePuckRing) applyVisual(movePuckRing, GIZMO_COLOR, 0.5, e.move, 1);
    scaleGroupRefs.current.forEach((g, i) => {
      if (!g) return;
      const gem = g.children[0] as Mesh | undefined;
      if (gem?.isMesh) {
        applyVisual(gem, GIZMO_COLOR, 0.95, e.scale[i] ?? 0, 1.4, g);
      }
    });
  });

  // Pointer event handlers
  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>, mode: HandleMode, cornerIndex?: number) => {
      if (!rootRef.current?.visible) return;
      e.stopPropagation();
      setControlsEnabled(false);
      gl.domElement.setPointerCapture(e.pointerId);
      controllerRef.current?.handlePointerDown(e.nativeEvent, mode, cornerIndex);
    },
    [setControlsEnabled, gl],
  );

  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>, mode: HandleMode, cornerIndex?: number) => {
      if (!rootRef.current?.visible) return;
      e.stopPropagation();
      hoverRef.current = { mode, cornerIndex };
      controllerRef.current?.setCanvasElement(gl.domElement);
      controllerRef.current?.setCamera(camera);
    },
    [camera, gl],
  );

  const handlePointerOut = useCallback(() => {
    if (controllerRef.current?.isDragging) return;
    hoverRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setControlsEnabled(true);
      gl.domElement.style.cursor = "auto";
      onCursorRef.current?.(EMPTY_GIZMO_CURSOR);
    };
  }, [setControlsEnabled, gl]);

  // Window-level pointermove/up (drag continuation)
  useEffect(() => {
    const dom = gl.domElement;
    const onMove = (e: PointerEvent) => {
      controllerRef.current?.handlePointerMove(e);
    };
    const onUp = (e: PointerEvent) => {
      controllerRef.current?.handlePointerUp(e);
      setControlsEnabled(true);
      dom.releasePointerCapture?.(e.pointerId);
    };
    const onLeave = () => {
      controllerRef.current?.handlePointerLeave();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointerleave", onLeave);
    };
  }, [gl, setControlsEnabled]);

  // Hit material props (invisible, but intercepts events)
  const hitMaterialProps = {
    colorWrite: false as const,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  };

  return (
    <group ref={rootRef} renderOrder={1000}>
      {/* Rotate: thin ring + expanded hit volume */}
      <mesh
        onPointerDown={(e: ThreeEvent<PointerEvent>) => handlePointerDown(e, "rotate")}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => handlePointerOver(e, "rotate")}
        onPointerOut={handlePointerOut}
        renderOrder={998}
      >
        <torusGeometry args={[RING_RADIUS, 0.26, 8, 32]} />
        <meshBasicMaterial {...hitMaterialProps} />
      </mesh>
      <mesh ref={baseRingRef} renderOrder={999}>
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

      {/* Move: center puck + ring */}
      <mesh
        onPointerDown={(e: ThreeEvent<PointerEvent>) => handlePointerDown(e, "move")}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => handlePointerOver(e, "move")}
        onPointerOut={handlePointerOut}
        renderOrder={998}
      >
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial {...hitMaterialProps} />
      </mesh>
      <mesh ref={movePuckRef} rotation={[Math.PI / 2, 0, 0]} renderOrder={1001}>
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
      <mesh ref={movePuckRingRef} renderOrder={1000}>
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

      {/* Scale: 4 corner diamonds */}
      {SCALE_HANDLE_AXES.map(([x, y], i) => (
        <group
          key={i}
          ref={(el) => { scaleGroupRefs.current[i] = el; }}
          position={[x, y, 0]}
        >
          <mesh rotation={[0, 0, Math.PI / 4]} renderOrder={1001}>
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
          <mesh
            onPointerDown={(e: ThreeEvent<PointerEvent>) => handlePointerDown(e, "scale", i)}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => handlePointerOver(e, "scale", i)}
            onPointerOut={handlePointerOut}
            renderOrder={998}
          >
            <sphereGeometry args={[0.4, 12, 12]} />
            <meshBasicMaterial {...hitMaterialProps} />
          </mesh>
        </group>
      ))}
    </group>
  );
}