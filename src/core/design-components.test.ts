import { expect, it } from "vitest";
import { parseProject } from "./project";
import { applyBatch } from "./operations";

import { componentProject } from "./scene-fixtures";
import { resolveSceneNodes, sceneSelectionId } from "./design-components";

it("round trips design definitions, instances, variants and bindings in schema2", () => {
  expect(parseProject(componentProject())).toEqual(componentProject());
});
it("preserves ordinary IDs containing delimiters and avoids expanded ID collisions", () => {
  const input = parseProject(componentProject());
  input.pages[0].nodes.push({ id: "instance::button-label", type: "SceneText", props: { text: "Ordinary layer" }, slots: {} });
  const project = parseProject(input);
  const nodes = resolveSceneNodes(project, project.pages[0].nodes);
  expect(sceneSelectionId(nodes[1])).toBe("instance::button-label");
  const child = nodes[0].slots.content[0];
  expect(sceneSelectionId(child)).toBe("instance");
  expect(child.id).not.toBe(nodes[1].id);
  expect(child.id).toBe(resolveSceneNodes(project, project.pages[0].nodes)[0].slots.content[0].id);
  expect(project.pages[0].nodes[1].id).toBe("instance::button-label");
});

it("rejects missing definitions and invalid override targets/fields", () => {
  for (const change of [
    (input: any) => {
      input.pages[0].nodes[0].instance.definitionId = "missing";
    },
    (input: any) => {
      input.pages[0].nodes[0].instance.variant = "missing";
    },
    (input: any) => {
      input.pages[0].nodes[0].instance.overrides = { missing: { text: "Bad" } };
    },
    (input: any) => {
      input.pages[0].nodes[0].instance.overrides = {
        "button-label": { unknown: "Bad" },
      };
    },
    (input: any) => {
      input.designComponents[0].variants.primary["button-label"].onClick =
        "Bad";
    },
  ]) {
    const input = componentProject();
    change(input);
    expect(() => parseProject(input)).toThrow();
  }
});

it("rejects cyclic nested definitions", () => {
  const input = componentProject() as any;
  input.designComponents[0].nodes[0].instance = { definitionId: "button" };
  expect(() => parseProject(input)).toThrow("COMPONENT_CYCLE");
});

it("rejects incompatible definition updates atomically and preserves valid overrides", () => {
  const initial = parseProject(componentProject());
  const definitions = structuredClone(initial.designComponents!);
  definitions[0].nodes[0].props.text = "Changed";
  const updated = applyBatch(initial, {
    requestId: "definition",
    baseRevision: 0,
    operations: [{ type: "setDesignComponents", definitions }],
  } as any);
  expect(updated.pages[0].nodes[0].instance!.overrides).toEqual({
    "button-label": { text: "Override" },
  });
  definitions[0].nodes[0].id = "renamed";
  expect(() =>
    applyBatch(initial, {
      requestId: "incompatible",
      baseRevision: 0,
      operations: [{ type: "setDesignComponents", definitions }],
    } as any),
  ).toThrow("INCOMPATIBLE_COMPONENT");
  expect(initial.designComponents![0].nodes[0].props.text).toBe("Default");
});

import * as components from "./design-components";
it("resolves definition changes, variants and overrides without mutating the document", () => {
  const api = components;
  const project = parseProject(componentProject());
  const rendered = api.resolveSceneNodes(project, project.pages[0].nodes);
  expect(rendered[0].slots.content[0].props.text).toBe("Override");
  expect(rendered[0].slots.content[0].id).toBe("instance::button-label");
  expect(project.pages[0].nodes[0].slots).toEqual({});
  delete project.pages[0].nodes[0].instance!.overrides;
  expect(
    api.resolveSceneNodes(project, project.pages[0].nodes)[0].slots.content[0]
      .props.text,
  ).toBe("Primary");
  delete project.pages[0].nodes[0].instance!.variant;
  project.pages[0].nodes[0].props.label = "Property";
  expect(
    api.resolveSceneNodes(project, project.pages[0].nodes)[0].slots.content[0]
      .props.text,
  ).toBe("Property");
});

it("resolves nested instances and detach preserves rendered geometry and content", () => {
  const api = components;
  const input = componentProject() as any;
  input.designComponents.push({
    id: "card",
    name: "Card",
    version: 1,
    nodes: [
      {
        id: "nested",
        type: "SceneComponent",
        props: { label: "Nested label" },
        slots: {},
        scene: { kind: "component", x: 5, y: 10, width: 200, height: 80 },
        instance: { definitionId: "button" },
      },
    ],
  });
  input.pages[0].nodes[0].instance = { definitionId: "card" };
  const project = parseProject(input);
  const before = api.resolveSceneNodes(project, project.pages[0].nodes);
  expect(before[0].slots.content[0].slots.content[0].props.text).toBe(
    "Nested label",
  );
  const detached = applyBatch(project, {
    requestId: "detach",
    baseRevision: 0,
    operations: [{ type: "detachInstance", nodeId: "instance" }],
  } as any);
  const root = detached.pages[0].nodes[0];
  expect(root).not.toHaveProperty("instance");
  expect(root.id).toBe("instance");
  expect(root.scene).toEqual(before[0].scene);
  expect(root.slots.content[0].slots.content[0].props).toEqual(
    before[0].slots.content[0].slots.content[0].props,
  );
  expect(root.slots.content[0].slots.content[0]).not.toHaveProperty("instance");
  expect(root.slots.content[0].id).not.toBe("nested");
  expect(
    new Set([
      ...components.definitionNodes(root.slots.content).keys(),
      ...components.definitionNodes(detached.designComponents![0].nodes).keys(),
    ]).size,
  ).toBe(3);
});

it("updates instance variants and text overrides through shared operations", () => {
  const project = parseProject(componentProject());
  const updated = applyBatch(project, {
    requestId: "variant",
    baseRevision: 0,
    operations: [
      {
        type: "setInstance",
        nodeId: "instance",
        instance: {
          definitionId: "button",
          variant: "primary",
          overrides: { "button-label": { text: "New override" } },
        },
      },
    ],
  } as any);
  expect(
    components.resolveSceneNodes(updated, updated.pages[0].nodes)[0].slots
      .content[0].props.text,
  ).toBe("New override");
});

it("accepts scalar text overrides of token-bound definition text", () => {
  const input = componentProject() as any;
  input.tokens = { label: { type: "string", value: "Token label" } };
  input.designComponents[0].nodes[0].props.text = { $token: "label" };
  expect(() => parseProject(input)).not.toThrow();
  const bad = structuredClone(input);
  bad.pages[0].nodes[0].instance.overrides["button-label"].text = 2;
  expect(() => parseProject(bad)).toThrow("INCOMPATIBLE_COMPONENT");
});

it("materialized instance wrappers render as frames while retaining component geometry", async () => {
  const { resolveSceneNodes } = await import("./design-components");
  const project = parseProject(componentProject());
  const source = project.pages[0].nodes[0];
  source.scene = {
    kind: "component",
    x: 20,
    y: 30,
    width: 200,
    height: 80,
    rotation: 12,
  };
  const resolved = resolveSceneNodes(project, [source])[0];
  expect(resolved.type).toBe("SceneFrame");
  expect(resolved.scene).toEqual({ ...source.scene, kind: "frame" });
  expect(resolved.slots.content.length).toBeGreaterThan(0);
  expect(source.scene.kind).toBe("component");
});
