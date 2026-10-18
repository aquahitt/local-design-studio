import { expect, it, afterEach } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { parseProject } from "./project";
import { sceneProject } from "./scene-fixtures";
import { layerStyle, createReactHandoff } from "./handoff";
import { validateScene } from "./scene";
import { BLEND_MODES, compileFramePaint, validateFramePaint } from "./paint";
import { ProjectStore } from "./store";
import { batchSchema, projectSchema } from "../service/schema";

const red = { r: 255, g: 0, b: 0, a: 0.5 };
const blue = { r: 0, g: 0, b: 255, a: 1 };
const solid = () => ({ id: "red", kind: "solid", color: red, opacity: 0.5 });
const linear = () => ({
  id: "linear",
  kind: "linear",
  angle: 90,
  blendMode: "multiply",
  stops: [
    { offset: 0, color: red },
    { offset: 1, color: blue },
  ],
});
const radial = () => ({
  id: "radial",
  kind: "radial",
  center: { x: 0.2, y: 0.8 },
  radius: { x: 0.5, y: 1.5 },
  stops: [
    { offset: 0, color: red },
    { offset: 0, color: blue },
  ],
});
const shadow = () => ({
  id: "shadow",
  kind: "outer",
  x: 2,
  y: -3,
  blur: 4,
  spread: -1,
  color: red,
});
const projectWith = (patch: Record<string, unknown>) => {
  const project = sceneProject();
  Object.assign(project.pages[0].nodes[0].scene, patch);
  return project;
};

it("preserves legacy scenes byte-for-byte and round trips all frame paint variants", () => {
  const legacy = sceneProject();
  const canonicalLegacy = parseProject(legacy);
  expect(canonicalLegacy).toEqual(legacy);
  expect(JSON.stringify(parseProject(canonicalLegacy))).toBe(
    JSON.stringify(canonicalLegacy),
  );
  expect(canonicalLegacy.pages[0].nodes[0].scene).not.toHaveProperty("fills");
  const project = projectWith({
    fills: [solid(), linear(), radial()],
    shadows: [shadow(), { ...shadow(), id: "inner", kind: "inner" }],
  });
  expect(parseProject(project)).toEqual(project);
});

it.each([
  { fills: "url(https://example.com)" },
  { fills: [{ ...solid(), color: "red" }] },
  { fills: [{ ...solid(), color: { ...red, r: 0.5 } }] },
  { fills: [{ ...solid(), color: { ...red, a: 2 } }] },
  { fills: [{ ...solid(), color: { ...red, url: "javascript:alert(1)" } }] },
  { fills: [{ ...solid(), id: "" }] },
  { fills: [solid(), solid()] },
  {
    fills: Array.from({ length: 17 }, (_, i) => ({
      ...solid(),
      id: String(i),
    })),
  },
  { fills: [{ ...solid(), blendMode: "plus-lighter" }] },
  { fills: [{ ...solid(), opacity: -0.1 }] },
  { fills: [{ ...solid(), enabled: 1 }] },
  { fills: [{ ...solid(), style: "color:red" }] },
  {
    fills: [
      {
        ...linear(),
        stops: [
          { offset: 1, color: red },
          { offset: 0, color: blue },
        ],
      },
    ],
  },
  { fills: [{ ...linear(), stops: [{ offset: 0, color: red }] }] },
  {
    fills: [
      {
        ...linear(),
        stops: Array.from({ length: 65 }, () => ({ offset: 0, color: red })),
      },
    ],
  },
  { fills: [{ ...radial(), center: { x: 1.1, y: 0 } }] },
  { fills: [{ ...radial(), radius: { x: 0, y: 1 } }] },
  { fills: [{ ...radial(), radius: { x: 1, y: 4.1 } }] },
  { shadows: [shadow(), shadow()] },
  { shadows: [{ ...shadow(), blur: -1 }] },
  { shadows: [{ ...shadow(), spread: 4097 }] },
  { shadows: [{ ...shadow(), css: "none" }] },
  {
    shadows: Array.from({ length: 9 }, (_, i) => ({
      ...shadow(),
      id: String(i),
    })),
  },
  { kind: "text", fills: [] },
  { kind: "component", shadows: [] },
])("rejects invalid paints with a useful scene path: %j", (patch) => {
  try {
    parseProject(projectWith(patch));
    throw new Error("accepted invalid paint");
  } catch (error) {
    expect(error).toMatchObject({
      code: "INVALID_SCENE",
      path: expect.stringContaining(".scene"),
    });
  }
});

it("rejects non-finite numbers directly with paint paths, while the project rejects non-JSON numbers first", () => {
  for (const patch of [
    { fills: [{ ...linear(), angle: Infinity }] },
    { shadows: [{ ...shadow(), x: NaN }] },
  ]) {
    expect(() =>
      validateScene(projectWith(patch).pages[0].nodes[0].scene, "scene"),
    ).toThrow("INVALID_SCENE: scene.");
    expect(() => parseProject(projectWith(patch))).toThrow("INVALID_JSON");
  }
});

it("compiles top-first layers, multiplied alpha, blend modes and normalized radial geometry", () => {
  const node = parseProject(
    projectWith({ fills: [solid(), linear(), radial()] }),
  ).pages[0].nodes[0];
  expect(layerStyle(node)).toMatchObject({
    backgroundColor: "transparent",
    backgroundImage:
      "linear-gradient(rgba(255, 0, 0, 0.25), rgba(255, 0, 0, 0.25)), linear-gradient(90deg, rgba(255, 0, 0, 0.5) 0%, rgba(0, 0, 255, 1) 100%), radial-gradient(ellipse 50% 150% at 20% 80%, rgba(255, 0, 0, 0.5) 0%, rgba(0, 0, 255, 1) 0%)",
    backgroundBlendMode: "normal, multiply, normal",
  });
  expect(layerStyle(node)).not.toHaveProperty("background");
});

it.each([
  [0, 0],
  [-0, 0],
  [90, 90],
  [450, 90],
  [-270, 90],
  [1080, 0],
  [-1080, 0],
  [360.25, 0.25],
  [-0.25, 359.75],
  [1e-20, 1e-20],
  [-1e-20, 0],
  [1e100, 1e100 % 360],
  [-1e100, 360 - (1e100 % 360)],
  [1e308, 1e308 % 360],
  [-1e308, 360 - (1e308 % 360)],
  [Number.MAX_VALUE, Number.MAX_VALUE % 360],
])("normalizes finite linear angle %s to CSS angle %s without altering the document", (angle, expected) => {
  const project = parseProject(projectWith({ fills: [{ ...linear(), angle }] }));
  const before = structuredClone(project);
  const scene = project.pages[0].nodes[0].scene!;
  const background = compileFramePaint(scene).backgroundImage;
  expect(background).toBe(
    `linear-gradient(${expected}deg, rgba(255, 0, 0, 0.5) 0%, rgba(0, 0, 255, 1) 100%)`,
  );
  const cssAngle = Number(background.match(/^linear-gradient\(([^d]+)deg/)![1]);
  expect(cssAngle).toBeGreaterThanOrEqual(0);
  expect(cssAngle).toBeLessThan(360);
  expect(project).toEqual(before);
});

it("supports every closed blend mode, maxima and omitted defaults without changing source", () => {
  const fills = BLEND_MODES.map((blendMode, index) => ({
    ...solid(),
    id: String(index),
    blendMode,
    opacity: 1,
  }));
  const scene = parseProject(
    projectWith({
      fills,
      shadows: Array.from({ length: 8 }, (_, index) => ({
        ...shadow(),
        id: String(index),
        x: -4096,
        y: 4096,
        spread: -4096,
        blur: 4096,
      })),
    }),
  ).pages[0].nodes[0].scene!;
  const before = structuredClone(scene);
  expect(compileFramePaint(scene).backgroundBlendMode).toBe(
    BLEND_MODES.join(", "),
  );
  expect(scene).toEqual(before);
  expect(
    compileFramePaint({
      kind: "frame",
      fills: [{ id: "default", kind: "solid", color: blue }],
    }),
  ).toMatchObject({
    backgroundImage: "linear-gradient(rgba(0, 0, 255, 1), rgba(0, 0, 255, 1))",
    backgroundBlendMode: "normal",
  });
  expect(compileFramePaint({ kind: "frame", fills: [] })).toMatchObject({
    backgroundImage: "none",
  });
  expect(compileFramePaint({ kind: "frame" })).toEqual({});
  expect(() =>
    validateFramePaint(
      { kind: "frame", fills: [{ ...solid(), color: { ...red, r: -1 } }] },
      "pages[0].nodes[0].scene",
    ),
  ).toThrow("pages[0].nodes[0].scene.fills[0].color.r");
});

it("explicit empty or disabled fills override legacy without affecting layer opacity", () => {
  for (const fills of [[], [{ ...solid(), enabled: false }]]) {
    const node = parseProject(projectWith({ fills, opacity: 0.3 })).pages[0]
      .nodes[0];
    expect(layerStyle(node)).toMatchObject({
      backgroundColor: "transparent",
      backgroundImage: "none",
      backgroundBlendMode: "normal",
      opacity: 0.3,
    });
    expect(layerStyle(node)).not.toHaveProperty("background");
  }
});

it("combines outer/inner shadows and inset legacy stroke without a border coordinate offset", () => {
  const node = parseProject(
    projectWith({
      stroke: "#123456",
      strokeWidth: 10,
      shadows: [
        shadow(),
        { ...shadow(), id: "inner", kind: "inner" },
        { ...shadow(), id: "disabled", enabled: false },
      ],
    }),
  ).pages[0].nodes[0];
  expect(layerStyle(node)).toMatchObject({
    background: "#fff",
    boxShadow:
      "inset 0 0 0 10px #123456, 2px -3px 4px -1px rgba(255, 0, 0, 0.5), inset 2px -3px 4px -1px rgba(255, 0, 0, 0.5)",
  });
  expect(layerStyle(node)).not.toHaveProperty("border");
  expect(node.slots.content[0].scene).toMatchObject({ x: 10, y: 20 });
  const handoff = createReactHandoff(
    projectWith({ fills: [linear()] }) as any,
    { pageId: "home", revision: 0 },
    [],
  );
  expect(handoff.files["Screen.tsx"]).toContain("linear-gradient(90deg");
});

it("publishes paint constraints consistently in project, partial batch and ADR schema", async () => {
  const validator = new AjvJsonSchemaValidator();
  const adr = JSON.parse(
    await readFile(
      new URL("../../docs/adr/scene-v2.schema.json", import.meta.url),
      "utf8",
    ),
  );
  expect(adr).toEqual(projectSchema);
  for (const schema of [projectSchema, adr]) {
    const validate = validator.getValidator(schema);
    expect(
      validate(
        projectWith({
          fills: [solid(), linear(), radial()],
          shadows: [shadow()],
        }),
      ).valid,
    ).toBe(true);
    for (const patch of [
      { kind: "text", fills: [] },
      { fills: [{ ...solid(), color: { ...red, r: 0.1 } }] },
      { shadows: [{ ...shadow(), blur: -1 }] },
      { fills: [{ ...solid(), blendMode: "evil" }] },
    ])
      expect(validate(projectWith(patch)).valid).toBe(false);
  }
  const validateBatch = validator.getValidator(
    JSON.parse(JSON.stringify(batchSchema)),
  );
  const batch = (scene: unknown) => ({
    requestId: "paint",
    baseRevision: 0,
    operations: [{ type: "setNodeMetadata", nodeId: "frame", scene }],
  });
  expect(validateBatch(batch({ fills: [solid()] })).valid).toBe(true);
  expect(validateBatch(batch({ shadows: [] })).valid).toBe(true);
  expect(validateBatch(batch({ kind: "text", fills: [] })).valid).toBe(false);
  expect(
    validateBatch(batch({ fills: [{ ...solid(), opacity: 2 }] })).valid,
  ).toBe(false);
});

const roots: string[] = [];
const stores: ProjectStore[] = [];
afterEach(async () => {
  await Promise.all(stores.map((s) => s.close()));
  stores.length = 0;
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
it("persists paint edits as one reversible atomic action and rejects invalid final edits without a write", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-paint-"));
  roots.push(root);
  const store = await ProjectStore.open(root, {
    initialProject: parseProject(sceneProject()),
  });
  stores.push(store);
  const batch = {
    requestId: "paint",
    baseRevision: 0,
    operations: [
      {
        type: "setNodeMetadata",
        nodeId: "frame",
        scene: { fills: [solid()], shadows: [shadow()] },
      },
    ],
  } as any;
  await store.apply(batch);
  expect(store.read().pages[0].nodes[0].scene).toMatchObject({
    fills: [solid()],
    shadows: [shadow()],
    x: 40,
    y: 30,
  });
  expect((await store.apply(batch)).revision).toBe(1);
  const bytes = await readFile(join(root, "project.json"), "utf8");
  await expect(store.apply({ ...batch, requestId: "stale" })).rejects.toThrow(
    "REVISION_CONFLICT",
  );
  expect(await readFile(join(root, "project.json"), "utf8")).toBe(bytes);
  await expect(
    store.apply({
      requestId: "invalid",
      baseRevision: 1,
      operations: [
        { type: "setNodeMetadata", nodeId: "frame", name: "Lost" },
        {
          type: "setNodeMetadata",
          nodeId: "frame",
          scene: { fills: [{ ...solid(), opacity: 2 }] },
        },
      ],
    } as any),
  ).rejects.toThrow("INVALID_SCENE");
  expect(await readFile(join(root, "project.json"), "utf8")).toBe(bytes);
  await store.undo("undo", 1);
  expect(store.read().pages[0].nodes[0].scene).not.toHaveProperty("fills");
  await store.redo("redo", 2);
  await store.close();
  const reopened = await ProjectStore.open(root);
  stores.push(reopened);
  expect(reopened.read().pages[0].nodes[0].scene).toMatchObject({
    fills: [solid()],
    shadows: [shadow()],
  });
  await reopened.apply({
    requestId: "lock",
    baseRevision: 3,
    operations: [{ type: "setNodeMetadata", nodeId: "frame", locked: true }],
  });
  const lockedBytes = await readFile(join(root, "project.json"), "utf8");
  await expect(
    reopened.apply({ ...batch, requestId: "locked", baseRevision: 4 }),
  ).rejects.toThrow("NODE_LOCKED");
  expect(await readFile(join(root, "project.json"), "utf8")).toBe(lockedBytes);
});
