import type { Operation } from "./operations";
import { CoreError, type Project, type ProjectNode } from "./project";
import {
  inverseTransform,
  multiplyTransforms,
  nodeTransform,
  transformPoint,
  type Matrix,
  type Point,
} from "./scene";

export type SceneAlignment =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";
export type SceneDistribution = "horizontal" | "vertical";

type SelectedLayer = {
  node: ProjectNode;
  parentTransform: Matrix;
  transform: Matrix;
  pageId: string;
  locked: boolean;
  selectedAncestor: boolean;
};
type Bounds = {
  left: number;
  center: number;
  right: number;
  top: number;
  middle: number;
  bottom: number;
};

/** Validate every requested ID before dropping descendants of selected ancestors. */
function selectedLayers(
  project: Project,
  nodeIds: string[],
  minimum: number,
): SelectedLayer[] {
  const selected = new Set(nodeIds);
  const found = new Map<string, SelectedLayer>();
  function walk(
    nodes: ProjectNode[],
    pageId: string,
    parentTransform: Matrix,
    inheritedLock = false,
    selectedAncestor = false,
  ) {
    for (const node of nodes) {
      const transform = multiplyTransforms(parentTransform, nodeTransform(node));
      const locked = inheritedLock || !!node.locked;
      const isSelected = selected.has(node.id);
      if (isSelected)
        found.set(node.id, {
          node,
          parentTransform,
          transform,
          pageId,
          locked,
          selectedAncestor,
        });
      for (const children of Object.values(node.slots))
        walk(children, pageId, transform, locked, selectedAncestor || isSelected);
    }
  }
  for (const page of project.pages)
    walk(page.nodes, page.screenId, [1, 0, 0, 1, 0, 0]);
  for (const id of selected) {
    const layer = found.get(id);
    if (!layer) throw new CoreError("NODE_NOT_FOUND", id);
    if (!layer.node.scene) throw new CoreError("NODE_NOT_SCENE", id);
    if (layer.locked) throw new CoreError("NODE_LOCKED", id);
  }
  if (new Set([...found.values()].map((layer) => layer.pageId)).size > 1)
    throw new CoreError("MIXED_PAGE_SELECTION");
  const roots = [...found.values()].filter((layer) => !layer.selectedAncestor);
  function hasLockedDescendant(node: ProjectNode): boolean {
    return (
      !!node.locked ||
      Object.values(node.slots).some((children) =>
        children.some(hasLockedDescendant),
      )
    );
  }
  for (const layer of roots)
    if (hasLockedDescendant(layer.node))
      throw new CoreError("NODE_LOCKED", layer.node.id);
  if (roots.length < minimum) throw new CoreError("INSUFFICIENT_SELECTION");
  return roots;
}

function worldBounds(layer: SelectedLayer): Bounds {
  const { width, height } = layer.node.scene!;
  const points = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ].map((point) => transformPoint(point, layer.transform));
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  return {
    left,
    right,
    top,
    bottom,
    center: (left + right) / 2,
    middle: (top + bottom) / 2,
  };
}

function translateLayer(layer: SelectedLayer, delta: Point): Operation {
  const inverse = inverseTransform(layer.parentTransform);
  const scene = layer.node.scene!;
  // A displacement is a vector: apply only the inverse's linear part, without translation.
  return {
    type: "setNodeMetadata",
    nodeId: layer.node.id,
    scene: {
      x: scene.x + inverse[0] * delta.x + inverse[2] * delta.y,
      y: scene.y + inverse[1] * delta.x + inverse[3] * delta.y,
    },
  };
}

/** Move independent selected roots by CSS pixels in world space, in document order. */
export function translateSceneLayers(
  project: Project,
  nodeIds: string[],
  delta: Point,
): Operation[] {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y))
    throw new CoreError("INVALID_TRANSLATION");
  return selectedLayers(project, nodeIds, 1).map((layer) =>
    translateLayer(layer, delta),
  );
}

/** Align world AABBs to their union's edge or center; clipping and visibility do not alter bounds. */
export function alignSceneLayers(
  project: Project,
  nodeIds: string[],
  alignment: SceneAlignment,
): Operation[] {
  if (!["left", "center", "right", "top", "middle", "bottom"].includes(alignment))
    throw new CoreError("INVALID_ALIGNMENT");
  const layers = selectedLayers(project, nodeIds, 2);
  const bounds = layers.map(worldBounds);
  const left = Math.min(...bounds.map((box) => box.left));
  const right = Math.max(...bounds.map((box) => box.right));
  const top = Math.min(...bounds.map((box) => box.top));
  const bottom = Math.max(...bounds.map((box) => box.bottom));
  const target: Bounds = {
    left,
    right,
    top,
    bottom,
    center: (left + right) / 2,
    middle: (top + bottom) / 2,
  };
  const horizontal =
    alignment === "left" || alignment === "center" || alignment === "right";
  return layers.map((layer, index) => {
    const distance = target[alignment] - bounds[index][alignment];
    return translateLayer(
      layer,
      horizontal ? { x: distance, y: 0 } : { x: 0, y: distance },
    );
  });
}

/** Equal nonnegative gaps between world AABBs; reject layouts that would change positional rank. */
export function distributeSceneLayers(
  project: Project,
  nodeIds: string[],
  axis: SceneDistribution,
): Operation[] {
  if (axis !== "horizontal" && axis !== "vertical")
    throw new CoreError("INVALID_DISTRIBUTION");
  const layers = selectedLayers(project, nodeIds, 3);
  const start = axis === "horizontal" ? "left" : "top";
  const end = axis === "horizontal" ? "right" : "bottom";
  const ordered = layers
    .map((layer, index) => ({ layer, index, bounds: worldBounds(layer) }))
    .sort((a, b) => a.bounds[start] - b.bounds[start] || a.index - b.index);
  const first = ordered[0],
    last = ordered[ordered.length - 1];
  const occupied = ordered.reduce(
    (sum, item) => sum + item.bounds[end] - item.bounds[start],
    0,
  );
  const computedGap =
    (last.bounds[end] - first.bounds[start] - occupied) / (ordered.length - 1);
  const geometryScale = Math.max(
    occupied,
    ...ordered.flatMap(({ bounds }) => [
      Math.abs(bounds[start]),
      Math.abs(bounds[end]),
    ]),
  );
  // Width subtraction, summation and rotated bounds can leave a few ULPs below zero.
  // Scale with this axis's geometry and arithmetic count, never orthogonal position
  // or a CSS pixel: translating on the other axis must not permit genuine overlaps.
  const gapTolerance =
    (4 * Number.EPSILON * geometryScale * (ordered.length + 2)) /
    (ordered.length - 1);
  if (computedGap < -gapTolerance)
    throw new CoreError("NEGATIVE_DISTRIBUTION_GAP");
  const gap = computedGap < 0 ? 0 : computedGap;
  const deltas = new Map<string, number>();
  let position = first.bounds[start];
  ordered.forEach((item, index) => {
    deltas.set(
      item.layer.node.id,
      index === 0 || index === ordered.length - 1
        ? 0
        : position - item.bounds[start],
    );
    position += item.bounds[end] - item.bounds[start] + gap;
  });
  return layers.map((layer) => {
    const distance = deltas.get(layer.node.id)!;
    return translateLayer(
      layer,
      axis === "horizontal" ? { x: distance, y: 0 } : { x: 0, y: distance },
    );
  });
}
