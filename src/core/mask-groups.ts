import { definitionNodes } from "./design-components";
import type { Operation } from "./operations";
import { CoreError, type Project, type ProjectNode } from "./project";
import { hasLockedSceneDescendant } from "./scene-locks";
import {
  inverseTransform,
  multiplyTransforms,
  nodeTransform,
  transformPoint,
  validateScene,
  type Matrix,
  type SceneGeometry,
} from "./scene";

type Location = {
  node: ProjectNode;
  list: ProjectNode[];
  index: number;
  pageId: string;
  parentId?: string;
  slot?: string;
  locked: boolean;
};
function locations(project: Project): Map<string, Location> {
  const result = new Map<string, Location>();
  function walk(
    nodes: ProjectNode[],
    pageId: string,
    inheritedLock = false,
    parentId?: string,
    slot?: string,
  ) {
    nodes.forEach((node, index) => {
      const locked = inheritedLock || !!node.locked;
      result.set(node.id, {
        node,
        list: nodes,
        index,
        pageId,
        parentId,
        slot,
        locked,
      });
      for (const [name, children] of Object.entries(node.slots))
        walk(children, pageId, locked, node.id, name);
    });
  }
  for (const page of project.pages) walk(page.nodes, page.screenId);
  return result;
}
function editable(project: Project, location: Location): void {
  if (location.locked || hasLockedSceneDescendant(project, location.node))
    throw new CoreError("NODE_LOCKED", location.node.id);
}
function geometry(node: ProjectNode, matrix: Matrix): SceneGeometry {
  if (!node.scene) throw new CoreError("NODE_NOT_SCENE", node.id);
  const result: SceneGeometry = {
    x: matrix[4],
    y: matrix[5],
    width: node.scene.width,
    height: node.scene.height,
    linearTransform: [matrix[0], matrix[1], matrix[2], matrix[3]],
  };
  const { rotation: _rotation, linearTransform: _linear, ...rest } = node.scene;
  validateScene({ ...rest, ...result }, `node.${node.id}.scene`);
  return result;
}

/** Wrap only a contiguous sibling interval: regrouping disjoint roots changes
 * their stacking relative to unselected neighbors. The source position is kept. */
export function wrapMaskGroup(
  project: Project,
  nodeIds: string[],
  sourceNodeId: string,
  groupId: string,
  maskMode: "alpha" | "luminance" = "alpha",
): Operation[] {
  const all = locations(project),
    selected = [...new Set(nodeIds)];
  if (!selected.length) throw new CoreError("INSUFFICIENT_SELECTION");
  const roots = selected.map((id) => {
    const location = all.get(id);
    if (!location) throw new CoreError("NODE_NOT_FOUND", id);
    if (!location.node.scene) throw new CoreError("NODE_NOT_SCENE", id);
    editable(project, location);
    return location;
  });
  const first = roots[0];
  if (roots.some((root) => root.list !== first.list || root.node.maskSource))
    throw new CoreError("INVALID_MASK_SELECTION");
  roots.sort((a, b) => a.index - b.index);
  if (roots.some((root, index) => root.index !== roots[0].index + index))
    throw new CoreError("INVALID_MASK_SELECTION");
  if (!roots.some((root) => root.node.id === sourceNodeId))
    throw new CoreError("INVALID_MASK_SOURCE");
  if (
    all.has(groupId) ||
    (project.designComponents ?? []).some((def) =>
      definitionNodes(def.nodes).has(groupId),
    )
  )
    throw new CoreError("DUPLICATE_NODE_ID", groupId);
  if (typeof groupId !== "string" || !groupId || groupId.length > 1000)
    throw new CoreError("INVALID_ID");
  const corners = roots.flatMap(({ node }) =>
    [
      { x: 0, y: 0 },
      { x: node.scene!.width, y: 0 },
      { x: 0, y: node.scene!.height },
      { x: node.scene!.width, y: node.scene!.height },
    ].map((point) => transformPoint(point, nodeTransform(node))),
  );
  const x = Math.min(...corners.map((point) => point.x));
  const y = Math.min(...corners.map((point) => point.y));
  const wrapper: ProjectNode = {
    id: groupId,
    type: "SceneMask",
    props: {},
    slots: { children: [] },
    scene: validateScene(
      {
        kind: "mask",
        maskMode,
        x,
        y,
        width: Math.max(...corners.map((point) => point.x)) - x,
        height: Math.max(...corners.map((point) => point.y)) - y,
      },
      `node.${groupId}.scene`,
    ),
  };
  const inverse = inverseTransform(nodeTransform(wrapper));
  const operations: Operation[] = [
    {
      type: "insertNode",
      pageId: first.pageId,
      ...(first.parentId ? { parentId: first.parentId, slot: first.slot } : {}),
      index: roots[0].index,
      node: wrapper,
    },
  ];
  roots.forEach(({ node }, index) => {
    operations.push(
      {
        type: "setNodeGeometry",
        nodeId: node.id,
        geometry: geometry(
          node,
          multiplyTransforms(inverse, nodeTransform(node)),
        ),
      },
      {
        type: "moveNode",
        nodeId: node.id,
        pageId: first.pageId,
        parentId: groupId,
        slot: "children",
        index,
      },
    );
  });
  operations.push({ type: "setMaskSource", nodeId: groupId, sourceNodeId });
  return operations;
}

/** Domain-specific splice payload used by the atomic unwrap operation. Only
 * direct source markers are removed; nested masks keep their source membership. */
export function unwrappedMaskChildren(
  project: Project,
  nodeId: string,
): ProjectNode[] {
  const location = locations(project).get(nodeId);
  if (!location) throw new CoreError("NODE_NOT_FOUND", nodeId);
  const group = location.node;
  if (group.scene?.kind !== "mask")
    throw new CoreError("NODE_NOT_MASK", nodeId);
  editable(project, location);
  // Replacing an active outer source with several children needs an explicit
  // outer-source decision; unwrap cannot distribute that role by array position.
  if (group.maskSource) throw new CoreError("INVALID_MASK_SELECTION", nodeId);
  if (group.scene.opacity !== undefined && group.scene.opacity !== 1)
    throw new CoreError("MASK_GROUP_COMPOSITING", nodeId);
  return group.slots.children.map((original) => {
    const node = structuredClone(original);
    if (group.hidden) node.hidden = true;
    const next = geometry(
      node,
      multiplyTransforms(nodeTransform(group), nodeTransform(node)),
    );
    const {
      rotation: _rotation,
      linearTransform: _linear,
      ...rest
    } = node.scene!;
    node.scene = { ...rest, ...next };
    delete node.maskSource;
    return node;
  });
}

/** One domain operation preserves IDs and anchors without remove/reinsert edits. */
export function unwrapMaskGroup(project: Project, nodeId: string): Operation[] {
  unwrappedMaskChildren(project, nodeId);
  return [{ type: "unwrapMask", nodeId }];
}
