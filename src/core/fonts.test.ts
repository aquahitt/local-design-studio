import { expect, it } from "vitest";
import { parseProject, stableStringify } from "./project";
import { fontAssetPath, projectFontFamily, type ProjectFont } from "./fonts";
import { applyBatch, type Batch } from "./operations";
import { readFile } from "node:fs/promises";
const face: ProjectFont = {
  id: "font-regular",
  name: "Тест Regular",
  assetHash: "a".repeat(64),
  format: "woff2",
  family: "Тест",
  weight: 400,
  style: "normal",
};
async function sample() {
  return JSON.parse(
    await readFile(
      new URL("../../docs/adr/scene-v2-example.json", import.meta.url),
      "utf8",
    ),
  );
}
it("accepts exact project face and px typography without rewriting old documents", async () => {
  const old = await sample();
  expect(stableStringify(parseProject(old))).toBe(stableStringify(old));
  const p = await sample();
  p.fonts = [face];
  p.pages[0].nodes[0].slots.content[0].scene.textStyle = {
    fontId: face.id,
    lineHeight: 24,
    letterSpacing: -0.5,
    align: "start",
    direction: "auto",
  };
  expect(parseProject(p)).toEqual(p);
});
it("rejects malformed descriptor fields with exact paths", async () => {
  for (const [key, value] of Object.entries({
    id: "../font",
    assetHash: "A".repeat(64),
    format: "svg",
    family: { toString: null },
    weight: 400.5,
    style: "url(x)",
    extra: true,
  })) {
    const p = await sample();
    p.fonts = [{ ...face, [key]: value }];
    expect(() => parseProject(p)).toThrow();
    try {
      parseProject(p);
    } catch (e: any) {
      expect(e.path).toBe("fonts[0]." + key);
    }
  }
  const p = await sample();
  p.fonts = [face, face];
  expect(() => parseProject(p)).toThrow("DUPLICATE_FONT");
});
it("validates text fields, references and non-text restrictions", async () => {
  for (const style of [
    { fontId: "missing" },
    { lineHeight: 0 },
    { lineHeight: "24" },
    { letterSpacing: {} },
    { align: "left" },
    { direction: "initial" },
    { fontFamily: "url(x)" },
  ]) {
    const p = await sample();
    p.pages[0].nodes[0].slots.content[0].scene.textStyle = style;
    expect(() => parseProject(p)).toThrow();
  }
  const p = await sample();
  p.pages[0].nodes[0].scene.textStyle = {};
  expect(() => parseProject(p)).toThrow("INVALID_TEXT_STYLE");
  const safe = await sample();
  safe.pages[0].nodes[0].slots.content[0].scene.textStyle = { lineHeight: 20 };
  expect(parseProject(safe)).toEqual(safe);
});
it("rejects missing font references in inactive component definitions", async () => {
  const p = await sample();
  p.designComponents[0].nodes[0].scene = {
    kind: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    textStyle: { fontId: "missing" },
  };
  expect(() => parseProject(p)).toThrow("MISSING_FONT");
});
it("adds and replaces faces atomically while preserving referenced IDs", async () => {
  const original = parseProject(await sample());
  const id = original.pages[0].nodes[0].slots.content[0].id;
  const batch = {
    requestId: "font",
    baseRevision: original.revision,
    operations: [
      { type: "addProjectFont", font: face },
      {
        type: "setNodeMetadata",
        nodeId: id,
        scene: { textStyle: { fontId: face.id } },
      },
    ],
  } as Batch;
  const p = applyBatch(original, batch);
  expect(p.fonts).toEqual([face]);
  const remove = {
    requestId: "remove",
    baseRevision: p.revision,
    operations: [{ type: "removeProjectFont", fontId: face.id }],
  } as Batch;
  expect(() => applyBatch(p, remove)).toThrow("MISSING_FONT");
  expect(p.fonts).toEqual([face]);
  const replacement = { ...face, id: "replacement" };
  const next = applyBatch(p, {
    requestId: "replace",
    baseRevision: p.revision,
    operations: [
      { type: "addProjectFont", font: replacement },
      {
        type: "setNodeMetadata",
        nodeId: id,
        scene: { textStyle: { fontId: replacement.id } },
      },
      { type: "removeProjectFont", fontId: face.id },
    ],
  });
  expect(next.fonts).toEqual([replacement]);
  expect(() =>
    applyBatch(original, {
      ...batch,
      operations: [
        ...batch.operations,
        { type: "removeProjectFont", fontId: "absent" },
      ],
    }),
  ).toThrow("FONT_NOT_FOUND");
  expect(original.fonts).toBeUndefined();
  expect(() =>
    applyBatch(p, {
      requestId: "rename",
      baseRevision: p.revision,
      operations: [
        {
          type: "updateProjectFont",
          fontId: face.id,
          font: { ...face, id: "different" },
        },
      ],
    }),
  ).toThrow("FONT_ID_MISMATCH");
  expect(
    applyBatch(p, {
      requestId: "rename-ok",
      baseRevision: p.revision,
      operations: [
        {
          type: "updateProjectFont",
          fontId: face.id,
          font: { ...face, name: "Новое имя" },
        },
      ],
    }).fonts?.[0].name,
  ).toBe("Новое имя");
});
it("publishes optional exact face and px text style schemas", async () => {
  const { projectSchema, batchSchema } = await import("../service/schema");
  expect(projectSchema.properties).toHaveProperty("fonts");
  expect(projectSchema.$defs.scene.properties).toHaveProperty("textStyle");
  const operations = (batchSchema.properties.operations as any).items.oneOf.map(
    (op: any) => op.properties.type.const,
  );
  expect(operations).toEqual(
    expect.arrayContaining([
      "addProjectFont",
      "updateProjectFont",
      "removeProjectFont",
    ]),
  );
});

it("bounds faces, numeric text fields and computes safe byte paths independently of display metadata", async () => {
  const p = await sample();
  p.fonts = Array.from({ length: 129 }, (_, i) => ({
    ...face,
    id: "font-" + i,
  }));
  expect(() => parseProject(p)).toThrow("INVALID_FONTS");
  for (const value of [null, {}, "fonts", [null]]) {
    const p = await sample();
    p.fonts = value;
    expect(() => parseProject(p)).toThrow();
  }
  for (const invalid of [
    { weight: 0 },
    { weight: 1001 },
    { name: " x " },
    { family: "bad\nfamily" },
    { assetHash: "../secret" },
    { format: { toString: null } },
  ]) {
    const p = await sample();
    p.fonts = [{ ...face, ...invalid }];
    expect(() => parseProject(p)).toThrow();
  }
  for (const value of [Number.NaN, Infinity, -Infinity, 1_000_001]) {
    const p = await sample();
    p.pages[0].nodes[0].slots.content[0].scene.textStyle = {
      lineHeight: value,
    };
    expect(() => parseProject(p)).toThrow();
  }
  expect(fontAssetPath(face)).toBe("assets/" + face.assetHash + ".woff2");
  expect(
    projectFontFamily({
      ...face,
      name: "url(javascript:evil)",
      family: "a; color:red",
    }),
  ).toBe(projectFontFamily(face));
});
it("rejects trailing line terminators in byte hashes and referenced IDs", async () => {
  for (const patch of [
    { id: "font\n" },
    { assetHash: face.assetHash + "\n" },
  ]) {
    const p = await sample();
    p.fonts = [{ ...face, ...patch }];
    expect(() => parseProject(p)).toThrow("INVALID_FONT");
  }
  const p = await sample();
  p.fonts = [face];
  p.pages[0].nodes[0].slots.content[0].scene.textStyle = {
    fontId: face.id + "\n",
  };
  expect(() => parseProject(p)).toThrow("INVALID_TEXT_STYLE");
});
