import { expect, it } from "vitest";
import { applyBatch } from "./operations";
import { parseProject, type ProjectNode } from "./project";
import { sceneProject, componentProject } from "./scene-fixtures";
import { sceneLayers, transformPoint, type LinearTransform } from "./scene";
import {
  getTransformFrame,
  transformFramePivot,
  scaleSceneLayersInBasis,
  scaleSceneLayers,
  rotateSceneLayers,
  resizeSceneLayer,
  resizeSceneLayers,
} from "./affine-geometry";
function node(id: string, x = 0, y = 0): ProjectNode {
  return {
    id,
    type: "SceneFrame",
    props: {},
    slots: {},
    scene: { kind: "frame", x, y, width: 20, height: 10 },
  };
}
function fixture(nodes: ProjectNode[]) {
  const p = parseProject(sceneProject());
  p.pages[0].nodes = nodes;
  return parseProject(p);
}
function expectPoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
}
it("captures independent roots in document order with isolated matrices and world AABB", () => {
  const a = node("a", 100, 50);
  a.scene!.linearTransform = [-2, 0, 1, 3];
  a.slots.content = [node("child", 2, 3)];
  const b = node("b", 200, 100);
  const p = fixture([a, b]);
  const frame = getTransformFrame(p, ["b", "child", "a", "a"]);
  expect(frame).toEqual({
    pageId: "home",
    rootIds: ["a", "b"],
    roots: [
      { id: "a", width: 20, height: 10, world: [-2, 0, 1, 3, 100, 50] },
      { id: "b", width: 20, height: 10, world: [1, 0, 0, 1, 200, 100] },
    ],
    bounds: { x: 60, y: 50, width: 160, height: 60 },
  });
  a.scene!.linearTransform[0] = 99;
  expect(frame.roots[0].world[0]).toBe(-2);
  frame.roots[0].world[0] = 123;
  expect(p.pages[0].nodes[0].scene!.linearTransform![0]).toBe(-2);
});
it.each([0, 0.5, 1].flatMap((x) => [0, 0.5, 1].map((y) => ({ x, y }))))(
  "resolves singleton anchor $x,$y in reflected/sheared local basis",
  (anchor) => {
    const n = node("n", 100, 50);
    n.scene!.linearTransform = [-2, 1, 0.5, 3];
    const frame = getTransformFrame(fixture([n]), ["n"]);
    expectPoint(transformFramePivot(frame, anchor), {
      x: 100 - 40 * anchor.x + 5 * anchor.y,
      y: 50 + 20 * anchor.x + 30 * anchor.y,
    });
  },
);
it("uses multi AABB anchor and validates normalized anchor before calculating pivot", () => {
  const p = fixture([node("a", 10, 20), node("b", 100, 80)]),
    frame = getTransformFrame(p, ["a", "b"]);
  expectPoint(transformFramePivot(frame, { x: 0.5, y: 1 }), { x: 65, y: 90 });
  for (const anchor of [
    { x: -1, y: 0 },
    { x: 1.1, y: 0 },
    { x: 0, y: NaN },
  ])
    expect(() => transformFramePivot(frame, anchor)).toThrow(
      "INVALID_TRANSFORM",
    );
});
it("scales a singleton in its captured reflected/sheared world basis across affine parent, preserving layout and children", () => {
  const parent = node("parent", 100, 50);
  parent.scene!.linearTransform = [2, 1, 0.5, 3];
  const child = node("child", 4, 6);
  child.scene!.linearTransform = [-1, 0.25, 1, 1];
  child.slots.content = [node("leaf", 2, 3)];
  parent.slots.content = [child];
  const p = fixture([parent]);
  // W columns=(-1.875,-.25),(2.5,4), translation=(111,72).
  const basis: LinearTransform = [-1.875, -0.25, 2.5, 4],
    pivot = { x: 104.75, y: 89.5 };
  const operations = scaleSceneLayersInBasis(p, ["child"], 2, 3, pivot, basis);
  const next = applyBatch(p, {
    requestId: "basis",
    baseRevision: 0,
    operations,
  });
  const layer = sceneLayers(next.pages[0].nodes).find(
    (l) => l.node.id === "child",
  )!;
  // Anchor=(10,5) stays fixed. New columns=(-3.75,-.5),(7.5,12).

  // Independently evaluate p + B*diag(2,3)*(corner-anchor).
  const corners = [
    [0, 0],
    [20, 0],
    [20, 10],
    [0, 10],
  ];
  corners.forEach(([x, y]) =>
    expectPoint(transformPoint({ x, y }, layer.transform), {
      x: 104.75 - 3.75 * (x - 10) + 7.5 * (y - 5),
      y: 89.5 - 0.5 * (x - 10) + 12 * (y - 5),
    }),
  );
  expect(next.pages[0].nodes[0].slots.content[0].scene).toMatchObject({
    width: 20,
    height: 10,
  });
  expect(next.pages[0].nodes[0].slots.content[0].slots).toEqual(child.slots);
  expect(operations).toHaveLength(1);
});
it("uses identity basis for multi world Scale and supports explicit flip in local axes", () => {
  const n = node("n", 10, 20);
  n.scene!.rotation = 90;
  const p = fixture([n, node("b", 80, 100)]);
  expect(
    scaleSceneLayersInBasis(p, ["n", "b"], 2, 3, { x: 5, y: 7 }, [1, 0, 0, 1]),
  ).toEqual(scaleSceneLayers(p, ["n", "b"], 2, 3, { x: 5, y: 7 }));
  const next = applyBatch(p, {
    requestId: "flip",
    baseRevision: 0,
    operations: scaleSceneLayersInBasis(
      p,
      ["n"],
      -1,
      1,
      { x: 10, y: 20 },
      [0, 1, -1, 0],
    ),
  });
  const matrix = sceneLayers(next.pages[0].nodes)[0].transform;
  expectPoint(transformPoint({ x: 20, y: 10 }, matrix), { x: 0, y: 0 });
});
it.each(
  [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [Infinity, 0, 0, 1],
  ].map((basis) => ({ basis })),
)(
  "rejects singular/nonfinite basis $basis even for identity Scale",
  ({ basis }) => {
    expect(() =>
      scaleSceneLayersInBasis(
        fixture([node("n")]),
        ["n"],
        1,
        1,
        { x: 0, y: 0 },
        basis as LinearTransform,
      ),
    ).toThrow("INVALID_TRANSFORM");
  },
);
it("valid identity transformations emit no operations and preserve legacy representation", () => {
  const parent = node("parent", 40, 50);
  parent.scene!.linearTransform = [2, 0.5, 0.25, 3];
  const child = node("child", 10, 20);
  child.scene!.rotation = 37;
  parent.slots.content = [child];
  const p = fixture([parent]),
    pivot = { x: 100, y: 100 };
  expect(scaleSceneLayers(p, ["child"], 1, 1, pivot)).toEqual([]);
  expect(
    scaleSceneLayersInBasis(p, ["child"], 1, 1, pivot, [2, 1, 0.5, 1]),
  ).toEqual([]);
  expect(rotateSceneLayers(p, ["child"], 360, pivot)).toEqual([]);
  expect(rotateSceneLayers(p, ["child"], -720, pivot)).toEqual([]);
  expect(resizeSceneLayer(p, "child", 20, 10, { x: 1, y: 1 })).toEqual([]);
  expect(resizeSceneLayers(p, ["child"], 1, 1, pivot)).toEqual([]);
  expect(p.pages[0].nodes[0].slots.content[0].scene).not.toHaveProperty(
    "linearTransform",
  );
});
it("validates selection and displayed locks before returning no-op", () => {
  const p = parseProject(componentProject());
  p.designComponents![0].nodes[0].locked = true;
  for (const action of [
    () => getTransformFrame(p, ["instance"]),
    () => scaleSceneLayers(p, ["instance"], 1, 1, { x: 0, y: 0 }),
    () =>
      scaleSceneLayersInBasis(
        p,
        ["instance"],
        1,
        1,
        { x: 0, y: 0 },
        [1, 0, 0, 1],
      ),
    () => rotateSceneLayers(p, ["instance"], 360, { x: 0, y: 0 }),
    () => resizeSceneLayer(p, "instance", 200, 80),
  ])
    expect(action).toThrow("NODE_LOCKED");
  expect(() =>
    scaleSceneLayers(fixture([node("n")]), ["missing"], 1, 1, { x: 0, y: 0 }),
  ).toThrow("NODE_NOT_FOUND");
});

it("scales rotated local axes rather than world axes, and filters selected children only once", () => {
  const n = node("parent", 10, 20);
  n.scene!.rotation = 90;
  n.slots.content = [node("child", 2, 3)];
  const p = fixture([n]);
  const frame = getTransformFrame(p, ["child", "parent"]),
    pivot = transformFramePivot(frame, { x: 0, y: 0 });
  const operations = scaleSceneLayersInBasis(
    p,
    ["child", "parent"],
    2,
    3,
    pivot,
    [0, 1, -1, 0],
  );
  expect(operations).toHaveLength(1);
  expect(operations[0]).toMatchObject({ nodeId: "parent" });
  const next = applyBatch(p, {
    requestId: "rotated-local",
    baseRevision: 0,
    operations,
  });
  const layers = sceneLayers(next.pages[0].nodes);
  expectPoint(transformPoint({ x: 20, y: 10 }, layers[0].transform), {
    x: -20,
    y: 60,
  });
  expectPoint(transformPoint({ x: 0, y: 0 }, layers[1].transform), {
    x: 1,
    y: 24,
  });
  expect(next.pages[0].nodes[0].slots.content[0]).toEqual(n.slots.content[0]);
});
it("does not suppress an actual small transform as a no-op", () => {
  const n = node("n", 100, 100);
  n.scene!.rotation = 37;
  const p = fixture([n]);
  expect(
    scaleSceneLayersInBasis(
      p,
      ["n"],
      1.000001,
      1,
      { x: 0, y: 0 },
      [1, 0, 0, 1],
    ),
  ).toHaveLength(1);
  expect(rotateSceneLayers(p, ["n"], 0.000001, { x: 0, y: 0 })).toHaveLength(1);
  expect(resizeSceneLayer(p, "n", 20.000001, 10)).toHaveLength(1);
});
it("validates every requested ID and rejects mixed-page transform frames", () => {
  const p = fixture([node("a")]);
  p.pages.push({
    screenId: "other",
    name: "Other",
    viewport: { width: 800 },
    nodes: [node("b")],
  });
  expect(() => getTransformFrame(p, ["a", "b"])).toThrow(
    "MIXED_PAGE_SELECTION",
  );
  expect(() => getTransformFrame(p, [])).toThrow("INSUFFICIENT_SELECTION");
  expect(() => getTransformFrame(p, ["a", "missing"])).toThrow(
    "NODE_NOT_FOUND",
  );
});
