import { expect, it } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { parseProject } from "./project";
import { sceneProject } from "./scene-fixtures";
import { detachDesignInstance, resolveSceneNodes } from "./design-components";
import { batchSchema, projectSchema } from "../service/schema";

function leaf(id: string): any {
  return {
    id,
    type: "SceneFrame",
    props: {},
    slots: {},
    scene: { kind: "frame", x: 0, y: 0, width: 80, height: 60, fill: "#fff" },
  };
}
function mask(id = "mask"): any {
  return {
    id,
    type: "SceneMask",
    props: {},
    scene: {
      kind: "mask",
      maskMode: "alpha",
      x: 12,
      y: 20,
      width: 200,
      height: 100,
      opacity: 0.8,
    },
    slots: {
      children: [
        leaf(`${id}-content`),
        { ...leaf(`${id}-source`), maskSource: true },
      ],
    },
  };
}
function documentWith(...nodes: any[]): any {
  const project: any = sceneProject();
  project.pages[0].nodes = nodes;
  return project;
}
const validator = new AjvJsonSchemaValidator();
// The published schema is draft 2020-12; the SDK default draft-07 validator
// cannot enforce maxContains. The final core parser remains authoritative.
const validateProject = new Ajv2020({ strict: false }).compile(projectSchema);
const validate = (document: unknown) => ({ valid: validateProject(document) });
const validateBatch = validator.getValidator(batchSchema as never);
function rejectsMask(document: any, code: string) {
  expect(() => parseProject(document)).toThrow(new RegExp(code));
  expect(validate(document).valid).toBe(false);
}

it.each(["alpha", "luminance"])(
  "round trips %s groups with source at any ordered position and independent nested roles",
  (mode) => {
    const outer = mask();
    outer.scene.maskMode = mode;
    const nested = mask("nested");
    nested.maskSource = true;
    delete outer.slots.children[1].maskSource;
    outer.slots.children.splice(1, 0, nested);
    const document = documentWith(outer);
    expect(parseProject(document)).toEqual(document);
    expect(validate(document).valid).toBe(true);
    expect(
      parseProject(document).pages[0].nodes[0].slots.children.map(
        (node) => node.id,
      ),
    ).toEqual(["mask-content", "nested", "mask-source"]);
  },
);

it.each([
  undefined,
  {},
  { children: [] },
  { content: [] },
  { children: [], extra: [] },
])("requires exactly the children slot and one direct source: %j", (slots) => {
  const group = mask();
  if (slots === undefined) delete group.slots;
  else group.slots = slots;
  rejectsMask(documentWith(group), "INVALID_MASK_GROUP");
});

it("rejects zero or two sources without selecting by order or looking through descendants", () => {
  for (const count of [0, 2]) {
    const group = mask();
    group.slots.children.forEach((node: any) => delete node.maskSource);
    for (let index = 0; index < count; index++)
      group.slots.children[index].maskSource = true;
    rejectsMask(documentWith(group), "INVALID_MASK_GROUP");
  }
  const group = mask();
  delete group.slots.children[1].maskSource;
  group.slots.children.push(mask("nested"));
  rejectsMask(documentWith(group), "INVALID_MASK_GROUP");
});

it("permits the literal true role only on direct mask children", () => {
  for (const value of [false, 1, "true", null]) {
    const group = mask();
    group.slots.children[1].maskSource = value;
    rejectsMask(documentWith(group), "INVALID_MASK_SOURCE");
  }
  const source = { ...leaf("orphan"), maskSource: true };
  rejectsMask(documentWith(source), "INVALID_MASK_SOURCE");
  const frame = leaf("frame");
  frame.slots.content = [source];
  rejectsMask(documentWith(frame), "INVALID_MASK_SOURCE");
  const group = mask();
  group.slots.children[0].slots.content = [source];
  rejectsMask(documentWith(group), "INVALID_MASK_SOURCE");
});

it("rejects own instance and non-children slots on groups", () => {
  const group = mask();
  group.instance = { definitionId: "definition" };
  rejectsMask(documentWith(group), "INVALID_MASK_GROUP");
  delete group.instance;
  group.slots.extra = [];
  rejectsMask(documentWith(group), "INVALID_MASK_GROUP");
});

it("requires an explicit closed mask mode only on mask scenes", () => {
  for (const mode of [undefined, "multiply", true, null]) {
    const group = mask();
    if (mode === undefined) delete group.scene.maskMode;
    else group.scene.maskMode = mode;
    rejectsMask(documentWith(group), "INVALID_SCENE");
  }
  const normal = leaf("normal");
  normal.scene.maskMode = "alpha";
  rejectsMask(documentWith(normal), "INVALID_SCENE");
});

it.each([
  ["fill", "#fff"],
  ["fills", []],
  ["strokes", []],
  ["shadows", []],
  ["stroke", "#fff"],
  ["strokeWidth", 2],
  ["radius", 4],
  ["clip", false],
  ["path", "M0 0 L10 10"],
  ["fontSize", 16],
  ["textStyle", {}],
  ["sourceIndex", 0],
  ["sourceNodeId", "mask-source"],
])("rejects a mask wrapper's own %s", (field, value) => {
  const group = mask();
  group.scene[field] = value;
  rejectsMask(documentWith(group), "INVALID_SCENE");
});

it("uses existing finite affine geometry limits and preserves reflections", () => {
  const group = mask();
  group.scene.linearTransform = [-1, 0.2, 0, 1];
  expect(
    parseProject(documentWith(group)).pages[0].nodes[0].scene?.linearTransform,
  ).toEqual([-1, 0.2, 0, 1]);
  expect(validate(documentWith(group)).valid).toBe(true);
  for (const patch of [
    { rotation: 15 },
    { linearTransform: [0, 0, 0, 0] },
    { width: 0 },
  ]) {
    const bad = structuredClone(group);
    Object.assign(bad.scene, patch);
    expect(() => parseProject(documentWith(bad))).toThrow(/INVALID_SCENE/);
  }
  const infinite = structuredClone(group);
  infinite.scene.linearTransform[0] = Infinity;
  expect(() => parseProject(documentWith(infinite))).toThrow(/INVALID_JSON/);
});

it("preserves unknown library source nodes and source instances containing mask definitions", () => {
  const group = mask();
  group.slots.children[1] = {
    ...leaf("source-instance"),
    type: "SceneComponent",
    maskSource: true,
    scene: { kind: "component", x: 0, y: 0, width: 80, height: 60 },
    instance: { definitionId: "definition" },
  };
  const document = documentWith(group);
  document.designComponents = [
    {
      id: "definition",
      name: "Nested masks",
      version: 1,
      nodes: [mask("defined")],
    },
  ];
  const project = parseProject(document);
  expect(project).toEqual(document);
  expect(validate(project).valid).toBe(true);
  const source = resolveSceneNodes(project, project.pages[0].nodes)[0].slots
    .children[1];
  expect(source.maskSource).toBe(true);
  const resolvedMask = source.slots.content[0];
  expect(resolvedMask.scene?.kind).toBe("mask");
  expect(resolvedMask.slots.children[1].maskSource).toBe(true);
  const detached = detachDesignInstance(
    project,
    project.pages[0].nodes[0].slots.children[1],
  );
  const next = structuredClone(project);
  next.pages[0].nodes[0].slots.children[1] = detached;
  expect(parseProject(next)).toEqual(next);
  const unknown = leaf("unknown");
  unknown.type = "FutureLibraryNode";
  unknown.maskSource = true;
  group.slots.children[1] = unknown;
  expect(
    parseProject(documentWith(group)).pages[0].nodes[0].slots.children[1].type,
  ).toBe("FutureLibraryNode");
});

it("validates roles in unused definitions and does not inject fields into legacy documents", () => {
  const legacy = sceneProject();
  expect(parseProject(legacy)).toEqual(legacy);
  const document = documentWith();
  document.designComponents = [
    {
      id: "unused",
      name: "Unused",
      version: 1,
      nodes: [{ ...leaf("bad"), maskSource: true }],
    },
  ];
  rejectsMask(document, "INVALID_MASK_SOURCE");
  document.designComponents[0].nodes = [mask("valid")];
  expect(parseProject(document)).toEqual(document);
  expect(validate(document).valid).toBe(true);
});

it("publishes exact role operations while allowing transient raw insert nodes", () => {
  const batch = (...operations: any[]) => ({
    requestId: "r",
    baseRevision: 0,
    operations,
  });
  expect(
    validateBatch(
      batch({ type: "setMaskSource", nodeId: "mask", sourceNodeId: "source" }),
    ).valid,
  ).toBe(true);
  expect(
    validateBatch(batch({ type: "unwrapMask", nodeId: "mask" })).valid,
  ).toBe(true);
  expect(
    validateBatch(batch({ type: "removeMask", nodeId: "mask" })).valid,
  ).toBe(true);
  expect(
    validateBatch(
      batch({
        type: "setMaskSource",
        nodeId: "mask",
        sourceNodeId: "source",
        extra: true,
      }),
    ).valid,
  ).toBe(false);
  expect(
    validateBatch(
      batch({ type: "setNodeMetadata", nodeId: "source", maskSource: true }),
    ).valid,
  ).toBe(false);
  const raw = mask();
  raw.slots.children = [];
  expect(
    validateBatch(
      batch({ type: "insertNode", pageId: "home", index: 0, node: raw }),
    ).valid,
  ).toBe(true);
  expect(
    validateBatch(
      batch({
        type: "insertNode",
        pageId: "home",
        parentId: "mask",
        slot: "children",
        index: 0,
        node: { ...leaf("source"), maskSource: true },
      }),
    ).valid,
  ).toBe(true);
});
