import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalPreview } from "./ProposalPreview";
import { builtinLibrary } from "../library/builtin";
import { it, expect } from "vitest";
import { parseProject } from "../core/project";
import { buildProposalPreview } from "./proposalSimulation";
const project = parseProject({
  schemaVersion: 2,
  projectId: "p",
  name: "P",
  revision: 0,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: { accent: { type: "color", value: "#fff" } },
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 390 },
      nodes: [{ id: "t", type: "Text", props: { text: "Before" }, slots: {} }],
    },
  ],
});
it("previews changes without mutating the project ", () => {
  const batch = {
    requestId: "p",
    baseRevision: 0,
    operations: [
      { type: "updateProps" as const, nodeId: "t", props: { text: "After" } },
    ],
  };
  const result = buildProposalPreview(project, batch);
  expect(result.after?.pages[0].nodes[0].props.text).toBe("After");
  expect(result.pageIds).toEqual(["home"]);
  expect(project.pages[0].nodes[0].props.text).toBe("Before");
  expect(project.revision).toBe(0);
});
it("does not silently rebase stale proposals", () => {
  expect(
    buildProposalPreview(project, {
      requestId: "s",
      baseRevision: 9,
      operations: [],
    }).error,
  ).toContain("Устаревшая");
});
it("global tokens affect all screen previews", () => {
  const result = buildProposalPreview(project, {
    requestId: "t",
    baseRevision: 0,
    operations: [
      {
        type: "setTokens",
        tokens: { accent: { type: "color", value: "#000" } },
      },
    ],
  });
  expect(result.pageIds).toEqual(["home"]);
  expect(result.after?.tokens.accent.value).toBe("#000");
});

it("compares added and removed screens without losing either side", () => {
  const result = buildProposalPreview(project, {
    requestId: "pages",
    baseRevision: 0,
    operations: [
      {
        type: "addPage",
        page: {
          screenId: "new",
          name: "New",
          viewport: { width: 768 },
          nodes: [],
        },
      },
      { type: "removePage", pageId: "home" },
    ],
  });
  expect(result.pageIds).toEqual(["home", "new"]);
  expect(project.pages[0].screenId).toBe("home");
  expect(result.after?.pages.map((p) => p.screenId)).toEqual(["new"]);
});

const face = {
  id: "review-font",
  name: "Original face",
  assetHash: "a".repeat(64),
  format: "ttf" as const,
  family: "Test Family",
  weight: 400,
  style: "normal" as const,
};
function fontProject() {
  const p = structuredClone(project);
  p.fonts = [face];
  p.pages[0].nodes[0].scene = {
    kind: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    textStyle: { fontId: face.id },
  };
  p.pages.push({
    screenId: "unrelated",
    name: "Unrelated",
    viewport: { width: 390 },
    nodes: [],
  });
  p.designComponents = [
    {
      id: "review-definition",
      name: "Definition",
      version: 1,
      nodes: [
        {
          id: "definition-text",
          type: "Text",
          props: { text: "Defined font" },
          slots: {},
          scene: {
            kind: "text",
            x: 0,
            y: 0,
            width: 100,
            height: 40,
            textStyle: { fontId: face.id },
          },
        },
      ],
      variants: { alternate: { "definition-text": { text: "Variant font" } } },
    },
  ];
  p.pages.push({
    screenId: "instance-page",
    name: "Instance",
    viewport: { width: 390 },
    nodes: [
      {
        id: "review-instance",
        type: "LocalInstance",
        props: {},
        slots: {},
        instance: { definitionId: "review-definition", variant: "alternate" },
      },
    ],
  });
  p.pages.push({
    screenId: "hidden-page",
    name: "Hidden",
    viewport: { width: 390 },
    nodes: [
      {
        id: "hidden-font",
        type: "Text",
        props: { text: "Hidden" },
        slots: {},
        hidden: true,
        scene: {
          kind: "text",
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          textStyle: { fontId: face.id },
        },
      },
    ],
  });
  return parseProject(p);
}
it("previews exact font byte changes on referenced pages and materialized instances only", () => {
  const before = fontProject(),
    snapshot = structuredClone(before),
    replacement = { ...face, assetHash: "b".repeat(64) };
  const result = buildProposalPreview(before, {
    requestId: "replace-font",
    baseRevision: 0,
    operations: [
      { type: "updateProjectFont", fontId: face.id, font: replacement },
    ],
  });
  expect(result.pageIds).toEqual(["home", "instance-page"]);
  expect(result.fontChanges).toEqual([
    { fontId: face.id, before: face, after: replacement },
  ]);
  expect(before).toEqual(snapshot);
  expect(result.after?.fonts).toEqual([replacement]);
});
it("describes font metadata-only edits without claiming visual page changes", () => {
  const p = fontProject(),
    replacement = { ...face, name: "Renamed face" };
  const result = buildProposalPreview(p, {
    requestId: "rename-font",
    baseRevision: 0,
    operations: [
      { type: "updateProjectFont", fontId: face.id, font: replacement },
    ],
  });
  expect(result.pageIds).toEqual([]);
  expect(result.fontChanges).toEqual([
    { fontId: face.id, before: face, after: replacement },
  ]);
});
it("describes unused font registration and removal without rendering unrelated pages", () => {
  const p = fontProject(),
    extra = { ...face, id: "unused-font", assetHash: "c".repeat(64) };
  const added = buildProposalPreview(p, {
    requestId: "add-font",
    baseRevision: 0,
    operations: [{ type: "addProjectFont", font: extra }],
  });
  expect(added.pageIds).toEqual([]);
  expect(added.fontChanges).toEqual([{ fontId: extra.id, after: extra }]);
  const removed = buildProposalPreview(added.after!, {
    requestId: "remove-font",
    baseRevision: 1,
    operations: [{ type: "removeProjectFont", fontId: extra.id }],
  });
  expect(removed.pageIds).toEqual([]);
  expect(removed.fontChanges).toEqual([{ fontId: extra.id, before: extra }]);
});

it("renders the old and proposed font names for metadata-only changes", () => {
  const p = fontProject();
  const markup = renderToStaticMarkup(
    createElement(ProposalPreview, {
      project: p,
      library: builtinLibrary,
      proposal: {
        id: "font-description",
        description: "Rename font",
        createdAt: "2026-10-20T00:00:00Z",
        status: "pending",
        batch: {
          requestId: "rename-font-ui",
          baseRevision: 0,
          operations: [
            {
              type: "updateProjectFont",
              fontId: face.id,
              font: { ...face, name: "Proposed new face name" },
            },
          ],
        },
      },
    }),
  );
  expect(markup).toContain("Original face");
  expect(markup).toContain("Proposed new face name");
  expect(markup).toContain("Шрифты проекта");
  expect(markup).toContain("Визуальных изменений нет");
  expect(markup).not.toContain("<iframe");
});
it("keeps an exact used-face replacement visible alongside directly edited text", () => {
  const p = fontProject();
  const result = buildProposalPreview(p, {
    requestId: "font-and-text",
    baseRevision: 0,
    operations: [
      {
        type: "updateProjectFont",
        fontId: face.id,
        font: { ...face, weight: 700 },
      },
      { type: "updateProps", nodeId: "t", props: { text: "Reviewed text" } },
    ],
  });
  expect(result.pageIds).toEqual(["home", "instance-page"]);
  expect(result.after?.pages[0].nodes[0].props.text).toBe("Reviewed text");
  expect(result.fontChanges[0].after?.weight).toBe(700);
});
it("includes family metadata changes so preview can display exact-byte validation warnings", () => {
  const p = fontProject();
  const result = buildProposalPreview(p, {
    requestId: "family-mismatch",
    baseRevision: 0,
    operations: [
      {
        type: "updateProjectFont",
        fontId: face.id,
        font: { ...face, family: "Different claimed family" },
      },
    ],
  });
  expect(result.pageIds).toEqual(["home", "instance-page"]);
  expect(result.fontChanges[0].after?.family).toBe("Different claimed family");
});

it("guide proposal preview compares metadata without changing the source document", async () => {
  const { guideProposalChanges } = await import("./proposalSimulation");
  const before = [{ id: "g", axis: "x" as const, position: 20 }];
  const after = [
    { id: "g", axis: "x" as const, position: 40, locked: true },
    { id: "new", axis: "y" as const, position: 80 },
  ];
  const changes = guideProposalChanges(before, after);
  expect(changes).toEqual([
    { id: "g", before: before[0], after: after[0] },
    { id: "new", after: after[1] },
  ]);
  changes[0].before!.position = 100;
  expect(before[0].position).toBe(20);
  const source = structuredClone(project);
  const batch = {
    requestId: "guide-preview",
    baseRevision: source.revision,
    operations: [
      {
        type: "addGuide" as const,
        pageId: "home",
        guide: { id: "g", axis: "x" as const, position: 40 },
      },
    ],
  };
  const proposed = buildProposalPreview(source, batch);
  expect(proposed.pageIds).toEqual(["home"]);
  expect(source.pages[0]).not.toHaveProperty("guides");
  const html = renderToStaticMarkup(
    createElement(ProposalPreview, {
      project: source,
      proposal: {
        id: "guide",
        description: "Guide",
        status: "pending",
        createdAt: "now",
        batch,
      },
      library: builtinLibrary,
    }),
  );
  expect(html).toContain(
    "Направляющие показаны поверх макета и не войдут в экспорт.",
  );
  expect(html).toContain("data-guide-change");
});

it("reviews guides carried by page creation, duplication and deletion", () => {
  const source = structuredClone(project);
  source.pages[0].guides = [
    { id: "page-guide", axis: "y", position: 83, locked: true },
  ];
  source.pages.push({
    screenId: "retained",
    name: "Retained",
    viewport: { width: 390 },
    nodes: [],
  });
  const operations: import("../core/operations").Operation[] = [
    {
      type: "addPage",
      page: {
        ...structuredClone(source.pages[0]),
        screenId: "new-page",
        nodes: [],
      },
    },
    {
      type: "duplicatePage",
      pageId: "home",
      newPageId: "copy-page",
      name: "Copy",
    },
    { type: "removePage", pageId: "home" },
  ];
  for (const operation of operations) {
    const html = renderToStaticMarkup(
      createElement(ProposalPreview, {
        project: source,
        library: builtinLibrary,
        proposal: {
          id: "page-guides",
          description: "Page guides",
          status: "pending",
          createdAt: "now",
          batch: {
            requestId: operation.type,
            baseRevision: source.revision,
            operations: [operation],
          },
        },
      }),
    );
    expect(html).toContain('data-guide-change="page-guide"');
    expect(html).toContain("Y · 83px · Заблокирована");
    expect(html).toContain("Нет направляющей");
  }
});
