import { translateSceneLayers } from "./geometry-commands";
import type { Operation } from "./operations";
import { CoreError, type Project, type ProjectNode } from "./project";
import {
  inverseTransform,
  multiplyTransforms,
  nodeTransform,
  transformPoint,
  type LinearTransform,
  validateScene,
  type Matrix,
  type Point,
  type SceneGeometry,
} from "./scene";

type Layer = {
  node: ProjectNode;
  parent: Matrix;
  world: Matrix;
  pageId: string;
};
/** Reuse the shared selection guard: validate every ID/lock before excluding selected descendants. */
function selected(project: Project, ids: string[]): Layer[] {
  const roots = new Set(
    translateSceneLayers(project, ids, { x: 0, y: 0 }).map(
      (op) => (op as { nodeId: string }).nodeId,
    ),
  );
  const result: Layer[] = [];
  function walk(nodes: ProjectNode[], parent: Matrix, pageId: string) {
    for (const node of nodes) {
      const world = multiplyTransforms(parent, nodeTransform(node));
      if (roots.has(node.id)) result.push({ node, parent, world, pageId });
      for (const children of Object.values(node.slots))
        walk(children, world, pageId);
    }
  }
  for (const page of project.pages)
    walk(page.nodes, [1, 0, 0, 1, 0, 0], page.screenId);
  return result;
}
function operation(layer: Layer, geometry: SceneGeometry): Operation[] {
  const { rotation: _r, linearTransform: _l, ...rest } = layer.node.scene!;
  validateScene({ ...rest, ...geometry }, `node.${layer.node.id}.scene`);
  const current = layer.node.scene!;
  const close = (a: number, b: number) =>
    Math.abs(a - b) <=
    32 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
  const next = nodeTransform({
    ...layer.node,
    scene: { ...rest, ...geometry },
  });
  if (
    close(current.width, geometry.width) &&
    close(current.height, geometry.height) &&
    nodeTransform(layer.node).every((n, i) => close(n, next[i]))
  )
    return [];
  return [{ type: "setNodeGeometry", nodeId: layer.node.id, geometry }];
}
function geometry(
  layer: Layer,
  matrix: Matrix,
  width = layer.node.scene!.width,
  height = layer.node.scene!.height,
): SceneGeometry {
  return {
    x: matrix[4],
    y: matrix[5],
    width,
    height,
    linearTransform: [matrix[0], matrix[1], matrix[2], matrix[3]],
  };
}
export type TransformFrame = {
  pageId: string;
  rootIds: string[];
  roots: { id: string; width: number; height: number; world: Matrix }[];
  bounds: { x: number; y: number; width: number; height: number };
};
/** Capture independent editable roots. Matrices and arrays are detached from Project. */
export function getTransformFrame(
  project: Project,
  nodeIds: string[],
): TransformFrame {
  const layers = selected(project, nodeIds);
  const roots = layers.map(({ node, world }) => ({
    id: node.id,
    width: node.scene!.width,
    height: node.scene!.height,
    world: [...world] as Matrix,
  }));
  const points = roots.flatMap((root) =>
    [
      { x: 0, y: 0 },
      { x: root.width, y: 0 },
      { x: root.width, y: root.height },
      { x: 0, y: root.height },
    ].map((point) => transformPoint(point, root.world)),
  );
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  const width = Math.max(...points.map((p) => p.x)) - x,
    height = Math.max(...points.map((p) => p.y)) - y;
  if (![x, y, width, height].every(Number.isFinite))
    throw new CoreError("INVALID_TRANSFORM");
  return {
    pageId: layers[0].pageId,
    rootIds: roots.map((root) => root.id),
    roots,
    bounds: { x, y, width, height },
  };
}
function validateAnchor(anchor: Point): void {
  if (
    !Number.isFinite(anchor.x) ||
    !Number.isFinite(anchor.y) ||
    anchor.x < 0 ||
    anchor.x > 1 ||
    anchor.y < 0 ||
    anchor.y > 1
  )
    throw new CoreError("INVALID_TRANSFORM");
}
/** Single selection uses its local box (including reflection), multi uses world AABB. */
export function transformFramePivot(
  frame: TransformFrame,
  anchor: Point,
): Point {
  validateAnchor(anchor);
  const root = frame.roots[0];
  const pivot =
    frame.roots.length === 1
      ? transformPoint(
          { x: root.width * anchor.x, y: root.height * anchor.y },
          root.world,
        )
      : {
          x: frame.bounds.x + frame.bounds.width * anchor.x,
          y: frame.bounds.y + frame.bounds.height * anchor.y,
        };
  if (!Number.isFinite(pivot.x) || !Number.isFinite(pivot.y))
    throw new CoreError("INVALID_TRANSFORM");
  return pivot;
}
function worldAffine(layers: Layer[], affine: Matrix): Operation[] {
  return layers.flatMap((layer) =>
    operation(
      layer,
      geometry(
        layer,
        multiplyTransforms(
          inverseTransform(layer.parent),
          multiplyTransforms(affine, layer.world),
        ),
      ),
    ),
  );
}
/** Scale in captured world basis B, about the world pivot: T(p) B D B^-1 T(-p).
 * An identity basis preserves the world-axis behavior of scaleSceneLayers. */
export function scaleSceneLayersInBasis(
  project: Project,
  nodeIds: string[],
  sx: number,
  sy: number,
  pivot: Point,
  basis: LinearTransform,
): Operation[] {
  const layers = selected(project, nodeIds);
  if (!Array.isArray(basis) || basis.length !== 4)
    throw new CoreError("INVALID_TRANSFORM");
  const matrix: Matrix = [...basis, 0, 0];
  const inverse = inverseTransform(matrix);
  const scale = scaleAround(sx, sy, { x: 0, y: 0 });
  if (!Number.isFinite(pivot.x) || !Number.isFinite(pivot.y))
    throw new CoreError("INVALID_TRANSFORM");
  if (sx === 1 && sy === 1) return [];
  const linear = multiplyTransforms(multiplyTransforms(matrix, scale), inverse);
  linear[4] = pivot.x - linear[0] * pivot.x - linear[2] * pivot.y;
  linear[5] = pivot.y - linear[1] * pivot.x - linear[3] * pivot.y;
  return worldAffine(layers, linear);
}
function scaleAround(
  sx: number,
  sy: number,
  pivot: Point,
  positive = false,
): Matrix {
  if (
    !Number.isFinite(sx) ||
    !Number.isFinite(sy) ||
    !Number.isFinite(pivot.x) ||
    !Number.isFinite(pivot.y) ||
    sx === 0 ||
    sy === 0 ||
    (positive && (sx < 0 || sy < 0))
  )
    throw new CoreError("INVALID_TRANSFORM");
  return [sx, 0, 0, sy, pivot.x * (1 - sx), pivot.y * (1 - sy)];
}
/** World Scale changes the wrapper matrix; all local layout sizes and content stay intact.
 * Negative factors are explicit flips. Zero/cross-zero gestures are not inferred. */
export function scaleSceneLayers(
  project: Project,
  nodeIds: string[],
  sx: number,
  sy: number,
  pivot: Point,
): Operation[] {
  const layers = selected(project, nodeIds);
  const affine = scaleAround(sx, sy, pivot);
  if (sx === 1 && sy === 1) return [];
  return worldAffine(layers, affine);
}
/** Rotate independent roots around a shared world-space pivot, preserving local layout. */
export function rotateSceneLayers(
  project: Project,
  nodeIds: string[],
  degrees: number,
  pivot: Point,
): Operation[] {
  const layers = selected(project, nodeIds);
  if (
    !Number.isFinite(degrees) ||
    !Number.isFinite(pivot.x) ||
    !Number.isFinite(pivot.y)
  )
    throw new CoreError("INVALID_TRANSFORM");
  if (degrees % 360 === 0) return [];
  const radians = ((degrees % 360) * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians);
  const affine: Matrix = [
    c,
    s,
    -s,
    c,
    pivot.x - c * pivot.x + s * pivot.y,
    pivot.y - s * pivot.x - c * pivot.y,
  ];
  return worldAffine(layers, affine);
}
/** Resize one layout box. Anchor is a normalized local point (0..1), fixed in world space. */
export function resizeSceneLayer(
  project: Project,
  nodeId: string,
  width: number,
  height: number,
  anchor: Point = { x: 0, y: 0 },
): Operation[] {
  validateAnchor(anchor);
  const layer = selected(project, [nodeId])[0],
    scene = layer.node.scene!,
    matrix = nodeTransform(layer.node);
  const dx = (scene.width - width) * anchor.x,
    dy = (scene.height - height) * anchor.y;
  const next: SceneGeometry = {
    x: scene.x + matrix[0] * dx + matrix[2] * dy,
    y: scene.y + matrix[1] * dx + matrix[3] * dy,
    width,
    height,
  };
  // Resize alone does not introduce or decompose a matrix in untouched legacy nodes.
  if (scene.linearTransform) next.linearTransform = [...scene.linearTransform];
  else if (scene.rotation !== undefined) next.rotation = scene.rotation;
  return operation(layer, next);
}
/** Multi Resize follows the exact target world quad while positive column-length ratios
 * are absorbed into layout sizes, so content reflows instead of being uniformly scaled. */
export function resizeSceneLayers(
  project: Project,
  nodeIds: string[],
  sx: number,
  sy: number,
  pivot: Point,
): Operation[] {
  const layers = selected(project, nodeIds);
  const affine = scaleAround(sx, sy, pivot, true);
  if (sx === 1 && sy === 1) return [];
  return layers.flatMap((layer) => {
    const target = multiplyTransforms(affine, layer.world);
    const qx =
      Math.hypot(target[0], target[1]) /
      Math.hypot(layer.world[0], layer.world[1]);
    const qy =
      Math.hypot(target[2], target[3]) /
      Math.hypot(layer.world[2], layer.world[3]);
    const normalized = multiplyTransforms(target, [1 / qx, 0, 0, 1 / qy, 0, 0]);
    return operation(
      layer,
      geometry(
        layer,
        multiplyTransforms(inverseTransform(layer.parent), normalized),
        layer.node.scene!.width * qx,
        layer.node.scene!.height * qy,
      ),
    );
  });
}
