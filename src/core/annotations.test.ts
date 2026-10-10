import { mkdtemp, rm, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "./store";
import { it, expect } from "vitest";
import {
  parseAnnotations,
  readAnnotations,
  createPageVariant,
} from "./annotations";
import { parseProject, type Project } from "./project";
import { applyBatch } from "./operations";
const base: Project = {
  schemaVersion: 2,
  projectId: "p",
  name: "P",
  revision: 5,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 390 },
      nodes: [
        {
          id: "frame",
          type: "Stack",
          props: { gap: 12 },
          slots: {
            content: [
              {
                id: "text",
                type: "Text",
                props: { text: "Original" },
                slots: {},
              },
            ],
          },
        },
      ],
    },
  ],
};
const note = {
  id: "comment-1",
  pageId: "home",
  nodeId: "text",
  text: "Keep this discussion",
  status: "open" as const,
  createdAt: "2026-10-05T00:00:00.000Z",
};
it("page variants remap every descendant and preserve the original with base-revision provenance", () => {
  const before = JSON.stringify(base);
  const copy = createPageVariant(base, "home", "home-option", "Alternative");
  expect(copy.provenance).toEqual({ sourcePageId: "home", sourceRevision: 5 });
  expect(copy.screenId).toBe("home-option");
  expect(copy.name).toBe("Alternative");
  expect(copy.nodes[0].id).not.toBe("frame");
  expect(copy.nodes[0].slots.content[0].id).not.toBe("text");
  expect(copy.nodes[0].slots.content[0].props.text).toBe("Original");
  copy.nodes[0].slots.content[0].props.text = "Changed variant";
  expect(JSON.stringify(base)).toBe(before);
  expect(() => createPageVariant(base, "home", "home", "Duplicate")).toThrow(
    "PAGE_EXISTS",
  );
});
it("portable discussions retain decisions and become orphaned when their anchor disappears", () => {
  const annotations = parseAnnotations([
    {
      ...note,
      status: "resolved",
      decision: "Use option B",
      proposalId: "proposal-7",
    },
  ]);
  const project = { ...base, annotations };
  expect(readAnnotations(project).annotations[0]).toMatchObject({
    orphaned: false,
    decision: "Use option B",
    proposalId: "proposal-7",
  });
  project.pages = [{ ...base.pages[0], nodes: [] }];
  expect(
    readAnnotations(JSON.parse(JSON.stringify(project))).annotations[0],
  ).toMatchObject({ orphaned: true, text: note.text });
  expect(readAnnotations(project, { orphaned: true }).pagination.total).toBe(1);
});
it("coordinate anchors and statuses reject unknown or malformed fields", () => {
  expect(
    parseAnnotations([{ ...note, nodeId: undefined, x: 10, y: 20 }])[0].x,
  ).toBe(10);
  expect(() => parseAnnotations([{ ...note, status: "approved" }])).toThrow(
    "INVALID_ANNOTATION",
  );
  expect(() => parseAnnotations([{ ...note, x: 10 }])).toThrow(
    "INVALID_ANNOTATION",
  );
  expect(() => parseAnnotations([{ ...note, createdAt: "yesterday" }])).toThrow(
    "INVALID_ANNOTATION",
  );
  expect(() => parseAnnotations([note, note])).toThrow(
    "DUPLICATE_ANNOTATION_ID",
  );
  expect(() =>
    parseAnnotations([{ ...note, secret: "other-project" }]),
  ).toThrow("UNKNOWN_FIELD");
});

it("shared operations and project JSON persist annotations, decisions and variant provenance", () => {
  const edited = applyBatch(base, {
    requestId: "discussion-and-option",
    baseRevision: 5,
    operations: [
      {
        type: "setAnnotations",
        annotations: [
          {
            ...note,
            status: "resolved",
            decision: "Use option",
            proposalId: "review-1",
          },
        ],
      },
      {
        type: "duplicatePage",
        pageId: "home",
        newPageId: "home-option",
        name: "Alternative",
      },
    ],
  });
  const clone = parseProject(JSON.parse(JSON.stringify(edited)));
  expect(clone.revision).toBe(6);
  expect(clone.annotations![0].decision).toBe("Use option");
  expect(clone.pages[1].provenance).toEqual({
    sourcePageId: "home",
    sourceRevision: 5,
  });
  expect(clone.pages[0]).toEqual(base.pages[0]);
  const removed = applyBatch(clone, {
    requestId: "remove-anchor",
    baseRevision: 6,
    operations: [{ type: "removeNode", nodeId: "text" }],
  });
  expect(readAnnotations(removed).annotations[0].orphaned).toBe(true);
});

it("real store restart and project.json-only clone retain decisions, variants and orphaned discussions", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-annotations-store-"));
  const cloneRoot = join(root, "clone");
  let store: ProjectStore | undefined;
  let clone: ProjectStore | undefined;
  try {
    store = await ProjectStore.open(root, { initialProject: base });
    await store.apply({
      requestId: "portable-discussion",
      baseRevision: 5,
      operations: [
        {
          type: "setAnnotations",
          annotations: [
            {
              ...note,
              status: "resolved",
              decision: "Use variant B",
              proposalId: "p-approved",
            },
          ],
        },
        {
          type: "duplicatePage",
          pageId: "home",
          newPageId: "option-b",
          name: "Option B",
        },
        { type: "removeNode", nodeId: "text" },
      ],
    });
    await store.close();
    store = undefined;
    store = await ProjectStore.open(root);
    expect(readAnnotations(store.read()).annotations[0]).toMatchObject({
      orphaned: true,
      decision: "Use variant B",
      proposalId: "p-approved",
    });
    await mkdir(cloneRoot);
    await copyFile(join(root, "project.json"), join(cloneRoot, "project.json"));
    clone = await ProjectStore.open(cloneRoot);
    expect(clone.read().pages[1].provenance).toEqual({
      sourcePageId: "home",
      sourceRevision: 5,
    });
    expect(clone.read().pages[1].nodes[0].slots.content[0].props.text).toBe(
      "Original",
    );
    expect(readAnnotations(clone.read()).annotations).toEqual(
      readAnnotations(store.read()).annotations,
    );
    expect(clone.read().revision).toBe(6);
  } finally {
    await clone?.close();
    await store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
