import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGuides } from "./guides";
import { parseProject, stableStringify } from "./project";
import { sceneProject } from "./scene-fixtures";
import { applyBatch, type Operation } from "./operations";
import { ProjectStore } from "./store";
const guide = { id: "constructor", axis: "x" as const, position: -12.5 };
const apply = (
  project: ReturnType<typeof parseProject>,
  operations: unknown[],
) =>
  applyBatch(project, {
    requestId: "guide-test",
    baseRevision: project.revision,
    operations: operations as Operation[],
  });
it("preserves absent legacy guides and accepts detached closed page-scoped metadata", () => {
  const legacy = sceneProject();
  expect(stableStringify(parseProject(legacy))).toBe(stableStringify(legacy));
  expect(parseProject(legacy).pages[0]).not.toHaveProperty("guides");
  const input = [
    guide,
    { id: "__proto__", axis: "y", position: 1e6, locked: false },
  ];
  const parsed = parseGuides(input, "pages[0].guides");
  expect(parsed).toEqual(input);
  parsed[0].position = 99;
  expect(input[0].position).toBe(-12.5);
  const source = {
    ...legacy,
    pages: legacy.pages.map((page) => ({ ...page, guides: input })),
  };
  expect(parseProject(source)).toEqual(source);
});
it("rejects malformed guides, unknown fields, duplicate IDs and unbounded collections", () => {
  for (const invalid of [
    null,
    {},
    [null],
    [{ ...guide, axis: "z" }],
    [{ ...guide, position: NaN }],
    [{ ...guide, position: Infinity }],
    [{ ...guide, position: 1e6 + 1 }],
    [{ ...guide, id: "" }],
    [{ ...guide, id: "a".repeat(201) }],
    [{ ...guide, locked: 0 }],
    [{ ...guide, style: "color:red" }],
  ])
    expect(() => parseGuides(invalid, "guides")).toThrow("INVALID_GUIDE");
  expect(() => parseGuides([guide, guide], "guides")).toThrow(
    "DUPLICATE_GUIDE",
  );
  expect(() =>
    parseGuides(
      Array.from({ length: 1001 }, (_, i) => ({ ...guide, id: String(i) })),
      "guides",
    ),
  ).toThrow("GUIDE_LIMIT");
});
it("creates, moves, locks and removes guides through atomic operations with page-local IDs", () => {
  const original = parseProject(sceneProject());
  const created = apply(original, [
    { type: "addGuide", pageId: "home", guide },
  ]);
  expect(created.pages[0].guides).toEqual([guide]);
  expect(original.pages[0]).not.toHaveProperty("guides");
  const locked = apply(created, [
    { type: "moveGuide", pageId: "home", guideId: guide.id, position: 40 },
    { type: "setGuideLocked", pageId: "home", guideId: guide.id, locked: true },
  ]);
  expect(locked.pages[0].guides?.[0]).toMatchObject({
    position: 40,
    locked: true,
  });
  for (const type of ["moveGuide", "removeGuide"])
    expect(() =>
      apply(locked, [
        {
          type,
          pageId: "home",
          guideId: guide.id,
          ...(type === "moveGuide" ? { position: 1 } : {}),
        },
      ]),
    ).toThrow("GUIDE_LOCKED");
  expect(() =>
    apply(created, [{ type: "addGuide", pageId: "home", guide }]),
  ).toThrow("DUPLICATE_GUIDE");
  expect(() =>
    apply(created, [
      { type: "moveGuide", pageId: "home", guideId: "missing", position: 2 },
    ]),
  ).toThrow("GUIDE_NOT_FOUND");
  const copy = apply(locked, [
    { type: "duplicatePage", pageId: "home", newPageId: "copy", name: "Copy" },
  ]);
  expect(copy.pages[1].guides).toEqual(locked.pages[0].guides);
  expect(copy.pages[1].guides).not.toBe(copy.pages[0].guides);
  const removed = apply(locked, [
    {
      type: "setGuideLocked",
      pageId: "home",
      guideId: guide.id,
      locked: false,
    },
    { type: "removeGuide", pageId: "home", guideId: guide.id },
  ]);
  expect(removed.pages[0].guides).toEqual([]);
});
it("persists one guide batch with rollback, receipt replay, conflict, Undo/Redo and reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-guides-"));
  let store = await ProjectStore.open(root, {
    initialProject: parseProject(sceneProject()),
  });
  try {
    const batch = {
      requestId: "guide-create",
      baseRevision: 0,
      operations: [{ type: "addGuide", pageId: "home", guide }],
    } as never;
    expect((await store.apply(batch)).revision).toBe(1);
    expect((await store.apply(batch)).revision).toBe(1);
    const bytes = await readFile(join(root, "project.json"), "utf8");
    await expect(
      store.apply({
        requestId: "bad-guide",
        baseRevision: 1,
        operations: [
          { type: "renamePage", pageId: "home", name: "lost" },
          {
            type: "moveGuide",
            pageId: "home",
            guideId: guide.id,
            position: Infinity,
          },
        ],
      } as never),
    ).rejects.toThrow();
    expect(await readFile(join(root, "project.json"), "utf8")).toBe(bytes);
    await expect(
      store.apply({
        requestId: "stale-guide",
        baseRevision: 0,
        operations: [
          {
            type: "moveGuide",
            pageId: "home",
            guideId: guide.id,
            position: 20,
          },
        ],
      } as never),
    ).rejects.toThrow("REVISION_CONFLICT");
    await store.undo("guide-undo", 1);
    expect(store.read().pages[0]).not.toHaveProperty("guides");
    await store.redo("guide-redo", 2);
    expect(store.read().pages[0].guides).toEqual([guide]);
    await store.close();
    store = await ProjectStore.open(root);
    expect(store.read().pages[0].guides).toEqual([guide]);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
