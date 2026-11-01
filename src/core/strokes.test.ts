import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { parseProject } from "./project";
import { sceneProject } from "./scene-fixtures";
import { validateScene } from "./scene";
import { BLEND_MODES, compileFrameInsetEffects } from "./paint";
import { ProjectStore } from "./store";
import { batchSchema, projectSchema } from "../service/schema";

const red = { r: 255, g: 0, b: 0, a: 0.5 };
const blue = { r: 0, g: 0, b: 255, a: 1 };
const solid = () => ({
  id: "solid",
  kind: "solid",
  color: red,
  width: 2,
  alignment: "inside",
});
const stops = [
  { offset: 0, color: red },
  { offset: 1, color: blue },
];
const strokes = () => [
  solid(),
  {
    id: "linear",
    kind: "linear",
    angle: 90,
    stops,
    width: 0,
    alignment: "center",
    enabled: false,
    opacity: 0.2,
    blendMode: "multiply",
  },
  {
    id: "radial",
    kind: "radial",
    center: { x: 0, y: 1 },
    radius: { x: 4, y: 0.5 },
    stops,
    width: 4096,
    alignment: "outside",
  },
  ...["cover", "contain", "crop", "tile"].map((mode) => ({
    id: mode,
    kind: "image",
    asset: "assets/" + "a".repeat(64) + ".png",
    width: 10,
    alignment: "center",
    mapping:
      mode === "cover" || mode === "contain"
        ? { mode, anchor: { x: 0.2, y: 0.8 } }
        : { mode, imageToFrame: [100, 0, 20, 100, -4, 2] },
  })),
];
const projectWith = (patch: Record<string, unknown>) => {
  const project = sceneProject();
  Object.assign(project.pages[0].nodes[0].scene, patch);
  return project;
};

it("round trips ordered frame strokes with all paint kinds and independent fill IDs", () => {
  const project = projectWith({
    strokes: strokes(),
    fills: [{ id: "solid", kind: "solid", color: blue }],
  });
  expect(parseProject(project)).toEqual(project);
  expect(
    parseProject(projectWith({ strokes: [] })).pages[0].nodes[0].scene,
  ).toHaveProperty("strokes", []);
  const many = BLEND_MODES.map((blendMode, i) => ({
    ...solid(),
    id: String(i),
    blendMode,
  }));
  expect(parseProject(projectWith({ strokes: many }))).toEqual(
    projectWith({ strokes: many }),
  );
});

const invalidShapes = [
  { strokes: null },
  { strokes: "red" },
  { strokes: [{}] },
  { strokes: [{ ...solid(), width: undefined }] },
  { strokes: [{ ...solid(), alignment: undefined }] },
  { strokes: [{ ...solid(), width: -0.1 }] },
  { strokes: [{ ...solid(), width: 4096.1 }] },
  { strokes: [{ ...solid(), alignment: "inset" }] },
  { strokes: [{ ...solid(), alignment: ["inside"] }] },
  { strokes: [{ ...solid(), id: "" }] },
  { strokes: [{ ...solid(), enabled: 1 }] },
  { strokes: [{ ...solid(), opacity: 1.1 }] },
  { strokes: [{ ...solid(), blendMode: "plus-lighter" }] },
  { strokes: [{ ...solid(), style: "color:red" }] },
  { strokes: [{ ...solid(), color: "red" }] },
  { strokes: [{ ...solid(), color: { ...red, r: 0.1 } }] },
  { strokes: [{ ...solid(), color: { ...red, a: -1 } }] },
  { strokes: [{ ...solid(), kind: "linear", angle: 1, stops }] },
  { strokes: [{ ...solid(), kind: "unknown" }] },
  { strokes: [{ ...strokes()[1], stops: [stops[0]] }] },
  { strokes: [{ ...strokes()[2], radius: { x: 0, y: 1 } }] },
  { strokes: [{ ...strokes()[2], center: { x: 0, y: 2 } }] },
  { strokes: [{ ...strokes()[3], asset: "https://example.org/image.png" }] },
  {
    strokes: [
      { ...strokes()[3], mapping: { mode: "cover", anchor: { x: 1.1, y: 0 } } },
    ],
  },
  {
    strokes: [
      {
        ...strokes()[5],
        mapping: { mode: "crop", imageToFrame: [1, 0, 0, 1, 0] },
      },
    ],
  },
  {
    strokes: Array.from({ length: 17 }, (_, i) => ({
      ...solid(),
      id: String(i),
    })),
  },
  ...["text", "vector", "component", "image"].map((kind) => ({
    kind,
    strokes: [],
  })),
];
it.each(invalidShapes)(
  "rejects invalid closed stroke shape %j in parser and published schemas",
  (patch) => {
    const validator = new AjvJsonSchemaValidator();
    // JSON has no undefined; missing required fields exercise its equivalent wire shape.
    const wire = JSON.parse(JSON.stringify(projectWith(patch)));
    expect(() => parseProject(wire)).toThrow("INVALID_SCENE");
    expect(
      validator.getValidator(JSON.parse(JSON.stringify(projectSchema)))(wire)
        .valid,
    ).toBe(false);
    const batch = {
      requestId: "strokes",
      baseRevision: 0,
      operations: [
        {
          type: "setNodeMetadata",
          nodeId: "frame",
          scene: JSON.parse(JSON.stringify(patch)),
        },
      ],
    };
    expect(
      validator.getValidator(JSON.parse(JSON.stringify(batchSchema)))(batch)
        .valid,
    ).toBe(false);
  },
);

it("checks semantic paint safety and finite stroke geometry with useful paths", () => {
  for (const stroke of [
    { ...solid(), width: Infinity },
    { ...solid(), width: NaN },
    { ...solid(), opacity: NaN },
    { ...strokes()[1], angle: Infinity },
    { ...strokes()[1], stops: [...stops].reverse() },
    {
      ...strokes()[5],
      mapping: { mode: "crop", imageToFrame: [1, 1, 1, 1, 0, 0] },
    },
  ])
    expect(() =>
      validateScene(
        projectWith({ strokes: [stroke] }).pages[0].nodes[0].scene,
        "scene",
      ),
    ).toThrow("INVALID_SCENE: scene.strokes[0]");
  expect(() =>
    validateScene(
      projectWith({ strokes: [solid(), solid()] }).pages[0].nodes[0].scene,
      "scene",
    ),
  ).toThrow("scene.strokes[1].id");
  // Stroke-only fields never become legal on fills during shared paint validation.
  expect(() => parseProject(projectWith({ fills: [solid()] }))).toThrow(
    "INVALID_SCENE",
  );
});

it("keeps legacy documents and inset effects unless strokes are explicitly present", () => {
  const legacy = projectWith({ stroke: "#123456", strokeWidth: 1_000_000 });
  expect(parseProject(legacy)).toEqual(legacy);
  expect(parseProject(legacy).pages[0].nodes[0].scene).not.toHaveProperty(
    "strokes",
  );
  const scene = {
    kind: "frame",
    stroke: "#123456",
    strokeWidth: 1_000_000,
    shadows: [
      {
        id: "inner",
        kind: "inner",
        x: 1,
        y: 2,
        blur: 3,
        spread: 4,
        color: red,
      },
    ],
  };
  expect(compileFrameInsetEffects(scene as never).boxShadow).toContain(
    "inset 0 0 0 1000000px #123456",
  );
  for (const stack of [[], [solid()], [{ ...solid(), enabled: false }]]) {
    expect(
      compileFrameInsetEffects({ ...scene, strokes: stack } as never),
    ).toEqual({ boxShadow: "inset 1px 2px 3px 4px rgba(255, 0, 0, 0.5)" });
  }
});

it("publishes accepted stroke shapes in full/partial schemas and exact ADR schema", async () => {
  const adr = JSON.parse(
    await readFile(
      new URL("../../docs/adr/scene-v2.schema.json", import.meta.url),
      "utf8",
    ),
  );
  expect(adr).toEqual(projectSchema);
  const validator = new AjvJsonSchemaValidator();
  for (const schema of [projectSchema, adr])
    expect(
      validator.getValidator(schema)(projectWith({ strokes: strokes() })).valid,
    ).toBe(true);
  expect(
    validator.getValidator(JSON.parse(JSON.stringify(batchSchema)))({
      requestId: "strokes",
      baseRevision: 0,
      operations: [
        {
          type: "setNodeMetadata",
          nodeId: "frame",
          scene: { strokes: strokes() },
        },
      ],
    }).valid,
  ).toBe(true);
});

it("uses existing atomic operations, receipts, undo/redo and reopen for stroke edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-strokes-"));
  let store = await ProjectStore.open(root, {
    initialProject: parseProject(sceneProject()),
  });
  try {
    const initial = store.read();
    const batch = {
      requestId: "strokes",
      baseRevision: 0,
      operations: [
        {
          type: "setNodeMetadata",
          nodeId: "frame",
          scene: { strokes: strokes() },
        },
      ],
    } as any;
    await store.apply(batch);
    const edited = store.read();
    expect(edited.pages[0].nodes[0].scene).toMatchObject({
      strokes: strokes(),
      x: 40,
      width: 300,
    });
    expect((await store.apply(batch)).revision).toBe(1);
    const bytes = await readFile(join(root, "project.json"), "utf8");
    await expect(
      store.apply({ ...batch, requestId: "conflict" }),
    ).rejects.toThrow("REVISION_CONFLICT");
    await expect(
      store.apply({
        requestId: "invalid-last",
        baseRevision: 1,
        operations: [
          { type: "setNodeMetadata", nodeId: "frame", name: "Lost" },
          {
            type: "setNodeMetadata",
            nodeId: "frame",
            scene: { strokes: [{ ...solid(), width: -1 }] },
          },
        ],
      } as any),
    ).rejects.toThrow("INVALID_SCENE");
    expect(store.read()).toEqual(edited);
    expect(await readFile(join(root, "project.json"), "utf8")).toBe(bytes);
    await store.undo("undo", 1);
    expect(store.read()).toEqual({ ...initial, revision: 2 });
    await store.redo("redo", 2);
    await store.close();
    store = await ProjectStore.open(root);
    expect(store.read()).toEqual({ ...edited, revision: 3 });
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
