import { parseProject as canonicalProject } from "./project";
import { expect, it } from "vitest";
import { validateFramePaint, compileFramePaint } from "./paint";
import {
  compileFramePaintTree,
  imageMappingMatrix,
  collectImagePaintReferences,
} from "./image-paint";
const asset = "assets/" + "a".repeat(64) + ".png";
const paint = {
  id: "photo",
  kind: "image",
  asset,
  mapping: { mode: "cover", anchor: { x: 0.2, y: 0.8 } },
};
const scene = { kind: "frame", x: 0, y: 0, width: 200, height: 100, fills: [paint] };
it("validates closed local image mappings and numerical safety", () => {
  for (const mapping of [
    paint.mapping,
    { mode: "contain", anchor: { x: 0, y: 1 } },
    { mode: "crop", imageToFrame: [100, 0, 0.2, 80, -20, 4] },
    { mode: "tile", imageToFrame: [-100, 0, 0, 100, 0, 0] },
  ])
    expect(() =>
      validateFramePaint({ ...scene, fills: [{ ...paint, mapping }] }, "scene")
    ).not.toThrow();
  for (const bad of [
    { ...paint, asset: "https://example.org/a.png" },
    { ...paint, asset: asset + "?x" },
    { ...paint, mapping: { mode: "cover", anchor: { x: 2, y: 0 } } },
    { ...paint, mapping: { mode: "cover", anchor: { x: 0, y: 0 }, extra: true } },
    { ...paint, mapping: { mode: "crop", imageToFrame: [0, 0, 0, 0, 0, 0] } },
    { ...paint, mapping: { mode: "tile", imageToFrame: [1, 0, 0, 1, Infinity, 0] } },
  ])
    expect(() => validateFramePaint({ ...scene, fills: [bad] }, "scene")).toThrow();
});
it("uses continuous CSS object-position and a matching fit-to-crop matrix", () => {
  expect(
    imageMappingMatrix(
      paint.mapping as never,
      { width: 100, height: 100 },
      { width: 200, height: 100 }
    )
  ).toEqual([200, 0, 0, 200, 0, -80]);
  const tree = compileFramePaintTree("n", scene as never)!;
  expect(tree.children[0].children[0]).toMatchObject({
    tag: "img",
    props: { src: asset, alt: "", style: { objectFit: "cover", objectPosition: "20% 80%" } },
  });
  expect(compileFramePaint(scene as never).backgroundImage).toBe("none");
});
it("preserves CSS-only path and ignores disabled images for rendering but collects all refs", () => {
  const off = { ...scene, fills: [{ ...paint, enabled: false }] };
  expect(compileFramePaintTree("n", off as never)).toBeUndefined();
  expect(compileFramePaint(off as never)).toEqual({
    backgroundColor: "transparent",
    backgroundImage: "none",
    backgroundBlendMode: "normal",
  });
  const node = { id: "n", scene: off, slots: {}, props: {}, type: "Frame" };
  expect(collectImagePaintReferences([node] as never, "all")).toEqual([
    { nodeId: "n", paintId: "photo", asset },
  ]);
  expect(collectImagePaintReferences([node] as never)).toEqual([]);
});

it("layers top-first fills below inset effects, with collision-safe tile IDs for hostile legal IDs", () => {
  const tiled = (id: string) => ({
    ...paint,
    id,
    mapping: { mode: "tile", imageToFrame: [100, 0, 0, 100, 0, 0] },
  });
  const make = (nodeId: string, id: string) =>
    compileFramePaintTree(nodeId, {
      ...scene,
      radius: 12,
      stroke: "#f00",
      strokeWidth: 3,
      shadows: [
        {
          id: "inner",
          kind: "inner",
          x: 1,
          y: 2,
          blur: 3,
          spread: 4,
          color: { r: 0, g: 0, b: 0, a: 1 },
        },
        {
          id: "outer",
          kind: "outer",
          x: 2,
          y: 2,
          blur: 4,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
      fills: [tiled(id), { id: "solid", kind: "solid", color: { r: 255, g: 0, b: 0, a: 1 } }],
    } as never)!;
  const tree = make("__proto__", "constructor");
  expect(tree.props.style).toMatchObject({
    overflow: "hidden",
    borderRadius: 12,
    isolation: "isolate",
    pointerEvents: "none",
  });
  expect(tree.children[0].props.style).toMatchObject({
    backgroundImage: "linear-gradient(rgba(255, 0, 0, 1), rgba(255, 0, 0, 1))",
  });
  expect(tree.children.at(-1)?.props.style).toMatchObject({
    boxShadow: "inset 0 0 0 3px #f00, inset 1px 2px 3px 4px rgba(0, 0, 0, 1)",
  });
  expect(tree.children.at(-1)?.props.style).toHaveProperty("borderRadius", "inherit");
  const id = (t: typeof tree) => t.children[1].children[0].children[0].children[0].props.id;
  expect(
    new Set([
      id(tree),
      id(make("😀", "x")),
      id(make("\ud83d", "x")),
      id(make("a", "b:c")),
      id(make("a:b", "c")),
    ]).size
  ).toBe(5);
  expect(
    compileFramePaint({
      ...scene,
      shadows: [
        {
          id: "i",
          kind: "inner",
          x: 0,
          y: 0,
          blur: 1,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    } as never)
  ).not.toHaveProperty("boxShadow");
});

it("schema and parser agree on image mapping shape", async () => {
  const { AjvJsonSchemaValidator } = await import("@modelcontextprotocol/sdk/validation/ajv");
  const { projectSchema } = await import("../service/schema");
  const { sceneProject } = await import("./scene-fixtures");
  const { parseProject } = await import("./project");
  const project = canonicalProject(sceneProject());
  project.pages[0].nodes[0].scene!.fills = [paint as never];
  const validator = new AjvJsonSchemaValidator().getValidator(projectSchema as any);
  expect(validator(project).valid).toBe(true);
  expect(parseProject(project)).toEqual(project);
  project.pages[0].nodes[0].scene!.fills = [
    { ...paint, mapping: { mode: "crop", imageToFrame: [1, 0, 0, 1, 0] } } as never,
  ];
  expect(validator(project).valid).toBe(false);
  expect(() => parseProject(project)).toThrow();
});

it("persists one image edit with atomic rollback, idempotence, undo/redo and reopen", async () => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ProjectStore } = await import("./store");
  const { sceneProject } = await import("./scene-fixtures");
  const root = await mkdtemp(join(tmpdir(), "image-paint-"));
  let store = await ProjectStore.open(root, { initialProject: canonicalProject(sceneProject()) });
  try {
    const batch = {
      requestId: "image",
      baseRevision: 0,
      operations: [{ type: "setNodeMetadata", nodeId: "frame", scene: { fills: [paint] } }],
    } as any;
    await store.apply(batch);
    expect((await store.apply(batch)).revision).toBe(1);
    const bytes = await readFile(join(root, "project.json"), "utf8");
    await expect(
      store.apply({
        requestId: "bad",
        baseRevision: 1,
        operations: [
          { type: "setNodeMetadata", nodeId: "frame", name: "lost" },
          {
            type: "setNodeMetadata",
            nodeId: "frame",
            scene: { fills: [{ ...paint, asset: "../private.png" }] },
          },
        ],
      } as any)
    ).rejects.toThrow("INVALID_SCENE");
    expect(await readFile(join(root, "project.json"), "utf8")).toBe(bytes);
    await store.undo("undo", 1);
    expect(store.read().pages[0].nodes[0].scene).not.toHaveProperty("fills");
    await store.redo("redo", 2);
    await store.close();
    store = await ProjectStore.open(root);
    expect(store.read().pages[0].nodes[0].scene!.fills).toEqual([paint]);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects external references, non-finite and non-invertible UV maps without guessing SVG dimensions", () => {
  const validate = (patch: unknown) => () =>
    validateFramePaint({ ...scene, fills: [{ ...paint, ...(patch as object) }] }, "scene");
  for (const path of [
    "assets/" + "A".repeat(64) + ".png",
    "assets/" + "a".repeat(64) + ".jpg",
    "/assets/" + "a".repeat(64) + ".png",
    "assets/../private.svg",
    "data:image/png;base64,AA",
    "blob:local",
    "file:///tmp/image.png",
    asset + "#x",
  ])
    expect(validate({ asset: path })).toThrow();
  for (const matrix of [
    [1, 0, 0, 1, NaN, 0],
    [1, 0, 0, 1, 1e6 + 1, 0],
    [1, 1, 1, 1, 0, 0],
    [1e-7, 0, 0, 1, 0, 0],
    [1000, 0, 0, 1e-6, 0, 0],
    [1, 0, 0, 1, 0, 0, 4],
  ])
    expect(validate({ mapping: { mode: "crop", imageToFrame: matrix } })).toThrow();
  expect(() =>
    imageMappingMatrix(paint.mapping as never, { width: 0, height: 0 }, { width: 200, height: 100 })
  ).toThrow();
  const matrix = [-100, 0, 20, 80, 12, -3] as [number, number, number, number, number, number];
  expect(
    imageMappingMatrix(
      { mode: "crop", imageToFrame: matrix },
      { width: 0, height: 0 },
      { width: 200, height: 100 }
    )
  ).toEqual(matrix);
  expect(
    imageMappingMatrix(
      { mode: "contain", anchor: { x: 0.25, y: 0.75 } },
      { width: 100, height: 100 },
      { width: 200, height: 100 }
    )
  ).toEqual([100, 0, 0, 100, 25, 0]);
});

it("collects deterministic references with hidden subtrees and shared references", () => {
  const child = { id: "child", scene, props: {}, slots: {}, type: "Frame" };
  const nodes = [
    { id: "hidden", hidden: true, props: {}, slots: { children: [child] }, type: "Frame" },
    child,
    child,
  ] as never;
  expect(collectImagePaintReferences(nodes)).toEqual([
    { nodeId: "child", paintId: "photo", asset },
  ]);
  expect(collectImagePaintReferences(nodes, "all")).toEqual([
    { nodeId: "child", paintId: "photo", asset },
  ]);
});
