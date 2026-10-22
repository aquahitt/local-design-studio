import { translateSceneLayers } from "./geometry-commands";
import type { Operation } from "./operations";
import { CoreError, type Project, type ProjectNode } from "./project";
import {
  inverseTransform,
  multiplyTransforms,
  nodeTransform,
  validateScene,
  type Matrix,
  type Point,
  type SceneGeometry,
} from "./scene";

type Layer = { node: ProjectNode; parent: Matrix; world: Matrix };
/** Reuse the shared selection guard: validate every ID/lock before excluding selected descendants. */
function selected(project: Project, ids: string[]): Layer[] {
  const roots = new Set(
    translateSceneLayers(project, ids, { x: 0, y: 0 }).map(
      (op) => (op as { nodeId: string }).nodeId,
    ),
  );
  const result: Layer[] = [];
  function walk(nodes: ProjectNode[], parent: Matrix) {
    for (const node of nodes) {
      const world = multiplyTransforms(parent, nodeTransform(node));
      if (roots.has(node.id)) result.push({ node, parent, world });
      for (const children of Object.values(node.slots)) walk(children, world);
    }
  }
  for (const page of project.pages) walk(page.nodes, [1, 0, 0, 1, 0, 0]);
  return result;
}
function operation(layer: Layer, geometry: SceneGeometry): Operation {
  const { rotation: _r, linearTransform: _l, ...rest } = layer.node.scene!;
  validateScene({ ...rest, ...geometry }, `node.${layer.node.id}.scene`);
  return { type: "setNodeGeometry", nodeId: layer.node.id, geometry };
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
  const affine = scaleAround(sx, sy, pivot);
  return selected(project, nodeIds).map((layer) =>
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
/** Rotate independent roots around a shared world-space pivot, preserving local layout. */
export function rotateSceneLayers(
  project: Project,
  nodeIds: string[],
  degrees: number,
  pivot: Point,
): Operation[] {
  if (
    !Number.isFinite(degrees) ||
    !Number.isFinite(pivot.x) ||
    !Number.isFinite(pivot.y)
  )
    throw new CoreError("INVALID_TRANSFORM");
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
  return selected(project, nodeIds).map((layer) =>
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
/** Resize one layout box. Anchor is a normalized local point (0..1), fixed in world space. */
export function resizeSceneLayer(
  project: Project,
  nodeId: string,
  width: number,
  height: number,
  anchor: Point = { x: 0, y: 0 },
): Operation[] {
  if (
    !Number.isFinite(anchor.x) ||
    !Number.isFinite(anchor.y) ||
    anchor.x < 0 ||
    anchor.x > 1 ||
    anchor.y < 0 ||
    anchor.y > 1
  )
    throw new CoreError("INVALID_TRANSFORM");
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
  return [operation(layer, next)];
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
  const affine = scaleAround(sx, sy, pivot, true);
  return selected(project, nodeIds).map((layer) => {
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
