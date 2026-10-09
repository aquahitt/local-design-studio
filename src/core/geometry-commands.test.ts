import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { applyBatch, type Operation } from "./operations";
import { parseProject, type Project, type ProjectNode } from "./project";
import { sceneProject } from "./scene-fixtures";
import { sceneLayers, transformPoint } from "./scene";
import { ProjectStore } from "./store";
import {
  alignSceneLayers,
  distributeSceneLayers,
  translateSceneLayers,
} from "./geometry-commands";

function node(id: string, x: number, y: number, width = 20, height = 10): ProjectNode {
  return { id, type: "SceneFrame", props: {}, slots: {},
    scene: { kind: "frame", x, y, width, height } };
}
function projectWith(nodes: ProjectNode[]): Project {
  const project = parseProject(sceneProject());
  project.pages[0].nodes = nodes;
  return parseProject(project);
}
function apply(project: Project, operations: Operation[]): Project {
  return applyBatch(project, { requestId: "geometry", baseRevision: project.revision, operations });
}
function bounds(project: Project, id: string) {
  const layer = sceneLayers(project.pages[0].nodes).find((item) => item.node.id === id)!;
  const { width, height } = layer.node.scene!;
  const points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }]
    .map((point) => transformPoint(point, layer.transform));
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  return { left, right, top, bottom, center: (left + right) / 2, middle: (top + bottom) / 2 };
}
function mixedParents() {
  const parent = node("parent", 100, 100, 200, 200);
  parent.scene!.rotation = 90;
  parent.slots.content = [node("nested", 10, 20, 40, 10)];
  const outside = node("outside", 150, 180, 30, 20);
  outside.scene!.rotation = -90;
  return projectWith([parent, outside]);
}

it("translates in world coordinates through nested rotated parents without mutating the source", () => {
  const outer = node("outer", 40, 60);
  outer.scene!.rotation = 90;
  const inner = node("inner", 20, 30);
  inner.scene!.rotation = 45;
  const leaf = node("leaf", 5, 8);
  Object.assign(leaf.scene!, { rotation: 20, opacity: 0.5, fill: "#abc", radius: 3 });
  inner.slots.content = [leaf];
  outer.slots.content = [inner];
  const project = projectWith([outer]);
  const snapshot = structuredClone(project);
  const operations = translateSceneLayers(project, ["leaf"], { x: 30, y: -12 });
  expect(operations).toHaveLength(1);
  expect(operations[0]).toMatchObject({ type: "setNodeMetadata", nodeId: "leaf" });
  expect(Object.keys((operations[0] as Extract<Operation, { type: "setNodeMetadata" }>).scene!).sort()).toEqual(["x", "y"]);
  const next = apply(project, operations);
  expect(bounds(next, "leaf").left - bounds(project, "leaf").left).toBeCloseTo(30);
  expect(bounds(next, "leaf").top - bounds(project, "leaf").top).toBeCloseTo(-12);
  const moved = next.pages[0].nodes[0].slots.content[0].slots.content[0].scene!;
  expect({ ...moved, x: leaf.scene!.x, y: leaf.scene!.y }).toEqual(leaf.scene);
  expect(project).toEqual(snapshot);
});

it("deduplicates selected ancestors and emits roots in document order", () => {
  const parent = node("parent", 20, 30);
  parent.slots.content = [node("child", 2, 3)];
  const project = projectWith([parent, node("last", 100, 200)]);
  const operations = translateSceneLayers(project, ["last", "child", "parent", "last"], { x: 7, y: 9 });
  expect(operations.map((operation) => "nodeId" in operation && operation.nodeId)).toEqual(["parent", "last"]);
  const next = apply(project, operations);
  expect(next.pages[0].nodes[0].slots.content[0].scene).toEqual(parent.slots.content[0].scene);
  expect(bounds(next, "child").left - bounds(project, "child").left).toBeCloseTo(7);
});

it.each(["left", "center", "right", "top", "middle", "bottom"] as const)(
  "aligns %s using world AABBs across differently rotated parents", (alignment) => {
    const project = mixedParents();
    const snapshot = structuredClone(project);
    const first = bounds(project, "nested"), second = bounds(project, "outside");
    const target = alignment === "left" || alignment === "top" ? Math.min(first[alignment], second[alignment])
      : alignment === "right" || alignment === "bottom" ? Math.max(first[alignment], second[alignment])
        : alignment === "center" ? (Math.min(first.left, second.left) + Math.max(first.right, second.right)) / 2
          : (Math.min(first.top, second.top) + Math.max(first.bottom, second.bottom)) / 2;
    const next = apply(project, alignSceneLayers(project, ["outside", "nested"], alignment));
    expect(bounds(next, "nested")[alignment]).toBeCloseTo(target);
    expect(bounds(next, "outside")[alignment]).toBeCloseTo(target);
    const preserved = alignment === "left" || alignment === "center" || alignment === "right" ? "top" : "left";
    expect(bounds(next, "nested")[preserved]).toBeCloseTo(first[preserved]);
    expect(bounds(next, "outside")[preserved]).toBeCloseTo(second[preserved]);
    expect(project).toEqual(snapshot);
  },
);

it.each(["horizontal", "vertical"] as const)("distributes %s with equal gaps and fixed extremes across parents", (axis) => {
  const parent = node("parent", 40, 40);
  parent.scene!.rotation = 90;
  parent.slots.content = [node("middle", 30, -30, 20, 10)];
  const project = projectWith([node("last", 200, 200, 40, 40), parent, node("first", 0, 0, 20, 10)]);
  const snapshot = structuredClone(project);
  const operations = distributeSceneLayers(project, ["first", "middle", "last"], axis);
  expect(operations.map((operation) => "nodeId" in operation && operation.nodeId)).toEqual(["last", "middle", "first"]);
  const next = apply(project, operations);
  expect(bounds(next, "first")).toEqual(bounds(project, "first"));
  expect(bounds(next, "last")).toEqual(bounds(project, "last"));
  const start = axis === "horizontal" ? "left" : "top", end = axis === "horizontal" ? "right" : "bottom";
  expect(bounds(next, "middle")[start] - bounds(next, "first")[end])
    .toBeCloseTo(bounds(next, "last")[start] - bounds(next, "middle")[end]);
  const preserved = axis === "horizontal" ? "top" : "left";
  expect(bounds(next, "middle")[preserved]).toBeCloseTo(bounds(project, "middle")[preserved]);
  const repeated = apply(next, distributeSceneLayers(next, ["last", "middle", "first"], axis));
  expect(repeated.pages).toEqual(next.pages);
  expect(project).toEqual(snapshot);
});

it.each(["horizontal", "vertical"] as const)("rejects negative %s gaps for overlap, containment and huge interior bounds without mutations", (axis) => {
  const fixtures = [
    [[0, 100], [0, 20], [50, 100]],
    [[0, 1_000], [20, 10], [100, 10]],
    [[0, 10], [20, 1_000], [100, 10]],
  ];
  for (const fixture of fixtures) {
    const project = projectWith(fixture.map(([position, size], index) =>
      axis === "horizontal" ? node(`layer-${index}`, position, 0, size, 10)
        : node(`layer-${index}`, 0, position, 10, size)));
    const snapshot = structuredClone(project);
    expect(() => distributeSceneLayers(project, ["layer-2", "layer-1", "layer-0"], axis))
      .toThrow("NEGATIVE_DISTRIBUTION_GAP");
    expect(project).toEqual(snapshot);
  }
});

it.each(["horizontal", "vertical"] as const)("keeps nonnegative %s distribution idempotent and resolves initial position ties by document order", (axis) => {
  for (const end of [60, 120]) {
    const project = projectWith(["a", "b", "c"].map((id, index) => {
      const position = index === 2 ? end : 0;
      return axis === "horizontal" ? node(id, position, 0, 30, 10)
        : node(id, 0, position, 10, 30);
    }));
    const next = apply(project, distributeSceneLayers(project, ["c", "b", "a"], axis));
    const start = axis === "horizontal" ? "left" : "top";
    const finish = axis === "horizontal" ? "right" : "bottom";
    expect(bounds(next, "a")).toEqual(bounds(project, "a"));
    expect(bounds(next, "c")).toEqual(bounds(project, "c"));
    expect(bounds(next, "b")[start]).toBe(end / 2);
    expect(bounds(next, "b")[start] - bounds(next, "a")[finish]).toBe((end - 60) / 2);
    expect(bounds(next, "c")[start] - bounds(next, "b")[finish]).toBe((end - 60) / 2);
    const repeated = apply(next, distributeSceneLayers(next, ["b", "a", "c"], axis));
    expect(repeated.pages).toEqual(next.pages);
  }
});

it.each(["horizontal", "vertical"] as const)("accepts decimal zero %s gaps within floating-point precision", (axis) => {
  const positions = [0.1, 0.30000000000000004, 0.5];
  const project = projectWith(positions.map((position, index) =>
    axis === "horizontal" ? node(`decimal-${index}`, position, 0, 0.2, 10)
      : node(`decimal-${index}`, 0, position, 10, 0.2)));
  const next = apply(project, distributeSceneLayers(project, ["decimal-2", "decimal-1", "decimal-0"], axis));
  const start = axis === "horizontal" ? "left" : "top";
  const end = axis === "horizontal" ? "right" : "bottom";
  expect(bounds(next, "decimal-1")[start] - bounds(next, "decimal-0")[end]).toBeCloseTo(0, 14);
  expect(bounds(next, "decimal-2")[start] - bounds(next, "decimal-1")[end]).toBeCloseTo(0, 14);
  const repeated = apply(next, distributeSceneLayers(next, ["decimal-0", "decimal-1", "decimal-2"], axis));
  expect(repeated.pages).toEqual(next.pages);
  expect(project.pages[0].nodes.map((item) => item.scene![axis === "horizontal" ? "x" : "y"]))
    .toEqual(positions);
});

it("accepts decimal zero gaps under rotated parents with bounded geometry drift", () => {
  const parent = node("parent", 0.1, 0.3, 10, 10);
  parent.scene!.rotation = 90;
  parent.slots.content = [0.1, 0.30000000000000004, 0.5].map((position, index) =>
    node(`rotated-${index}`, 0, -position, 10, 0.2));
  const project = projectWith([parent]);
  const snapshot = structuredClone(project);
  let next = apply(project, distributeSceneLayers(project, ["rotated-2", "rotated-1", "rotated-0"], "horizontal"));
  for (let repeat = 0; repeat < 5; repeat++) {
    next = apply(next, distributeSceneLayers(next, ["rotated-0", "rotated-1", "rotated-2"], "horizontal"));
    for (const id of ["rotated-0", "rotated-1", "rotated-2"]) {
      expect(Math.abs(bounds(next, id).left - bounds(project, id).left)).toBeLessThan(1e-14);
      expect(Math.abs(bounds(next, id).top - bounds(project, id).top)).toBeLessThan(1e-14);
    }
  }
  expect(project).toEqual(snapshot);
});

it.each([1e-6, 1, 1e6])("rejects genuine negative gaps at geometry scale %s", (scale) => {
  const project = projectWith([0.1, 0.3, 0.5 - 1e-6].map((position, index) =>
    node(`scaled-${index}`, position * scale, 0, 0.2 * scale, 0.2 * scale)));
  const snapshot = structuredClone(project);
  expect(() => distributeSceneLayers(project, ["scaled-0", "scaled-1", "scaled-2"], "horizontal"))
    .toThrow("NEGATIVE_DISTRIBUTION_GAP");
  expect(project).toEqual(snapshot);
});

it.each(["horizontal", "vertical"] as const)("rejects genuine negative %s gaps after a large orthogonal translation", (axis) => {
  for (const orthogonal of [0, 1_000_000]) {
    const project = projectWith([0, 1e-6, 1.999e-6].map((position, index) =>
      axis === "horizontal"
        ? node(`orthogonal-${index}`, position, orthogonal, 1e-6, 1e-6)
        : node(`orthogonal-${index}`, orthogonal, position, 1e-6, 1e-6)));
    const snapshot = structuredClone(project);
    expect(() => distributeSceneLayers(project, ["orthogonal-0", "orthogonal-1", "orthogonal-2"], axis))
      .toThrow("NEGATIVE_DISTRIBUTION_GAP");
    expect(project).toEqual(snapshot);
  }
});

it("preserves a tiny positive gap without clamping it to zero", () => {
  const project = projectWith([node("a", 0.1, 0, 0.2), node("b", 0.31, 0, 0.2), node("c", 0.5 + 1e-12, 0, 0.2)]);
  const next = apply(project, distributeSceneLayers(project, ["a", "b", "c"], "horizontal"));
  const firstGap = bounds(next, "b").left - bounds(next, "a").right;
  const secondGap = bounds(next, "c").left - bounds(next, "b").right;
  expect(firstGap).toBeGreaterThan(4e-13);
  expect(firstGap).toBeLessThan(6e-13);
  expect(Math.abs(firstGap - secondGap)).toBeLessThan(1e-15);
});

it("allows explicitly selected hidden layers including inherited hidden", () => {
  const parent = node("parent", 20, 30);
  parent.hidden = true;
  parent.slots.content = [node("child", 2, 3)];
  const project = projectWith([parent]);
  const next = apply(project, translateSceneLayers(project, ["child"], { x: 4, y: 5 }));
  expect(next.pages[0].nodes[0].slots.content[0].scene).toMatchObject({ x: 6, y: 8 });
});

it.each(["translate", "align", "distribute"] as const)("rejects invalid %s selections before returning operations", (command) => {
  const run = (project: Project, ids: string[]) => command === "translate" ? translateSceneLayers(project, ids, { x: 1, y: 2 })
    : command === "align" ? alignSceneLayers(project, ids, "left") : distributeSceneLayers(project, ids, "horizontal");
  const project = projectWith([node("a", 0, 0), node("b", 30, 0), node("c", 70, 0)]);
  expect(() => run(project, ["a", "missing", "c"])).toThrow("NODE_NOT_FOUND");
  const nonScene = structuredClone(project);
  delete nonScene.pages[0].nodes[1].scene;
  expect(() => run(nonScene, ["a", "b", "c"])).toThrow("NODE_NOT_SCENE");
  const locked = structuredClone(project);
  locked.pages[0].nodes[1].locked = true;
  expect(() => run(locked, ["a", "b", "c"])).toThrow("NODE_LOCKED");
  const pages = structuredClone(project);
  pages.pages.push({ ...structuredClone(pages.pages[0]), screenId: "other", nodes: [node("other", 0, 0)] });
  expect(() => run(pages, ["a", "b", "other"])).toThrow("MIXED_PAGE_SELECTION");
  expect(project.revision).toBe(0);
});

it("rejects inherited locks, locked descendants and non-scene selected descendants before ancestor dedup", () => {
  const parent = node("parent", 0, 0);
  parent.slots.content = [node("child", 0, 0)];
  const project = projectWith([parent]);
  project.pages[0].nodes[0].locked = true;
  expect(() => translateSceneLayers(project, ["child"], { x: 1, y: 0 })).toThrow("NODE_LOCKED");
  project.pages[0].nodes[0].locked = false;
  project.pages[0].nodes[0].slots.content[0].locked = true;
  expect(() => translateSceneLayers(project, ["parent"], { x: 1, y: 0 })).toThrow("NODE_LOCKED");
  delete project.pages[0].nodes[0].slots.content[0].scene;
  project.pages[0].nodes[0].slots.content[0].locked = false;
  expect(() => translateSceneLayers(project, ["parent", "child"], { x: 1, y: 0 })).toThrow("NODE_NOT_SCENE");
});

it("requires independent selections and finite world deltas", () => {
  const project = projectWith([node("a", 0, 0), node("b", 30, 0)]);
  expect(() => translateSceneLayers(project, [], { x: 1, y: 0 })).toThrow("INSUFFICIENT_SELECTION");
  expect(() => alignSceneLayers(project, ["a", "a"], "left")).toThrow("INSUFFICIENT_SELECTION");
  expect(() => distributeSceneLayers(project, ["a", "b"], "horizontal")).toThrow("INSUFFICIENT_SELECTION");
  expect(() => translateSceneLayers(project, ["a"], { x: Infinity, y: 0 })).toThrow("INVALID_TRANSLATION");
  expect(() => translateSceneLayers(project, ["a"], { x: 0, y: NaN })).toThrow("INVALID_TRANSLATION");
  expect(() => alignSceneLayers(project, ["a", "b"], "unknown" as "left")).toThrow("INVALID_ALIGNMENT");
  expect(() => distributeSceneLayers(project, ["a", "b"], "unknown" as "horizontal")).toThrow("INVALID_DISTRIBUTION");
  const parent = node("parent", 0, 0);
  parent.slots.content = [node("child", 10, 0)];
  expect(() => alignSceneLayers(projectWith([parent]), ["parent", "child"], "left")).toThrow("INSUFFICIENT_SELECTION");
});

it("keeps generated geometry batches atomic under stale locks and invalid coordinates", () => {
  const project = projectWith([node("a", 0, 0), node("b", 30, 0)]);
  const operations = translateSceneLayers(project, ["b", "a"], { x: 5, y: 8 });
  const locked = structuredClone(project);
  locked.pages[0].nodes[1].locked = true;
  const snapshot = structuredClone(locked);
  expect(() => apply(locked, operations)).toThrow("NODE_LOCKED");
  expect(locked).toEqual(snapshot);
  expect(() => apply(project, translateSceneLayers(project, ["a", "b"], { x: 1_000_000, y: 0 }))).toThrow("INVALID_SCENE");
  expect(project.pages[0].nodes[0].scene!.x).toBe(0);
  expect(project.revision).toBe(0);
});

it("persists one geometry batch and undoes/redoes it as one transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-geometry-"));
  const initial = projectWith([node("a", 0, 0), node("b", 30, 0)]);
  const store = await ProjectStore.open(root, { initialProject: initial });
  try {
    const moved = await store.apply({ requestId: "geometry", baseRevision: 0,
      operations: translateSceneLayers(initial, ["a", "b"], { x: 12, y: -7 }) });
    expect(moved.revision).toBe(1);
    expect(JSON.parse(await readFile(join(root, "project.json"), "utf8"))).toEqual(moved);
    const undone = await store.undo("undo-geometry", 1);
    expect(undone).toEqual({ ...initial, revision: 2 });
    const redone = await store.redo("redo-geometry", 2);
    expect(redone).toEqual({ ...moved, revision: 3 });
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
