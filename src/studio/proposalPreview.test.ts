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
