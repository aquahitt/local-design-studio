import { expect, it } from "vitest";
import { parseProject } from "./project";
import { applyBatch } from "./operations";
import * as commands from "./layer-commands";
import { sceneProject } from "./scene-fixtures";
import { componentProject } from "./scene-fixtures";

it("appends a non-adjacent multi-selection without changing its relative order", () => {
  const project = parseProject(sceneProject());
  const template = project.pages[0].nodes[0].slots.content[0];
  project.pages[0].nodes = ["a", "b", "c", "d"].map((id) => ({
    ...structuredClone(template), id,
  }));
  const next = applyBatch(project, {
    requestId: "move-selection", baseRevision: 0,
    operations: commands.moveLayersToEnd(project, ["c", "a"], { pageId: "home" }),
  });
  expect(next.pages[0].nodes.map((node) => node.id)).toEqual(["b", "d", "a", "c"]);
  expect(project.pages[0].nodes.map((node) => node.id)).toEqual(["a", "b", "c", "d"]);
});

it("moves mixed root and nested selections to one frame and rejects cycles atomically", () => {
  const project = parseProject(sceneProject());
  project.pages[0].nodes.push({
    ...structuredClone(project.pages[0].nodes[0].slots.content[0]), id: "outside",
  });
  const next = applyBatch(project, {
    requestId: "move-nested", baseRevision: 0,
    operations: commands.moveLayersToEnd(project, ["outside", "label"], {
      pageId: "home", parentId: "frame", slot: "content",
    }),
  });
  expect(next.pages[0].nodes).toHaveLength(1);
  expect(next.pages[0].nodes[0].slots.content.map((node) => node.id)).toEqual(["shape", "label", "outside"]);
  expect(() => applyBatch(project, {
    requestId: "move-cycle", baseRevision: 0,
    operations: commands.moveLayersToEnd(project, ["frame", "label"], {
      pageId: "home", parentId: "frame", slot: "content",
    }),
  })).toThrow("NODE_CYCLE");
  expect(project.pages[0].nodes.map((node) => node.id)).toEqual(["frame", "outside"]);
});

it("deduplicates parent/child selections and generates fresh subtree IDs for duplicate", () => {
  const api = commands;
  const project = parseProject(sceneProject());
  let count = 0;
  const result = api.duplicateLayers(
    project,
    ["frame", "label"],
    () => `copy-${++count}`,
  );
  const next = applyBatch(project, {
    requestId: "duplicate",
    baseRevision: 0,
    operations: result.operations,
  });
  expect(next.pages[0].nodes).toHaveLength(2);
  const clone = next.pages[0].nodes[1];
  expect(clone.id).not.toBe("frame");
  expect(clone.slots.content.map((node: any) => node.id)).toEqual([
    "copy-2",
    "copy-3",
  ]);
  expect(clone.slots.content[0].props).toEqual(
    project.pages[0].nodes[0].slots.content[0].props,
  );
});

it("renames, hides and locks multiple nodes through undoable operations", () => {
  const api = commands;
  const project = parseProject(sceneProject());
  const operations = [
    ...api.layerCommandOperations(project, ["label", "shape"], {
      type: "rename",
      name: "Selection",
    }),
    ...api.layerCommandOperations(project, ["label", "shape"], {
      type: "hidden",
      value: true,
    }),
    ...api.layerCommandOperations(project, ["label", "shape"], {
      type: "locked",
      value: true,
    }),
  ];
  const next = applyBatch(project, {
    requestId: "multi",
    baseRevision: 0,
    operations,
  });
  expect(
    next.pages[0].nodes[0].slots.content.every(
      (node) => node.name === "Selection" && node.hidden && node.locked,
    ),
  ).toBe(true);
  expect(() => api.duplicateLayers(next, ["frame"])).toThrow("NODE_LOCKED");
});

it("copies local component links, remaps IDs and diagnoses missing cross-project assets", () => {
  const api = commands;
  const source = componentProject() as any;
  source.designComponents[0].nodes[0].props.src = "assets/image.png";
  const project = parseProject(source);
  const clipboard = api.copyLayers(project, ["instance"]);
  const destination = parseProject(sceneProject());
  let count = 0;
  const pasted = api.pasteLayers(
    destination,
    clipboard,
    { pageId: "home", index: 1 },
    () => `pasted-${++count}`,
    new Set(),
  );
  expect(pasted.diagnostics).toEqual([
    { code: "MISSING_ASSET", asset: "assets/image.png" },
  ]);
  const next = applyBatch(destination, {
    requestId: "paste",
    baseRevision: 0,
    operations: pasted.operations,
  });
  const instance = next.pages[0].nodes[1];
  expect(instance.id).not.toBe("instance");
  const definition = next.designComponents!.find(
    (definition) => definition.id === instance.instance!.definitionId,
  )!;
  expect(Object.keys(instance.instance!.overrides!)).toEqual([
    definition.nodes[0].id,
  ]);
  expect(definition.properties!.label.nodeId).toBe(definition.nodes[0].id);
  expect(definition.nodes[0].props.src).toBe("assets/image.png");
});

it("preserves token dependencies across paste and remaps conflicting token names", () => {
  const api = commands;
  const source = sceneProject() as any;
  source.tokens = {
    title: { type: "string", value: "Title" },
    alias: { type: "string", value: { $token: "title" } },
  };
  source.pages[0].nodes[0].slots.content[0].props.text = { $token: "alias" };
  const project = parseProject(source);
  const target = sceneProject() as any;
  target.tokens = { title: { type: "string", value: "Other" } };
  const destination = parseProject(target);
  let count = 0;
  const result = api.pasteLayers(
    destination,
    api.copyLayers(project, ["label"]),
    { pageId: "home", index: 1 },
    () => `fresh-${++count}`,
  );
  const next = applyBatch(destination, {
    requestId: "paste-token",
    baseRevision: 0,
    operations: result.operations,
  });
  expect(next.tokens.title.value).toBe("Other");
  expect(
    Object.values(next.tokens).some((token) => token.value === "Title"),
  ).toBe(true);
  expect(next.pages[0].nodes[1].props.text).toEqual({ $token: "alias" });
});

it("moves between frames and rejects nesting cycles atomically", () => {
  const initial = parseProject(sceneProject());
  const next = applyBatch(initial, {
    requestId: "move",
    baseRevision: 0,
    operations: [
      { type: "moveNode", nodeId: "label", pageId: "home", index: 1 },
    ],
  });
  expect(next.pages[0].nodes[1].id).toBe("label");
  expect(next.pages[0].nodes[0].slots.content.map((node) => node.id)).toEqual([
    "shape",
  ]);
  expect(() =>
    applyBatch(initial, {
      requestId: "cycle",
      baseRevision: 0,
      operations: [
        {
          type: "moveNode",
          nodeId: "frame",
          pageId: "home",
          parentId: "label",
          slot: "content",
          index: 0,
        },
      ],
    }),
  ).toThrow("NODE_CYCLE");
  expect(initial.pages[0].nodes).toHaveLength(1);
});

it("does not overwrite a destination token alias when a dependency conflicts", () => {
  const api = commands;
  const source = sceneProject() as any;
  source.tokens = {
    title: { type: "string", value: "Source" },
    alias: { type: "string", value: { $token: "title" } },
  };
  source.pages[0].nodes[0].slots.content[0].props.text = { $token: "alias" };
  const target = structuredClone(source);
  target.projectId = "other";
  target.tokens.title.value = "Destination";
  const destination = parseProject(target);
  let count = 0;
  const result = api.pasteLayers(
    destination,
    api.copyLayers(parseProject(source), ["label"]),
    { pageId: "home", index: 1 },
    () => `fresh-${++count}`,
  );
  const next = applyBatch(destination, {
    requestId: "alias-collision",
    baseRevision: 0,
    operations: result.operations,
  });
  expect(next.tokens.alias).toEqual(destination.tokens.alias);
  expect(next.pages[0].nodes[0].slots.content[0].props.text).toEqual({
    $token: "alias",
  });
  expect(next.pages[0].nodes[1].props.text).not.toEqual({ $token: "alias" });
});
