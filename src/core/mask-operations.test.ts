import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyBatch, type Operation } from "./operations";
import { parseProject, type Project, type ProjectNode } from "./project";
import { copyLayers, duplicateLayers, pasteLayers } from "./layer-commands";
import { componentProject, sceneProject } from "./scene-fixtures";
import { unwrapMaskGroup, wrapMaskGroup } from "./mask-groups";
import { ProjectStore } from "./store";

function maskProject(): Project {
  const project = parseProject(sceneProject());
  const frame = project.pages[0].nodes[0];
  frame.type = "SceneMask";
  frame.scene = {
    kind: "mask",
    maskMode: "alpha",
    x: 40,
    y: 30,
    width: 300,
    height: 200,
  };
  frame.slots = { children: frame.slots.content };
  frame.slots.children[0].maskSource = true;
  return parseProject(project);
}
function change(sourceNodeId = "shape"): Operation {
  return { type: "setMaskSource", nodeId: "frame", sourceNodeId };
}
function apply(project: Project, operations: Operation[]) {
  return applyBatch(project, {
    requestId: "mask-change",
    baseRevision: project.revision,
    operations,
  });
}

it("changes only the source role, preserving child order, IDs and geometry", () => {
  const project = maskProject(),
    before = structuredClone(project);
  const next = apply(project, [change()]);
  const children = next.pages[0].nodes[0].slots.children;
  expect(children.map((node) => node.id)).toEqual(["label", "shape"]);
  expect(children[0]).toEqual(
    expect.not.objectContaining({ maskSource: true }),
  );
  expect(children[1]).toEqual({
    ...before.pages[0].nodes[0].slots.children[1],
    maskSource: true,
  });
  expect(children[0].scene).toEqual(
    before.pages[0].nodes[0].slots.children[0].scene,
  );
  expect(project).toEqual(before);
  expect(next.revision).toBe(1);
});

it("requires a mask group and direct membership, and rejects unknown or malformed operation fields", () => {
  const project = maskProject();
  const child = project.pages[0].nodes[0].slots.children[1];
  child.slots.content = [{ id: "nested", type: "Text", props: {}, slots: {} }];
  expect(() => apply(project, [change("nested")])).toThrow(
    "INVALID_MASK_SOURCE",
  );
  expect(() =>
    apply(project, [{ ...change(), nodeId: "shape" } as Operation]),
  ).toThrow("NODE_NOT_MASK");
  expect(() =>
    apply(project, [{ ...change(), extra: true } as unknown as Operation]),
  ).toThrow("UNKNOWN_FIELD");
  expect(() =>
    apply(project, [{ type: "setMaskSource", nodeId: "frame" } as Operation]),
  ).toThrow("INVALID_MASK_SOURCE");
  expect(() =>
    apply(project, [{ ...change(), sourceNodeId: 1 } as unknown as Operation]),
  ).toThrow("INVALID_MASK_SOURCE");
  expect(() =>
    apply(project, [
      {
        type: "setNodeMetadata",
        nodeId: "shape",
        maskSource: true,
      } as Operation,
    ]),
  ).toThrow("UNKNOWN_FIELD");
});

it.each([
  "group",
  "old-source",
  "new-source",
  "old-descendant",
  "new-descendant",
  "ancestor",
])("respects %s locks during source changes", (location) => {
  const project = maskProject(),
    mask = project.pages[0].nodes[0];
  if (location === "group") mask.locked = true;
  if (location === "old-source") mask.slots.children[0].locked = true;
  if (location === "new-source") mask.slots.children[1].locked = true;
  if (location.endsWith("descendant"))
    mask.slots.children[location === "old-descendant" ? 0 : 1].slots.content = [
      { id: "locked-child", type: "Text", props: {}, slots: {}, locked: true },
    ];
  if (location === "ancestor")
    project.pages[0].nodes = [
      {
        id: "parent",
        type: "Frame",
        props: {},
        slots: { content: [mask] },
        locked: true,
      },
    ];
  expect(() => apply(project, [change()])).toThrow("NODE_LOCKED");
});

it("rejects invalid final batches atomically and never chooses replacement sources for generic removal or move", () => {
  const project = maskProject(),
    before = structuredClone(project);
  expect(() =>
    apply(project, [change(), { type: "removeNode", nodeId: "shape" }]),
  ).toThrow();
  expect(() =>
    apply(project, [{ type: "removeNode", nodeId: "label" }]),
  ).toThrow();
  expect(() =>
    apply(project, [
      { type: "moveNode", nodeId: "label", pageId: "home", index: 1 },
    ]),
  ).toThrow();
  expect(project).toEqual(before);
  const next = apply(project, [
    change(),
    { type: "removeNode", nodeId: "label" },
  ]);
  expect(next.pages[0].nodes[0].slots.children.map((node) => node.id)).toEqual([
    "shape",
  ]);
});

it("normalizes separately copied source roots while preserving nested masks and whole-mask/page copies", () => {
  const project = maskProject(),
    outer = project.pages[0].nodes[0];
  const nested = structuredClone(outer);
  nested.id = "nested-mask";
  nested.slots.children.forEach((node) => {
    node.id = `nested-${node.id}`;
  });
  outer.slots.children[0].slots.content = [nested];
  const sourceCopy = copyLayers(project, ["label"]);
  expect(sourceCopy.nodes[0]).not.toHaveProperty("maskSource");
  expect(sourceCopy.nodes[0].slots.content[0].slots.children[0]).toHaveProperty(
    "maskSource",
    true,
  );
  expect(
    copyLayers(project, ["frame"]).nodes[0].slots.children[0],
  ).toHaveProperty("maskSource", true);
  let count = 0;
  const duplicate = apply(
    project,
    duplicateLayers(project, ["label"], () => `duplicate-${++count}`)
      .operations,
  );
  expect(
    duplicate.pages[0].nodes[0].slots.children.map((node) => !!node.maskSource),
  ).toEqual([true, false, false]);
  const pageCopy = apply(project, [
    { type: "duplicatePage", pageId: "home", newPageId: "other", name: "Copy" },
  ]);
  expect(pageCopy.pages[1].nodes[0].slots.children[0]).toHaveProperty(
    "maskSource",
    true,
  );
  // Imported clipboard roots are normalized too, including old/external clipboard payloads.
  const externalClipboard = copyLayers(project, ["label"]);
  Object.assign(externalClipboard.nodes[0], { maskSource: true });
  const pasted = apply(
    project,
    pasteLayers(
      project,
      externalClipboard,
      { pageId: "home", index: 1 },
      () => `paste-${++count}`,
    ).operations,
  );
  expect(pasted.pages[0].nodes[1]).not.toHaveProperty("maskSource");
  expect(
    pasted.pages[0].nodes[1].slots.content[0].slots.children[0],
  ).toHaveProperty("maskSource", true);
});

const stores: ProjectStore[] = [],
  roots: string[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("persists source changes through receipts, revision conflicts, undo/redo and durable reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mask-operation-"));
  roots.push(root);
  const store = await ProjectStore.open(root, {
    initialProject: maskProject(),
  });
  stores.push(store);
  const batch = {
    requestId: "source-change",
    baseRevision: 0,
    operations: [change()],
  };
  expect((await store.apply(batch)).revision).toBe(1);
  expect((await store.apply(batch)).revision).toBe(1);
  await expect(store.apply({ ...batch, requestId: "stale" })).rejects.toThrow(
    "REVISION_CONFLICT",
  );
  await expect(
    store.apply({ ...batch, operations: [change("label")] }),
  ).rejects.toThrow("REQUEST_ID");
  expect((await store.undo("undo-mask", 1)).revision).toBe(2);
  expect(store.read().pages[0].nodes[0].slots.children[0]).toHaveProperty(
    "maskSource",
    true,
  );
  expect((await store.redo("redo-mask", 2)).revision).toBe(3);
  await store.close();
  const reopened = await ProjectStore.open(root);
  stores.push(reopened);
  expect(reopened.read().pages[0].nodes[0].slots.children[1]).toHaveProperty(
    "maskSource",
    true,
  );
  expect((await reopened.apply(batch)).revision).toBe(1);
});

it("protects locked definition descendants when an instance is either the old or new source", () => {
  const project = maskProject(),
    components = parseProject(componentProject());
  components.designComponents![0].nodes[0].locked = true;
  project.designComponents = components.designComponents;
  const instance = components.pages[0].nodes[0];
  project.pages[0].nodes[0].slots.children.push(instance);
  expect(() => apply(project, [change("instance")])).toThrow("NODE_LOCKED");
  delete project.pages[0].nodes[0].slots.children[0].maskSource;
  instance.maskSource = true;
  expect(() => apply(project, [change("shape")])).toThrow("NODE_LOCKED");
});

it("stores wrap and unwrap as whole undoable batches and rejects an invalid last operation without a receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mask-group-"));
  roots.push(root);
  const initial = parseProject(sceneProject());
  const store = await ProjectStore.open(root, { initialProject: initial });
  stores.push(store);
  const wrap = {
    requestId: "wrap",
    baseRevision: 0,
    operations: wrapMaskGroup(initial, ["shape", "label"], "label", "mask"),
  };
  const wrapped = await store.apply(wrap);
  expect(
    wrapped.pages[0].nodes[0].slots.content.map((node) => node.id),
  ).toEqual(["mask"]);
  await expect(
    store.apply({
      requestId: "invalid-last",
      baseRevision: 1,
      operations: [
        ...unwrapMaskGroup(wrapped, "mask"),
        { type: "removeNode", nodeId: "missing" },
      ],
    }),
  ).rejects.toThrow("NODE_NOT_FOUND");
  expect(store.read()).toEqual(wrapped);
  const unwrap = {
    requestId: "invalid-last",
    baseRevision: 1,
    operations: unwrapMaskGroup(wrapped, "mask"),
  };
  expect((await store.apply(unwrap)).revision).toBe(2);
  expect(
    store.read().pages[0].nodes[0].slots.content.map((node) => node.id),
  ).toEqual(["label", "shape"]);
  await store.undo("undo-unwrap", 2);
  expect(
    store.read().pages[0].nodes[0].slots.content[0].slots.children[0],
  ).toHaveProperty("maskSource", true);
  await store.undo("undo-wrap", 3);
  expect(store.read().pages[0].nodes[0].slots.content).toEqual(
    initial.pages[0].nodes[0].slots.content,
  );
  await store.redo("redo-wrap", 4);
  await store.close();
  const reopened = await ProjectStore.open(root);
  stores.push(reopened);
  expect(reopened.read().revision).toBe(5);
  expect(reopened.read().pages[0].nodes[0].slots.content[0].id).toBe("mask");
  expect((await reopened.apply(wrap)).revision).toBe(1);
});

it("removes masking without dropping group compositing, ordering, identity or outer source roles", () => {
  const project = maskProject(),
    group = project.pages[0].nodes[0];
  group.scene!.opacity = 0.4;
  group.maskSource = true;
  project.pages[0].nodes = [
    {
      id: "outer",
      type: "SceneMask",
      props: {},
      scene: {
        kind: "mask",
        maskMode: "alpha",
        x: 0,
        y: 0,
        width: 500,
        height: 500,
      },
      slots: { children: [group] },
    },
  ];
  const before = structuredClone(project);
  const next = apply(project, [
    { type: "removeMask", nodeId: "frame" } as Operation,
  ]);
  const released = next.pages[0].nodes[0].slots.children[0];
  expect(released).toMatchObject({
    id: "frame",
    type: "SceneFrame",
    maskSource: true,
    scene: { kind: "frame", opacity: 0.4 },
  });
  expect(released.scene).not.toHaveProperty("maskMode");
  expect(released.slots.children.map((n) => n.id)).toEqual(
    group.slots.children.map((n) => n.id),
  );
  expect(released.slots.children.every((n) => !n.maskSource)).toBe(true);
  expect(project).toEqual(before);
});
it("refuses ungrouping a mask with group opacity instead of silently changing compositing", () => {
  const project = maskProject();
  project.pages[0].nodes[0].scene!.opacity = 0.4;
  expect(() =>
    apply(project, [{ type: "unwrapMask", nodeId: "frame" }]),
  ).toThrow("MASK_GROUP_COMPOSITING");
  const saved = structuredClone(project);
  expect(() =>
    apply(project, [
      { type: "removeMask", nodeId: "frame" } as Operation,
      { type: "removeNode", nodeId: "missing" },
    ]),
  ).toThrow();
  expect(project).toEqual(saved);
});
it("removing a mask respects descendant locks and preserves nested mask source roles", () => {
  const project = maskProject(),
    group = project.pages[0].nodes[0];
  const nested = structuredClone(group);
  nested.id = "nested";
  nested.slots.children.forEach((n) => (n.id = "nested-" + n.id));
  group.slots.children.push(nested);
  const next = apply(project, [
    { type: "removeMask", nodeId: "frame" } as Operation,
  ]);
  expect(
    next.pages[0].nodes[0].slots.children[2].slots.children[0].maskSource,
  ).toBe(true);
  group.slots.children[0].locked = true;
  expect(() =>
    apply(project, [{ type: "removeMask", nodeId: "frame" } as Operation]),
  ).toThrow("NODE_LOCKED");
});
it("source changes cannot bypass a lock on another masked content subtree", () => {
  const project = maskProject(),
    group = project.pages[0].nodes[0];
  group.slots.children.push({
    id: "locked-content",
    type: "Text",
    props: {},
    slots: {},
    locked: true,
  });
  const before = structuredClone(project);
  expect(() => apply(project, [change()])).toThrow("NODE_LOCKED");
  expect(project).toEqual(before);
});

it("rejects changing mask mode through metadata while a source or content descendant is locked, but permits an unchanged mode", () => {
  for (const index of [0, 1]) {
    const project = maskProject(),
      group = project.pages[0].nodes[0];
    group.slots.children[index].locked = true;
    const batch = (mode: "alpha" | "luminance") => ({
      requestId: "mask-mode-lock",
      baseRevision: project.revision,
      operations: [
        {
          type: "setNodeMetadata" as const,
          nodeId: group.id,
          scene: { maskMode: mode },
        },
      ],
    });
    expect(() => applyBatch(project, batch("luminance"))).toThrow(
      "NODE_LOCKED",
    );
    expect(
      applyBatch(project, batch("alpha")).pages[0].nodes[0].scene!.maskMode,
    ).toBe("alpha");
    expect(group.scene!.maskMode).toBe("alpha");
  }
});
