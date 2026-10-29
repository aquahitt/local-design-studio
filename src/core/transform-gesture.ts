import { translateSceneLayers } from "./geometry-commands";
import type { Operation } from "./operations";
import type { Project, ProjectNode } from "./project";
import { CoreError } from "./tokens";
import {
  inverseTransform,
  multiplyTransforms,
  nodeTransform,
  transformPoint,
  type Matrix,
  type LinearTransform,
  type Point,
  type SceneGeometry,
  validateScene,
} from "./scene";
import {
  getTransformFrame,
  transformFramePivot,
  resizeSceneLayer,
  resizeSceneLayers,
  scaleSceneLayersInBasis,
  rotateSceneLayers,
  type TransformFrame,
} from "./affine-geometry";

export type TransformHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type TransformTool = "move" | "resize" | "scale" | "rotate";
export type TransformRotationState = Readonly<{
  lastAngleRadians: number;
  totalRadians: number;
}>;
type GeometryOperation = Extract<Operation, { type: "setNodeGeometry" }>;
export type TransformGesture = Readonly<{
  project: Project;
  projectId: string;
  revision: number;
  pageId: string;
  frame: TransformFrame;
  tool: TransformTool;
  handle?: TransformHandle;
  startPointer: Point;
  pointerOffset: Point;
  coordinates: Matrix;
  basis: LinearTransform;
  width: number;
  height: number;
  parents: { id: string; world: Matrix; geometry: SceneGeometry }[];
  rotationState: TransformRotationState;
}>;
export type TransformGestureResult =
  | {
      valid: true;
      operations: GeometryOperation[];
      rotationState: TransformRotationState;
      pivot: Point;
      frame: TransformFrame;
      degrees?: number;
    }
  | {
      valid: false;
      operations: [];
      rotationState: TransformRotationState;
      code: string;
    };
const anchors: Record<TransformHandle, Point> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};
/** Shared handle coordinates; callers receive a copy, never the private table. */
export function transformHandleAnchor(handle: TransformHandle): Point {
  if (!Object.hasOwn(anchors, handle)) throw new CoreError("INVALID_TRANSFORM");
  return { ...anchors[handle] };
}
function finite(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Capture once. All nested data are detached and frozen; updates never alter this
 * snapshot or accumulate geometry from previous output. Camera/context cancellation
 * belongs to the caller, which compares these project/revision/page identifiers. */
export function createTransformGesture(
  project: Project,
  nodeIds: string[],
  options: { tool: TransformTool; handle?: TransformHandle; pointer: Point },
): TransformGesture {
  if (
    !finite(options.pointer) ||
    !["move", "resize", "scale", "rotate"].includes(options.tool) ||
    (options.tool !== "rotate" &&
      options.tool !== "move" &&
      (!options.handle || !Object.hasOwn(anchors, options.handle)))
  )
    throw new CoreError("INVALID_TRANSFORM");
  const source = structuredClone(project),
    frame = getTransformFrame(source, nodeIds),
    single = frame.roots.length === 1,
    root = frame.roots[0];
  const coordinates: Matrix = single
    ? [...root.world]
    : [1, 0, 0, 1, frame.bounds.x, frame.bounds.y];
  const width = single ? root.width : frame.bounds.width,
    height = single ? root.height : frame.bounds.height;
  const basis: LinearTransform = [
    coordinates[0],
    coordinates[1],
    coordinates[2],
    coordinates[3],
  ];
  const handle = options.handle;
  const handlePoint =
    handle && Object.hasOwn(anchors, handle)
      ? transformFramePivot(frame, anchors[handle])
      : options.pointer;
  const pointerOffset = {
    x: options.pointer.x - handlePoint.x,
    y: options.pointer.y - handlePoint.y,
  };
  const pivot = transformFramePivot(frame, { x: 0.5, y: 0.5 });
  if (
    options.tool === "rotate" &&
    options.pointer.x === pivot.x &&
    options.pointer.y === pivot.y
  )
    throw new CoreError("INVALID_TRANSFORM");
  const nodes = new Map<string, { node: ProjectNode; parent: Matrix }>();
  function walk(values: ProjectNode[], parent: Matrix) {
    for (const node of values) {
      nodes.set(node.id, { node, parent });
      const world = multiplyTransforms(parent, nodeTransform(node));
      for (const children of Object.values(node.slots)) walk(children, world);
    }
  }
  source.pages.forEach((page) => walk(page.nodes, [1, 0, 0, 1, 0, 0]));
  const parents = frame.roots.map((item) => {
    const { node, parent } = nodes.get(item.id)!;
    const scene = node.scene!;
    const geometry: SceneGeometry = {
      x: scene.x,
      y: scene.y,
      width: scene.width,
      height: scene.height,
    };
    if (scene.rotation !== undefined) geometry.rotation = scene.rotation;
    if (scene.linearTransform)
      geometry.linearTransform = [...scene.linearTransform];
    return {
      id: item.id,
      world: [...parent] as Matrix,
      geometry,
    };
  });
  return freeze({
    project: source,
    projectId: source.projectId,
    revision: source.revision,
    pageId: frame.pageId,
    frame,
    tool: options.tool,
    handle,
    startPointer: { ...options.pointer },
    pointerOffset,
    coordinates,
    basis,
    width,
    height,
    parents,
    rotationState: {
      lastAngleRadians: Math.atan2(
        options.pointer.y - pivot.y,
        options.pointer.x - pivot.x,
      ),
      totalRadians: 0,
    },
  });
}
function nextFrame(
  gesture: TransformGesture,
  operations: GeometryOperation[],
): TransformFrame {
  const replacements = new Map(
    operations.map((op) => [op.nodeId, op.geometry]),
  );
  const roots = gesture.frame.roots.map((root) => {
    const geometry = replacements.get(root.id);
    if (!geometry) return { ...root, world: [...root.world] as Matrix };
    const local = nodeTransform({
      id: root.id,
      type: "SceneFrame",
      props: {},
      slots: {},
      scene: { kind: "frame", ...geometry },
    });
    const world = multiplyTransforms(
      gesture.parents.find((parent) => parent.id === root.id)!.world,
      local,
    );
    return {
      id: root.id,
      width: geometry.width,
      height: geometry.height,
      world,
    };
  });
  const points = roots.flatMap((root) =>
    [
      { x: 0, y: 0 },
      { x: root.width, y: 0 },
      { x: root.width, y: root.height },
      { x: 0, y: root.height },
    ].map((point) => transformPoint(point, root.world)),
  );
  if (points.some((point) => !finite(point)))
    throw new CoreError("INVALID_TRANSFORM");
  const x = Math.min(...points.map((point) => point.x)),
    y = Math.min(...points.map((point) => point.y));
  const width = Math.max(...points.map((point) => point.x)) - x,
    height = Math.max(...points.map((point) => point.y)) - y;
  if (![x, y, width, height].every(Number.isFinite))
    throw new CoreError("INVALID_TRANSFORM");
  return {
    pageId: gesture.pageId,
    rootIds: [...gesture.frame.rootIds],
    roots,
    bounds: { x, y, width, height },
  };
}
/** Latest pointer drives the result, including invalid final positions. Rotation
 * continuity is explicit state; Shift only snaps output, never that unsnapped state. */
export function updateTransformGesture(
  gesture: TransformGesture,
  pointer: Point,
  modifiers: { altKey?: boolean; shiftKey?: boolean } = {},
  rotationState: TransformRotationState = gesture.rotationState,
): TransformGestureResult {
  let state = rotationState;
  try {
    if (
      !finite(pointer) ||
      !Number.isFinite(state.lastAngleRadians) ||
      !Number.isFinite(state.totalRadians)
    )
      throw new CoreError("INVALID_TRANSFORM");
    let operations: Operation[], pivot: Point, degrees: number | undefined;
    if (gesture.tool === "move") {
      const delta = {
        x: pointer.x - gesture.startPointer.x,
        y: pointer.y - gesture.startPointer.y,
      };
      const moves = translateSceneLayers(
        gesture.project,
        gesture.frame.rootIds,
        delta,
      );
      operations =
        delta.x === 0 && delta.y === 0
          ? []
          : moves.map((move) => {
              const partial = move as Extract<
                Operation,
                { type: "setNodeMetadata" }
              >;
              const original = gesture.parents.find(
                (root) => root.id === partial.nodeId,
              )!.geometry;
              const geometry: SceneGeometry = {
                ...original,
                x: partial.scene!.x!,
                y: partial.scene!.y!,
              };
              validateScene(
                { kind: "frame", ...geometry },
                `node.${partial.nodeId}.scene`,
              );
              return {
                type: "setNodeGeometry",
                nodeId: partial.nodeId,
                geometry,
              };
            });
      const center = transformFramePivot(gesture.frame, { x: 0.5, y: 0.5 });
      pivot = { x: center.x + delta.x, y: center.y + delta.y };
    } else if (gesture.tool === "rotate") {
      pivot = transformFramePivot(gesture.frame, { x: 0.5, y: 0.5 });
      if (pointer.x === pivot.x && pointer.y === pivot.y)
        throw new CoreError("INVALID_TRANSFORM");
      const angle = Math.atan2(pointer.y - pivot.y, pointer.x - pivot.x);
      let delta = angle - state.lastAngleRadians;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      else if (delta < -Math.PI) delta += 2 * Math.PI;
      state = freeze({
        lastAngleRadians: angle,
        totalRadians: state.totalRadians + delta,
      });
      degrees = (state.totalRadians * 180) / Math.PI;
      if (modifiers.shiftKey) degrees = Math.round(degrees / 15) * 15;
      operations = rotateSceneLayers(
        gesture.project,
        gesture.frame.rootIds,
        degrees,
        pivot,
      );
    } else {
      const handle = anchors[gesture.handle!];
      const anchor = modifiers.altKey
        ? { x: 0.5, y: 0.5 }
        : { x: 1 - handle.x, y: 1 - handle.y };
      pivot = transformFramePivot(gesture.frame, anchor);
      const effective = {
        x: pointer.x - gesture.pointerOffset.x,
        y: pointer.y - gesture.pointerOffset.y,
      };
      const local = transformPoint(
        effective,
        inverseTransform(gesture.coordinates),
      );
      const activeX = handle.x !== 0.5,
        activeY = handle.y !== 0.5;
      let sx = activeX
        ? (local.x - anchor.x * gesture.width) /
          ((handle.x - anchor.x) * gesture.width)
        : 1;
      let sy = activeY
        ? (local.y - anchor.y * gesture.height) /
          ((handle.y - anchor.y) * gesture.height)
        : 1;
      if (modifiers.shiftKey) {
        if (activeX && activeY) {
          const original = transformFramePivot(gesture.frame, handle),
            v = { x: original.x - pivot.x, y: original.y - pivot.y },
            u = { x: effective.x - pivot.x, y: effective.y - pivot.y };
          const length = Math.hypot(v.x, v.y);
          sx = sy =
            (u.x / length) * (v.x / length) + (u.y / length) * (v.y / length);
        } else sx = sy = activeX ? sx : sy;
      }
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0)
        throw new CoreError("INVALID_TRANSFORM");
      operations =
        gesture.tool === "scale"
          ? scaleSceneLayersInBasis(
              gesture.project,
              gesture.frame.rootIds,
              sx,
              sy,
              pivot,
              gesture.basis,
            )
          : gesture.frame.roots.length === 1
            ? resizeSceneLayer(
                gesture.project,
                gesture.frame.rootIds[0],
                gesture.width * sx,
                gesture.height * sy,
                anchor,
              )
            : resizeSceneLayers(
                gesture.project,
                gesture.frame.rootIds,
                sx,
                sy,
                pivot,
              );
    }
    const geometry = operations as GeometryOperation[];
    return {
      valid: true,
      operations: geometry,
      rotationState: state,
      pivot,
      frame: nextFrame(gesture, geometry),
      ...(degrees === undefined ? {} : { degrees }),
    };
  } catch (error) {
    return {
      valid: false,
      operations: [],
      rotationState: state,
      code: error instanceof CoreError ? error.code : "INVALID_TRANSFORM",
    };
  }
}
