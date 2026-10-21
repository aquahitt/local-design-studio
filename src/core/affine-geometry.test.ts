import { expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProject, stableStringify, type ProjectNode } from "./project";
import { applyBatch, type Operation } from "./operations";
import { sceneProject, componentProject } from "./scene-fixtures";
import {
  inverseTransform,
  transformPoint,
  sceneLayers,
  hitTestScene,
  type Matrix,
} from "./scene";
import {
  scaleSceneLayers,
  rotateSceneLayers,
  resizeSceneLayer,
  resizeSceneLayers,
} from "./affine-geometry";
import { ProjectStore } from "./store";

function node(id: string, x = 0, y = 0): ProjectNode {
  return {
    id,
    type: "SceneFrame",
    props: { retained: true },
    slots: {},
    scene: { kind: "frame", x, y, width: 20, height: 10, fill: "#abc" },
  };
}
function fixture(nodes: ProjectNode[]) {
  const p = parseProject(sceneProject());
  p.pages[0].nodes = nodes;
  return parseProject(p);
}
function apply(p: ReturnType<typeof fixture>, operations: Operation[]) {
  return applyBatch(p, {
    requestId: "affine",
    baseRevision: p.revision,
    operations,
  });
}
function corners(p: ReturnType<typeof fixture>, id: string) {
  const l = sceneLayers(p.pages[0].nodes).find((l) => l.node.id === id)!;
  return [
    [0, 0],
    [l.node.scene!.width, 0],
    [l.node.scene!.width, l.node.scene!.height],
    [0, l.node.scene!.height],
  ].map(([x, y]) => transformPoint({ x, y }, l.transform));
}
function close(
  actual: { x: number; y: number }[],
  expected: { x: number; y: number }[],
) {
  actual.forEach((p, i) => {
    expect(p.x).toBeCloseTo(expected[i].x, 8);
    expect(p.y).toBeCloseTo(expected[i].y, 8);
  });
}

it("round trips legacy without materializing affine fields, and supports nested shear/reflection picking geometry", () => {
  const old = fixture([node("legacy")]);
  expect(parseProject(old)).toEqual(old);
  expect(
    stableStringify(apply(old, [{ type: "setTheme", theme: "dark" }])),
  ).not.toContain("linearTransform");
  const parent = node("parent", 100, 50);
  parent.scene!.linearTransform = [2, 1, 0.5, 3];
  const child = node("child", 4, 6);
  child.scene!.linearTransform = [-1, 0, 1, 1];
  parent.slots.content = [child];
  const p = fixture([parent]);
  // parent * child: translation (111,72), columns (-2,-1),(2.5,4)
  close(corners(p, "child"), [
    { x: 111, y: 72 },
    { x: 71, y: 52 },
    { x: 96, y: 92 },
    { x: 136, y: 112 },
  ]);
});
it.each(
  [
    [0, 0, 0, 0],
    [1, 0, 1, 0],
    [Infinity, 0, 0, 1],
    [1e7, 0, 0, 1],
    [1e-7, 0, 0, 1],
    [1e6, 0, 0, 1e-6],
    [1, 0, 0],
    [1, 0, 0, 1, 0],
  ].map((linearTransform) => ({ linearTransform })),
)(
  "rejects invalid or unstable explicit linear transforms $linearTransform",
  ({ linearTransform }) => {
    const p = sceneProject();
    Object.assign(p.pages[0].nodes[0].scene!, { linearTransform });
    expect(() => parseProject(p)).toThrow(/INVALID_SCENE|INVALID_JSON/);
  },
);
it("rejects rotation plus matrix and accepts reflection and bounded small uniform scale", () => {
  const n = node("n");
  n.scene!.linearTransform = [-2, 0, 0, 3];
  expect(() => fixture([n])).not.toThrow();
  n.scene!.rotation = 0;
  expect(() => fixture([n])).toThrow("INVALID_SCENE");
  delete n.scene!.rotation;
  n.scene!.linearTransform = [1e-6, 0, 0, 1e-6];
  expect(() => fixture([n])).not.toThrow();
});
it("inverts extreme uniform composed transforms without determinant underflow or overflow", () => {
  for (const scale of [1e-200, 1e200]) {
    const m: Matrix = [scale, 0, 0, -scale, 0, 0];
    const inv = inverseTransform(m);
    expect(inv.every(Number.isFinite)).toBe(true);
    close(
      [transformPoint(transformPoint({ x: 2, y: 3 }, m), inv)],
      [{ x: 2, y: 3 }],
    );
  }
  expect(() => inverseTransform([1, 1, 1, 1, 0, 0])).toThrow(
    "INVALID_TRANSFORM",
  );
});
it("replaces only geometry, removes old representation and preserves styling, child and IDs", () => {
  const n = node("n");
  n.scene!.rotation = 30;
  n.slots.content = [node("child")];
  const p = fixture([n]);
  const next = apply(p, [
    {
      type: "setNodeGeometry",
      nodeId: "n",
      geometry: {
        x: 4,
        y: 5,
        width: 30,
        height: 40,
        linearTransform: [1, 0.5, 0, 1],
      },
    },
  ]);
  const changed = next.pages[0].nodes[0];
  expect(changed.scene).toEqual({
    kind: "frame",
    fill: "#abc",
    x: 4,
    y: 5,
    width: 30,
    height: 40,
    linearTransform: [1, 0.5, 0, 1],
  });
  expect(changed.slots).toEqual(n.slots);
  expect(changed.props).toEqual(n.props);
  const back = apply(next, [
    {
      type: "setNodeGeometry",
      nodeId: "n",
      geometry: { x: 0, y: 0, width: 20, height: 10, rotation: 12 },
    },
  ]);
  expect(back.pages[0].nodes[0].scene).not.toHaveProperty("linearTransform");
  expect(p.pages[0].nodes[0].scene!.rotation).toBe(30);
});
it("protects locked ancestors and descendants through new and legacy geometry writes and rolls back invalid batches", () => {
  const parent = node("parent");
  const child = node("child");
  child.locked = true;
  parent.slots.content = [child];
  const p = fixture([parent]);
  for (const op of [
    {
      type: "setNodeGeometry",
      nodeId: "parent",
      geometry: {
        x: 1,
        y: 0,
        width: 20,
        height: 10,
        linearTransform: [1, 0, 0, 1],
      },
    },
    {
      type: "setNodeMetadata",
      nodeId: "parent",
      scene: { linearTransform: [1, 0.5, 0, 1] },
    },
  ] as Operation[])
    expect(() => apply(p, [op])).toThrow("NODE_LOCKED");
  parent.locked = true;
  child.locked = false;
  expect(() =>
    apply(fixture([parent]), [
      {
        type: "setNodeGeometry",
        nodeId: "child",
        geometry: { x: 1, y: 0, width: 20, height: 10 },
      },
    ]),
  ).toThrow("NODE_LOCKED");
  const clean = fixture([node("n")]);
  const snapshot = structuredClone(clean);
  expect(() =>
    apply(clean, [
      { type: "setNodeMetadata", nodeId: "n", name: "changed" },
      {
        type: "setNodeGeometry",
        nodeId: "n",
        geometry: {
          x: 0,
          y: 0,
          width: 20,
          height: 10,
          linearTransform: [0, 0, 0, 0],
        },
      },
    ]),
  ).toThrow();
  expect(clean).toEqual(snapshot);
});
it("world Scale/Rotate transform all corners once across affine parents, preserving layout and child geometry", () => {
  const parent = node("parent", 40, 30);
  parent.scene!.linearTransform = [2, 0.3, 0.5, 1];
  const nested = node("nested", 7, 8);
  nested.scene!.rotation = 37;
  parent.slots.content = [nested];
  const outside = node("outside", 100, 80);
  outside.scene!.linearTransform = [-1, 0.2, 0.4, 1];
  const p = fixture([parent, outside]);
  const pivot = { x: 20, y: 10 };
  const scaled = apply(
    p,
    scaleSceneLayers(p, ["nested", "parent", "outside"], 2, 3, pivot),
  );
  for (const id of ["parent", "nested", "outside"])
    close(
      corners(scaled, id),
      corners(p, id).map((q) => ({
        x: pivot.x + 2 * (q.x - pivot.x),
        y: pivot.y + 3 * (q.y - pivot.y),
      })),
    );
  expect(scaled.pages[0].nodes[0].slots.content[0]).toEqual(nested);
  expect(scaled.pages[0].nodes[0].scene!.width).toBe(20);
  const rotated = apply(
    p,
    rotateSceneLayers(p, ["nested", "outside"], 90, pivot),
  );
  for (const id of ["nested", "outside"])
    close(
      corners(rotated, id),
      corners(p, id).map((q) => ({
        x: pivot.x - (q.y - pivot.y),
        y: pivot.y + (q.x - pivot.x),
      })),
    );
});
it("single Resize fixes normalized local anchor and preserves linear transform and local children", () => {
  const n = node("n", 100, 50);
  n.scene!.linearTransform = [2, 1, 0.5, 3];
  n.slots.content = [node("child", 2, 3)];
  const p = fixture([n]);
  const resized = apply(p, resizeSceneLayer(p, "n", 40, 30, { x: 1, y: 1 }));
  const s = resized.pages[0].nodes[0].scene!;
  expect(s).toMatchObject({
    x: 50,
    y: -30,
    width: 40,
    height: 30,
    linearTransform: [2, 1, 0.5, 3],
  });
  expect(resized.pages[0].nodes[0].slots).toEqual(n.slots);
  close([corners(resized, "n")[2]], [corners(p, "n")[2]]);
});
it("multi Resize absorbs positive world column ratios into layout boxes while preserving exact target quads", () => {
  const parent = node("p", 10, 20);
  parent.scene!.linearTransform = [2, 0.2, 0.5, 1];
  const a = node("a", 3, 4);
  a.scene!.rotation = 35;
  parent.slots.content = [a];
  const b = node("b", 80, 90);
  b.scene!.linearTransform = [-1, 0.4, 0.3, 2];
  const p = fixture([parent, b]);
  const next = apply(p, resizeSceneLayers(p, ["a", "b"], 2, 3, { x: 5, y: 7 }));
  for (const id of ["a", "b"])
    close(
      corners(next, id),
      corners(p, id).map((q) => ({
        x: 5 + (q.x - 5) * 2,
        y: 7 + (q.y - 7) * 3,
      })),
    );
  expect(next.pages[0].nodes[0].slots.content[0].scene!.width).not.toBe(20);
  expect(() => resizeSceneLayers(p, ["a"], -1, 2, { x: 0, y: 0 })).toThrow();
});
it("persists affine batches with receipt, conflict, single undo/redo and restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-affine-"));
  let store: ProjectStore | undefined;
  try {
    store = await ProjectStore.open(root, {
      initialProject: fixture([node("n")]),
    });
    const batch = {
      requestId: "affine-durable",
      baseRevision: 0,
      operations: scaleSceneLayers(store.read(), ["n"], 2, 3, { x: 0, y: 0 }),
    };
    await store.apply(batch);
    expect((await store.apply(batch)).revision).toBe(1);
    await expect(store.apply({ ...batch, requestId: "stale" })).rejects.toThrow(
      "REVISION_CONFLICT",
    );
    await store.undo("undo-affine", 1);
    expect(store.read().pages[0].nodes[0].scene).not.toHaveProperty(
      "linearTransform",
    );
    await store.redo("redo-affine", 2);
    const saved = store.read();
    await store.close();
    store = await ProjectStore.open(root);
    expect(store.read()).toEqual(saved);
    expect(
      JSON.parse(await readFile(join(root, "project.json"), "utf8")),
    ).toEqual(saved);
    expect((await store.apply(batch)).revision).toBe(1);
  } finally {
    await store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("picks reflected/sheared boxes in local coordinates and respects affine ancestor clips", () => {
  const frame = node("frame", 100, 50);
  frame.scene!.linearTransform = [2, 1, 0.5, 3];
  frame.scene!.clip = true;
  const child = node("child", 0, 0);
  child.scene!.linearTransform = [-1, 0, 0, 1];
  frame.slots.content = [child];
  const p = fixture([frame]);
  // Child local(10,5) => parent(-10,5), outside parent's clip.
  expect(hitTestScene(p.pages[0].nodes, { x: 82.5, y: 55 })).toBeUndefined();
  frame.scene!.clip = false;
  expect(
    hitTestScene(fixture([frame]).pages[0].nodes, { x: 82.5, y: 55 }),
  ).toBe("child");
});
it("supports explicit scale reflection and single legacy Resize without adding matrix fields", () => {
  const n = node("n", 10, 20);
  n.scene!.rotation = 90;
  const p = fixture([n]);
  const reflected = apply(p, scaleSceneLayers(p, ["n"], -2, 3, { x: 0, y: 0 }));
  close(
    corners(reflected, "n"),
    corners(p, "n").map((q) => ({ x: -2 * q.x, y: 3 * q.y })),
  );
  const resized = apply(
    p,
    resizeSceneLayer(p, "n", 40, 20, { x: 0.5, y: 0.5 }),
  );
  expect(resized.pages[0].nodes[0].scene).toMatchObject({
    rotation: 90,
    width: 40,
    height: 20,
  });
  expect(resized.pages[0].nodes[0].scene).not.toHaveProperty("linearTransform");
  close(
    [
      {
        x: (corners(p, "n")[0].x + corners(p, "n")[2].x) / 2,
        y: (corners(p, "n")[0].y + corners(p, "n")[2].y) / 2,
      },
    ],
    [
      {
        x: (corners(resized, "n")[0].x + corners(resized, "n")[2].x) / 2,
        y: (corners(resized, "n")[0].y + corners(resized, "n")[2].y) / 2,
      },
    ],
  );
});
it.each([
  { x: 0, y: 0, width: 10 },
  { x: 0, y: 0, width: 10, height: 10, fill: "red" },
  {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    linearTransform: [1, 0, 0, 1],
  },
])(
  "rejects partial, nongeometry, and mutually exclusive operation fields %j",
  (geometry) => {
    const p = fixture([node("n")]);
    expect(() =>
      apply(p, [
        { type: "setNodeGeometry", nodeId: "n", geometry } as Operation,
      ]),
    ).toThrow();
  },
);
it("accepts condition bound inclusively and rejects ill-conditioning even with individually bounded coefficients", () => {
  const n = node("n");
  n.scene!.linearTransform = [1e4, 0, 0, 1e-4];
  expect(() => fixture([n])).not.toThrow();
  n.scene!.linearTransform = [1e4, 0, 0, 0.00009];
  expect(() => fixture([n])).toThrow("INVALID_SCENE");
});

function chain(scale: number, depth: number) {
  const first = node("chain-0");
  let current = first;
  for (let i = 0; i < depth; i++) {
    current.scene!.linearTransform = [scale, 0, 0, scale];
    if (i < depth - 1) {
      const next = node(`chain-${i + 1}`);
      current.slots.content = [next];
      current = next;
    }
  }
  return first;
}
it.each([1e6, 1e-6])(
  "rejects unrepresentable accumulated affine matrices with scale %j before writing",
  (scale) => {
    expect(() => fixture([chain(scale, 54)])).toThrow("INVALID_TRANSFORM");
  },
);
it("allows deep benign affine chains and robust inversion of representable composed matrices", () => {
  const p = fixture([chain(2, 54)]);
  const leaf = sceneLayers(p.pages[0].nodes).at(-1)!;
  const local = { x: 3, y: 7 };
  close(
    [
      transformPoint(
        transformPoint(local, leaf.transform),
        inverseTransform(leaf.transform),
      ),
    ],
    [local],
  );
});
it("validates accumulated affine inside unused definitions and materialized nested instances", () => {
  const p = fixture([node("host")]);
  p.designComponents = [
    { id: "definition", name: "Def", version: 1, nodes: [chain(1e6, 54)] },
  ];
  expect(() => parseProject(p)).toThrow("INVALID_TRANSFORM");
  const q = fixture([node("host")]);
  q.pages[0].nodes[0].props = {};
  q.pages[0].nodes[0].instance = { definitionId: "d0" };
  q.designComponents = Array.from({ length: 54 }, (_, i) => {
    const n = node(`instance-${i}`);
    n.scene!.linearTransform = [1e6, 0, 0, 1e6];
    n.props = {};
    if (i < 53) n.instance = { definitionId: `d${i + 1}` };
    return { id: `d${i}`, name: `Def ${i}`, version: 1, nodes: [n] };
  });
  expect(() => parseProject(q)).toThrow("INVALID_TRANSFORM");
});
it("rolls back the entire batch when individually valid geometry makes accumulated world transform unrepresentable", () => {
  const p = fixture([chain(1e6, 51)]);
  let leaf = p.pages[0].nodes[0];
  while (leaf.slots.content?.length) leaf = leaf.slots.content[0];
  leaf.slots.content = [];
  const snapshot = structuredClone(p);
  expect(() =>
    apply(p, [
      { type: "setNodeMetadata", nodeId: "chain-0", name: "must rollback" },
      {
        type: "insertNode",
        pageId: "home",
        parentId: "chain-50",
        slot: "content",
        index: 0,
        node: {
          ...node("overflow"),
          scene: {
            kind: "frame",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            linearTransform: [1e6, 0, 0, 1e6],
          },
        },
      },
    ]),
  ).toThrow("INVALID_TRANSFORM");
  expect(p).toEqual(snapshot);
});

it("inverts representable anisotropic composed matrices without normalizing the small column away", () => {
  const m: Matrix = [1e200, 0, 0, 1e-200, 0, 0];
  const inverse = inverseTransform(m);
  close(
    [transformPoint(transformPoint({ x: 2, y: 3 }, m), inverse)],
    [{ x: 2, y: 3 }],
  );
});

it("rejects affine world quads whose matrix is representable but layout corners overflow", () => {
  const root = chain(1e6, 51);
  let leaf = root;
  while (leaf.slots.content?.length) leaf = leaf.slots.content[0];
  leaf.scene!.width = 1e6;
  expect(() => fixture([root])).toThrow("INVALID_TRANSFORM");
});

function lockedInstance(nested = false) {
  const p = parseProject(componentProject());
  p.designComponents![0].nodes[0].locked = true;
  if (nested) {
    p.designComponents!.push({
      id: "outer",
      name: "Outer",
      version: 1,
      nodes: [
        {
          id: "nested-instance",
          type: "SceneComponent",
          props: {},
          slots: {},
          scene: { kind: "component", x: 5, y: 6, width: 220, height: 100 },
          instance: { definitionId: "button" },
        },
      ],
    });
    p.pages[0].nodes[0].instance = { definitionId: "outer" };
  }
  return parseProject(p);
}
it.each([false, true])(
  "protects displayed locked descendants through %s nested definitions in all affine helpers",
  (nested) => {
    const p = lockedInstance(nested),
      pivot = { x: 0, y: 0 };
    for (const action of [
      () => scaleSceneLayers(p, ["instance"], 2, 2, pivot),
      () => rotateSceneLayers(p, ["instance"], 45, pivot),
      () => resizeSceneLayers(p, ["instance"], 2, 2, pivot),
      () => resizeSceneLayer(p, "instance", 400, 160),
    ])
      expect(action).toThrow("NODE_LOCKED");
  },
);
it.each([false, true])(
  "blocks direct and legacy geometry writes around displayed locked descendants, retaining name/paint and no-op geometry (%s)",
  (nested) => {
    const p = lockedInstance(nested),
      snapshot = structuredClone(p),
      scene = p.pages[0].nodes[0].scene!;
    for (const operation of [
      {
        type: "setNodeGeometry",
        nodeId: "instance",
        geometry: {
          x: 100,
          y: 50,
          width: 200,
          height: 80,
          linearTransform: [2, 0, 0, 2],
        },
      },
      { type: "setNodeMetadata", nodeId: "instance", scene: { x: 120 } },
      {
        type: "setNodeMetadata",
        nodeId: "instance",
        scene: { linearTransform: [2, 0, 0, 2] },
      },
      { type: "moveNode", nodeId: "instance", pageId: "home", index: 0 },
      { type: "removeNode", nodeId: "instance" },
    ] as Operation[])
      expect(() => apply(p, [operation])).toThrow("NODE_LOCKED");
    const next = apply(p, [
      {
        type: "setNodeMetadata",
        nodeId: "instance",
        name: "Allowed",
        scene: { fill: "#abc" },
      },
      {
        type: "setNodeGeometry",
        nodeId: "instance",
        geometry: {
          x: scene.x,
          y: scene.y,
          width: scene.width,
          height: scene.height,
        },
      },
    ]);
    expect(next.pages[0].nodes[0].name).toBe("Allowed");
    expect(next.pages[0].nodes[0].scene!.fill).toBe("#abc");
    expect(p).toEqual(snapshot);
  },
);
