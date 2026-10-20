import { afterEach, expect, it, vi } from "vitest";
import { createProjectFontLoader, projectFontSource } from "./projectFonts";
import type { Project, ProjectNode } from "../core/project";
import type { ProjectFont } from "../core/fonts";
const font: ProjectFont = {
  id: "regular",
  name: "Тест",
  family: "Тест",
  assetHash: "a".repeat(64),
  format: "woff2",
  weight: 400,
  style: "normal",
};
const nodes: ProjectNode[] = [
  {
    id: "text",
    type: "Text",
    props: { text: "Текст" },
    slots: {},
    scene: {
      kind: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      textStyle: { fontId: font.id },
    },
  },
];
const project = (id = "one"): Project => ({
  schemaVersion: 2,
  projectId: id,
  name: id,
  revision: 0,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  fonts: [font],
  pages: [{ screenId: "page", name: "Page", viewport: { width: 390 }, nodes }],
});
function harness() {
  const loaded: FontFace[] = [];
  const pending: { face: FontFace; resolve: () => void; reject: () => void }[] =
    [];
  const createFace = vi.fn(
    (family: string, source: string, descriptors: FontFaceDescriptors) => {
      let resolve!: () => void, reject!: () => void;
      const promise = new Promise<FontFace>((ok, no) => {
        resolve = () => ok(face);
        reject = () => no(new Error("broken"));
      });
      const face = {
        family,
        source,
        ...descriptors,
        load: () => promise,
      } as unknown as FontFace;
      pending.push({ face, resolve, reject });
      return face;
    },
  );
  const document = {
    fonts: {
      add: (f: FontFace) => loaded.push(f),
      delete: (f: FontFace) => {
        const i = loaded.indexOf(f);
        if (i >= 0) loaded.splice(i, 1);
      },
    },
  } as unknown as Document;
  return { loaded, pending, createFace, document };
}
afterEach(() => vi.useRealTimers());
it("waits for the referenced exact face and never uses a local font source", async () => {
  const h = harness(),
    loader = createProjectFontLoader(h.document, { createFace: h.createFace });
  let ready = false;
  const result = loader.load(project(), nodes).then((r) => {
    ready = true;
    return r;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(h.loaded).toHaveLength(0);
  expect(h.createFace.mock.calls[0]).toEqual([
    expect.stringMatching(/^StudioFont_/),
    'url("' + projectFontSource(font) + '") format("woff2")',
    { weight: "400", style: "normal", display: "block" },
  ]);
  h.pending[0].resolve();
  expect((await result).warnings).toEqual([]);
  expect(h.loaded).toHaveLength(1);
  await loader.load(project(), nodes);
  expect(h.createFace).toHaveBeenCalledTimes(1);
  loader.dispose();
  expect(h.loaded).toHaveLength(0);
});
it("does not add a stale project completion or retain the old project face", async () => {
  const h = harness(),
    loader = createProjectFontLoader(h.document, { createFace: h.createFace });
  const old = loader.load(project("old"), nodes),
    next = loader.load(project("new"), nodes);
  h.pending[0].resolve();
  await old;
  expect(h.loaded).toHaveLength(0);
  h.pending[1].resolve();
  await next;
  expect(h.loaded).toEqual([h.pending[1].face]);
  await loader.load(project("third"), []);
  expect(h.loaded).toHaveLength(0);
});
it("reports failed or timed out faces without hanging readiness or late additions", async () => {
  vi.useFakeTimers();
  const h = harness(),
    loader = createProjectFontLoader(h.document, {
      createFace: h.createFace,
      timeoutMs: 20,
    });
  const failure = loader.load(project(), nodes);
  h.pending[0].reject();
  expect((await failure).warnings[0]).toMatchObject({
    code: "PROJECT_FONT_UNAVAILABLE",
    fontId: font.id,
  });
  const timeout = loader.load(project(), nodes);
  await vi.advanceTimersByTimeAsync(20);
  expect((await timeout).warnings).toHaveLength(1);
  h.pending[1].resolve();
  await Promise.resolve();
  expect(h.loaded).toHaveLength(0);
});
it("loads resolved instance text but skips hidden descendants and unused faces", async () => {
  const h = harness(),
    loader = createProjectFontLoader(h.document, { createFace: h.createFace });
  const p = project();
  await loader.load(p, [{ ...nodes[0], hidden: true }]);
  expect(h.createFace).not.toHaveBeenCalled();
  const missing = {
    ...nodes[0],
    scene: { ...nodes[0].scene!, textStyle: { fontId: "missing" } },
  };
  expect((await loader.load(p, [missing])).warnings[0].code).toBe(
    "PROJECT_FONT_UNAVAILABLE",
  );
});
it("resolves project component definitions and ignores late completion after cancellation", async () => {
  const h = harness(),
    loader = createProjectFontLoader(h.document, { createFace: h.createFace });
  const p = project();
  p.designComponents = [
    { id: "definition", name: "Definition", version: 1, nodes },
  ];
  const instance: ProjectNode = {
    id: "instance",
    type: "SceneFrame",
    props: {},
    slots: {},
    instance: { definitionId: "definition" },
  };
  const old = loader.load(p, [instance]);
  expect(h.createFace).toHaveBeenCalledTimes(1);
  loader.cancel();
  h.pending[0].resolve();
  await old;
  expect(h.loaded).toHaveLength(0);
  await loader.load(p, [instance]);
  expect(h.loaded).toHaveLength(1);
  expect(h.createFace).toHaveBeenCalledTimes(1);
});
