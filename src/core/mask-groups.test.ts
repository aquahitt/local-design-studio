import { expect, it } from "vitest";
import * as maskCommands from "./mask-groups";
import { applyBatch, type Operation } from "./operations";
import { parseProject, type Project, type ProjectNode } from "./project";
import { sceneProject } from "./scene-fixtures";
import { sceneLayers, transformPoint, nodeTransform } from "./scene";

function wrap(
  project: Project,
  ids = ["label", "shape"],
  sourceId = "shape",
  wrapperId = "mask",
): Operation[] {
  return maskCommands.wrapMaskGroup(
    project,
    ids,
    sourceId,
    wrapperId,
    "luminance",
  );
}
function unwrap(project: Project, id = "mask"): Operation[] {
  return maskCommands.unwrapMaskGroup(project, id);
}
function apply(project: Project, operations: Operation[]) {
  return applyBatch(project, {
    requestId: `mask-${project.revision}`,
    baseRevision: project.revision,
    operations,
  });
}
function project() {
  const initial = sceneProject();
  Object.assign(initial.pages[0].nodes[0].scene, { rotation: 31 });
  Object.assign(initial.pages[0].nodes[0].slots.content[0].scene, {
    linearTransform: [-1.4, 0.2, 0.3, 0.7],
  });
  Object.assign(initial.pages[0].nodes[0].slots.content[1].scene, {
    rotation: -45,
  });
  return parseProject(initial);
}
function matrices(project: Project) {
  return new Map(
    sceneLayers(project.pages[0].nodes).map((layer) => [
      layer.node.id,
      layer.transform,
    ]),
  );
}
function expectSameMatrix(
  actual: number[] | undefined,
  expected: number[] | undefined,
) {
  expect(actual).toHaveLength(6);
  actual!.forEach((coefficient, index) =>
    expect(coefficient).toBeCloseTo(expected![index], 10),
  );
}

it("wraps contiguous sibling roots in document order with parent-local union bounds and unchanged world matrices", () => {
  const initial = project(),
    before = structuredClone(initial),
    world = matrices(initial);
  const parent = initial.pages[0].nodes[0];
  const corners = parent.slots.content.flatMap((node) =>
    [
      { x: 0, y: 0 },
      { x: node.scene!.width, y: 0 },
      { x: 0, y: node.scene!.height },
      { x: node.scene!.width, y: node.scene!.height },
    ].map((point) => transformPoint(point, nodeTransform(node))),
  );
  const x = Math.min(...corners.map((p) => p.x)),
    y = Math.min(...corners.map((p) => p.y));
  const next = apply(initial, wrap(initial, ["shape", "label"]));
  const mask = next.pages[0].nodes[0].slots.content[0];
  expect(mask.id).toBe("mask");
  expect(mask.type).toBe("SceneMask");
  expect(mask.scene).toEqual({
    kind: "mask",
    maskMode: "luminance",
    x,
    y,
    width: Math.max(...corners.map((p) => p.x)) - x,
    height: Math.max(...corners.map((p) => p.y)) - y,
  });
  expect(mask.slots.children.map((node) => node.id)).toEqual([
    "label",
    "shape",
  ]);
  expect(mask.slots.children[1]).toHaveProperty("maskSource", true);
  expect(mask.slots.children[0]).not.toHaveProperty("maskSource");
  for (const id of ["label", "shape"])
    expectSameMatrix(matrices(next).get(id), world.get(id));
  expect(initial).toEqual(before);
});

it("unwraps the current child order and affine world geometry, clears only direct source markers, and preserves neighbors", () => {
  let current = project();
  current.pages[0].nodes[0].slots.content.push({
    id: "after",
    type: "Text",
    props: {},
    slots: {},
  });
  current = apply(current, wrap(current));
  current = apply(current, [
    {
      type: "setNodeGeometry",
      nodeId: "mask",
      geometry: {
        x: -20,
        y: 80,
        width: 200,
        height: 100,
        linearTransform: [-1, 0.4, 0.2, 1.2],
      },
    },
    {
      type: "moveNode",
      nodeId: "shape",
      pageId: "home",
      parentId: "mask",
      slot: "children",
      index: 0,
    },
  ]);
  const before = matrices(current),
    next = apply(current, unwrap(current));
  expect(next.pages[0].nodes[0].slots.content.map((node) => node.id)).toEqual([
    "shape",
    "label",
    "after",
  ]);
  expect(
    next.pages[0].nodes[0].slots.content.every((node) => !node.maskSource),
  ).toBe(true);
  for (const id of ["label", "shape", "after"])
    expectSameMatrix(matrices(next).get(id), before.get(id));
  expect(() =>
    apply(current, [
      ...unwrap(current),
      {
        type: "setNodeGeometry",
        nodeId: "label",
        geometry: { x: 0, y: 0, width: -1, height: 10 },
      },
    ]),
  ).toThrow("INVALID_SCENE");
  expect(current.pages[0].nodes[0].slots.content[0].id).toBe("mask");
});

it("unwraps nested mask sources without losing the enclosing source role or nested child roles", () => {
  let current = project();
  current = apply(current, wrap(current));
  const inner = current.pages[0].nodes[0].slots.content[0];
  const outer: ProjectNode = {
    id: "outer",
    type: "SceneMask",
    props: {},
    scene: {
      kind: "mask",
      maskMode: "alpha",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    },
    slots: { children: [inner] },
  };
  Object.assign(inner, { maskSource: true });
  current.pages[0].nodes[0].slots.content = [outer];
  // An outer source cannot be implicitly distributed across its unwrapped children.
  expect(() => unwrap(current, "mask")).toThrow("INVALID_MASK_SELECTION");
  const next = apply(current, unwrap(current, "outer"));
  const remaining = next.pages[0].nodes[0].slots.content[0];
  expect(remaining).not.toHaveProperty("maskSource");
  expect(remaining.slots.children[1]).toHaveProperty("maskSource", true);
});

it("rejects disjoint, mixed-parent/page, ancestor/descendant, missing-source and active outer-source selections", () => {
  const initial = project();
  const parent = initial.pages[0].nodes[0];
  parent.slots.content.push({
    ...structuredClone(parent.slots.content[0]),
    id: "third",
  });
  expect(() => wrap(initial, ["label", "third"])).toThrow(
    "INVALID_MASK_SELECTION",
  );
  expect(() => wrap(initial, ["frame", "label"])).toThrow(
    "INVALID_MASK_SELECTION",
  );
  expect(() => wrap(initial, ["label", "shape"], "third")).toThrow(
    "INVALID_MASK_SOURCE",
  );
  expect(() => wrap(initial, ["label", "missing"])).toThrow("NODE_NOT_FOUND");
  expect(() => wrap(initial, [], "label")).toThrow("INSUFFICIENT_SELECTION");
  expect(() => wrap(initial, ["label", "shape"], "label", "frame")).toThrow(
    "DUPLICATE_NODE_ID",
  );
  const wrapped = apply(initial, wrap(initial));
  expect(() => wrap(wrapped, ["label", "shape"])).toThrow(
    "INVALID_MASK_SELECTION",
  );
  initial.pages.push({
    screenId: "other",
    name: "Other",
    viewport: { width: 800 },
    nodes: [{ ...structuredClone(parent.slots.content[0]), id: "elsewhere" }],
  });
  expect(() => wrap(initial, ["label", "elsewhere"], "label")).toThrow(
    "INVALID_MASK_SELECTION",
  );
});

it.each(["ancestor", "root", "descendant", "unwrap-descendant"])(
  "rejects %s locks without changing the project",
  (location) => {
    let initial = project();
    if (location === "unwrap-descendant") {
      initial = apply(initial, wrap(initial));
      initial.pages[0].nodes[0].slots.content[0].slots.children[0].locked = true;
      expect(() => unwrap(initial)).toThrow("NODE_LOCKED");
      expect(() =>
        apply(initial, [{ type: "unwrapMask", nodeId: "mask" } as Operation]),
      ).toThrow("NODE_LOCKED");
      return;
    }
    if (location === "ancestor") initial.pages[0].nodes[0].locked = true;
    if (location === "root")
      initial.pages[0].nodes[0].slots.content[0].locked = true;
    if (location === "descendant")
      initial.pages[0].nodes[0].slots.content[0].slots.content = [
        { id: "locked", type: "Text", props: {}, slots: {}, locked: true },
      ];
    const before = structuredClone(initial);
    expect(() => wrap(initial)).toThrow("NODE_LOCKED");
    expect(initial).toEqual(before);
  },
);

it("rejects ungrouping non-unit group opacity rather than silently changing overlapping content compositing", () => {
  const current = apply(project(), wrap(project()));
  const group = current.pages[0].nodes[0].slots.content[0];
  group.scene!.opacity = 0.4;
  expect(() => unwrap(current)).toThrow("MASK_GROUP_COMPOSITING");
  expect(() =>
    apply(current, [{ type: "unwrapMask", nodeId: "mask" }]),
  ).toThrow("MASK_GROUP_COMPOSITING");
});

it("removes masking while preserving wrapper identity, opacity, transforms, outer-source role and nested masks", () => {
  const current = apply(project(), wrap(project()));
  const group = current.pages[0].nodes[0].slots.content[0];
  const nested = structuredClone(group);
  nested.id = "nested-mask";
  nested.slots.children.forEach((node) => {
    node.id = `nested-${node.id}`;
  });
  group.slots.children[0].slots.content = [nested];
  group.scene!.opacity = 0.4;
  group.maskSource = true;
  const outer: ProjectNode = {
    id: "outer",
    type: "SceneMask",
    props: {},
    scene: {
      kind: "mask",
      maskMode: "alpha",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    },
    slots: { children: [group] },
  };
  current.pages[0].nodes[0].slots.content = [outer];
  const before = matrices(current);
  const next = apply(current, [
    { type: "removeMask", nodeId: "mask" } as Operation,
  ]);
  const removed = next.pages[0].nodes[0].slots.content[0].slots.children[0];
  expect(removed.id).toBe(group.id);
  expect(removed.type).toBe("SceneFrame");
  const { maskMode: _mode, ...geometryAndOpacity } = group.scene!;
  expect(removed.scene).toEqual({ ...geometryAndOpacity, kind: "frame" });
  expect(removed.maskSource).toBe(true);
  expect(removed.slots.children.map((node) => node.id)).toEqual([
    "label",
    "shape",
  ]);
  expect(removed.slots.children.every((node) => !node.maskSource)).toBe(true);
  expect(
    removed.slots.children[0].slots.content[0].slots.children[1].maskSource,
  ).toBe(true);
  for (const [id, matrix] of before)
    expectSameMatrix(matrices(next).get(id), matrix);
  expect(group.scene!.kind).toBe("mask");
});

it("validates remove-mask targets and locks and keeps a failed final batch atomic", () => {
  const current = apply(project(), wrap(project()));
  expect(() =>
    apply(current, [{ type: "removeMask", nodeId: "label" } as Operation]),
  ).toThrow("NODE_NOT_MASK");
  expect(() =>
    apply(current, [
      {
        type: "removeMask",
        nodeId: "mask",
        extra: true,
      } as unknown as Operation,
    ]),
  ).toThrow("UNKNOWN_FIELD");
  expect(() =>
    apply(current, [
      { type: "removeMask", nodeId: "mask" } as Operation,
      { type: "removeNode", nodeId: "missing" },
    ]),
  ).toThrow("NODE_NOT_FOUND");
  expect(current.pages[0].nodes[0].slots.content[0].scene!.kind).toBe("mask");
  current.pages[0].nodes[0].slots.content[0].slots.children[0].locked = true;
  expect(() =>
    apply(current, [{ type: "removeMask", nodeId: "mask" } as Operation]),
  ).toThrow("NODE_LOCKED");
});

it("preserves inherited hidden state when lifting a hidden mask children", () => {
  const initial = project(),
    wrapped = apply(initial, wrap(initial));
  const group = [...wrapped.pages[0].nodes[0].slots.content].find(
    (node) => node.id === "mask",
  )!;
  group.hidden = true;
  const result = apply(wrapped, unwrap(wrapped));
  const children = result.pages[0].nodes[0].slots.content;
  expect(
    children
      .filter((node) => ["label", "shape"].includes(node.id))
      .map((node) => node.hidden),
  ).toEqual([true, true]);
});
