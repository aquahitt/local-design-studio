import { expect, it } from "vitest";
import { parseProject, migrateProject } from "./project";
import { applyBatch } from "./operations";

import { sceneProject } from "./scene-fixtures";

it("round trips optional scene metadata without changing IDs, groups or viewport", () => {
  const input = sceneProject();
  expect(parseProject(input)).toEqual(input);
});

it.each([
  { x: Infinity },
  { width: -1 },
  { kind: "script" },
  { opacity: 2 },
  { path: '<svg onload="alert(1)">' },
  { clip: "yes" },
  { unknown: true },
])("rejects malformed scene metadata", (patch) => {
  const input = sceneProject();
  Object.assign(input.pages[0].nodes[0].scene, patch);
  expect(() => parseProject(input)).toThrow();
});

it("preserves schema1 component data and IDs during migration", () => {
  const input = {
    schemaVersion: 1,
    screenId: "old",
    name: "Old",
    revision: 3,
    viewport: { width: 800 },
    nodes: [{ id: "text", type: "Text", props: { text: "Hi" }, slots: {} }],
  };
  const migrated = migrateProject(input);
  expect(migrated.pages[0].nodes).toEqual(input.nodes);
  expect(migrated.pages[0].viewport).toEqual(input.viewport);
  expect(migrated.revision).toBe(3);
  expect(migrated).not.toHaveProperty("designComponents");
});

it("updates metadata through the shared batch engine", () => {
  const initial = parseProject(sceneProject());
  const next = applyBatch(initial, {
    requestId: "metadata",
    baseRevision: 0,
    operations: [
      {
        type: "setNodeMetadata",
        nodeId: "label",
        name: "Title",
        hidden: true,
        scene: { x: 25 },
      },
    ],
  } as any);
  expect(next.pages[0].nodes[0].slots.content[0]).toMatchObject({
    name: "Title",
    hidden: true,
    scene: { x: 25, y: 20 },
  });
  expect(initial.pages[0].nodes[0].slots.content[0]).not.toHaveProperty("name");
});

it("protects locked ancestors from edit, move, remove and insertion", () => {
  const input = sceneProject();
  input.pages[0].nodes[0].locked = true;
  const initial = parseProject(input);
  const ops = [
    { type: "updateProps", nodeId: "label", props: { text: "Changed" } },
    { type: "moveNode", nodeId: "label", pageId: "home", index: 0 },
    { type: "removeNode", nodeId: "frame" },
    {
      type: "insertNode",
      pageId: "home",
      parentId: "frame",
      slot: "content",
      index: 0,
      node: { id: "new", type: "Unknown", props: {}, slots: {} },
    },
  ];
  for (const op of ops)
    expect(() =>
      applyBatch(initial, {
        requestId: "locked",
        baseRevision: 0,
        operations: [op],
      } as any),
    ).toThrow("NODE_LOCKED");
  expect(
    applyBatch(initial, {
      requestId: "unlock",
      baseRevision: 0,
      operations: [{ type: "setNodeMetadata", nodeId: "frame", locked: false }],
    } as any).pages[0].nodes[0].locked,
  ).toBe(false);
});

import * as sceneModule from "./scene";
it.each([0.25, 1, 2, 4])(
  "keeps screen/world coordinates and hit testing consistent at zoom %s",
  (zoom) => {
    const api = sceneModule;
    const view = { zoom, panX: 83, panY: -15 };
    const point = { x: 65, y: 60 };
    expect(api.screenToWorld(api.worldToScreen(point, view), view)).toEqual(
      point,
    );
    const nodes = parseProject(sceneProject()).pages[0].nodes;
    expect(
      api.hitTestScene(
        nodes,
        api.screenToWorld(api.worldToScreen(point, view), view),
      ),
    ).toBe("label");
  },
);

it("hits the top painted layer, respects parent transforms/clips, and skips hidden/locked layers", () => {
  const api = sceneModule;
  const input = sceneProject();
  const frame = input.pages[0].nodes[0];
  frame.slots.content.push({ ...frame.slots.content[0], id: "overlap" });
  const nodes = parseProject(input).pages[0].nodes;
  expect(api.hitTestScene(nodes, { x: 65, y: 60 })).toBe("overlap");
  nodes[0].slots.content[2].hidden = true;
  expect(api.hitTestScene(nodes, { x: 65, y: 60 })).toBe("label");
  nodes[0].slots.content[0].locked = true;
  expect(api.hitTestScene(nodes, { x: 65, y: 60 })).toBe("frame");
  nodes[0].slots.content[1].scene!.x = 400;
  expect(api.hitTestScene(nodes, { x: 450, y: 80 })).toBeUndefined();
  nodes[0].scene!.rotation = 90;
  nodes[0].slots.content[0].locked = false;
  expect(api.hitTestScene(nodes, { x: 10, y: 55 })).toBe("label");
  nodes[0].hidden = true;
  expect(api.hitTestScene(nodes, { x: 10, y: 55 })).toBeUndefined();
});

it("rejects invalid zoom and exposes matching flattened paint order", () => {
  const api = sceneModule;
  expect(() =>
    api.screenToWorld({ x: 0, y: 0 }, { zoom: 0, panX: 0, panY: 0 }),
  ).toThrow("INVALID_SCENE_VIEW");
  expect(
    api
      .sceneLayers(parseProject(sceneProject()).pages[0].nodes)
      .map((layer: any) => layer.node.id),
  ).toEqual(["frame", "label", "shape"]);
});
