import {
  scaleSceneLayersInBasis,
  rotateSceneLayers,
  transformFramePivot,
} from "../core/affine-geometry";
import { CoreError } from "../core/tokens";
import type { SceneGeometry } from "../core/scene";
import type { Project } from "../core/project";
import { nodeTransform, type Matrix, type Point } from "../core/scene";
import {
  createTransformGesture,
  updateTransformGesture,
  type TransformGesture,
  type TransformHandle,
  type TransformRotationState,
} from "../core/transform-gesture";

/** Private geometry adapter only. This unit rectangle never reaches ProjectStore,
 * editor context or a user document. Its local coordinates are source image UVs. */
export function createImageMappingGesture(
  matrix: Matrix,
  options: {
    tool: "move" | "scale" | "rotate";
    handle?: TransformHandle;
    pointer: Point;
  },
): TransformGesture {
  const project: Project = {
    schemaVersion: 2,
    projectId: "image-mapping-gesture",
    name: "Image mapping gesture",
    revision: 0,
    theme: "light",
    library: { id: "image-mapping-gesture", version: "1" },
    tokens: {},
    pages: [
      {
        screenId: "image-mapping",
        name: "Image mapping",
        viewport: { width: 1, height: 1 },
        nodes: [
          {
            id: "source-uv",
            type: "SceneFrame",
            props: {},
            slots: {},
            scene: {
              kind: "frame",
              x: matrix[4],
              y: matrix[5],
              width: 1,
              height: 1,
              linearTransform: [matrix[0], matrix[1], matrix[2], matrix[3]],
            },
          },
        ],
      },
    ],
  };
  return createTransformGesture(project, ["source-uv"], options);
}

export function updateImageMappingGesture(
  gesture: TransformGesture,
  pointer: Point,
  modifiers: { altKey?: boolean; shiftKey?: boolean } = {},
  rotationState?: TransformRotationState,
):
  | {
      valid: true;
      matrix: Matrix;
      changed: boolean;
      rotationState: TransformRotationState;
    }
  | { valid: false; code: string; rotationState: TransformRotationState } {
  const result = updateTransformGesture(
    gesture,
    pointer,
    modifiers,
    rotationState,
  );
  if (!result.valid) return result;
  const geometry =
    result.operations[0]?.geometry ?? gesture.parents[0].geometry;
  const matrix = mappingFromGeometry(gesture, geometry);
  return {
    valid: true,
    matrix,
    changed: result.operations.length > 0,
    rotationState: result.rotationState,
  };
}

function mappingFromGeometry(
  gesture: TransformGesture,
  geometry: SceneGeometry,
): Matrix {
  // Core Scale keeps the UV box dimensions. Multiplication also makes this
  // conversion explicit should the shared command choose an equivalent box.
  const local = nodeTransform({
    ...gesture.project.pages[0].nodes[0],
    scene: { kind: "frame", ...geometry },
  });
  return [
    local[0] * geometry.width!,
    local[1] * geometry.width!,
    local[2] * geometry.height!,
    local[3] * geometry.height!,
    local[4],
    local[5],
  ];
}

export function adjustImageMapping(
  matrix: Matrix,
  adjustment:
    { kind: "scale"; factor: number } | { kind: "rotate"; degrees: number },
): Matrix {
  const gesture = createImageMappingGesture(matrix, {
    tool: "move",
    pointer: { x: 0, y: 0 },
  });
  const pivot = transformFramePivot(gesture.frame, { x: 0.5, y: 0.5 });
  const operations =
    adjustment.kind === "scale"
      ? scaleSceneLayersInBasis(
          gesture.project,
          ["source-uv"],
          adjustment.factor,
          adjustment.factor,
          pivot,
          [1, 0, 0, 1],
        )
      : rotateSceneLayers(
          gesture.project,
          ["source-uv"],
          adjustment.degrees,
          pivot,
        );
  if (!operations.length) return [...matrix];
  const operation = operations[0];
  if (operation.type !== "setNodeGeometry")
    throw new CoreError("INVALID_TRANSFORM");
  return mappingFromGeometry(gesture, operation.geometry);
}
