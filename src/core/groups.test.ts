import { it, expect } from "vitest";
import { parseProject } from "./project";
import { applyBatch } from "./operations";
const project = () =>
  parseProject({
    schemaVersion: 2,
    projectId: "groups",
    name: "Groups",
    revision: 0,
    library: { id: "builtin", version: "1" },
    theme: "light",
    tokens: { accent: { type: "color", value: "#fff" } },
    pages: ["home", "site"].map((screenId) => ({
      screenId,
      name: screenId,
      viewport: { width: 390 },
      nodes: [],
    })),
  });
const group = {
  id: "buyer",
  name: "PWA Buyer",
  pages: ["home"],
  components: ["Button"],
  tokens: ["accent"],
};
it("roundtrips optional groups and applies them atomically", () => {
  const before = project();
  expect(before.groups).toBeUndefined();
  const after = applyBatch(before, {
    requestId: "groups",
    baseRevision: 0,
    operations: [{ type: "setGroups", groups: [group] }],
  });
  expect(after.groups).toEqual([group]);
  expect(before.groups).toBeUndefined();
  expect(() =>
    applyBatch(after, {
      requestId: "stale",
      baseRevision: 0,
      operations: [{ type: "setGroups", groups: [] }],
    }),
  ).toThrow("REVISION_CONFLICT");
});
it("rejects duplicate groups, members and dangling page/token references", () => {
  for (const groups of [
    [group, group],
    [{ ...group, pages: ["missing"] }],
    [{ ...group, tokens: ["missing"] }],
    [{ ...group, components: ["Button", "Button"] }],
    [{ ...group, name: " " }],
    [{ ...group, extra: true }],
  ])
    expect(() => parseProject({ ...project(), groups })).toThrow();
});
it("removes deleted page/token memberships while preserving library memberships", () => {
  const before = parseProject({ ...project(), groups: [group] });
  const after = applyBatch(before, {
    requestId: "clean",
    baseRevision: 0,
    operations: [
      { type: "removePage", pageId: "home" },
      { type: "setTokens", tokens: {} },
    ],
  });
  expect(after.groups?.[0]).toEqual({ ...group, pages: [], tokens: [] });
});
