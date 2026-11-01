import { expect, it } from "vitest";
import { type Project, type ProjectNode } from "../core/project";
import { usedTextFontIds } from "../core/text-style";
import { collectImagePaintReferences } from "../core/image-paint";
import { previewResourceScope } from "./previewResources";
const text = (id: string, fontId: string, slots = {}): ProjectNode => ({
  id,
  type: "Text",
  props: { text: id },
  slots,
  scene: {
    kind: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    textStyle: { fontId },
  },
});
const image = (id: string, hash: string): ProjectNode => ({
  id,
  type: "SceneFrame",
  props: {},
  slots: {},
  scene: {
    kind: "frame",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    fills: [
      {
        id: "image",
        kind: "image",
        asset: `assets/${hash.repeat(64)}.png`,
        mapping: { mode: "contain", anchor: { x: 0.5, y: 0.5 } },
      },
    ],
  },
});
const selected = text("selected", "selected-font", {
  content: [image("inside", "a")],
});
const nodes = [
  text("ancestor", "ancestor-font", {
    content: [
      selected,
      text("sibling", "missing-font"),
      image("missing-image", "b"),
    ],
  }),
];
const project: Project = {
  schemaVersion: 2,
  projectId: "resources",
  name: "Resources",
  revision: 0,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  pages: [{ screenId: "page", name: "Page", viewport: { width: 390 }, nodes }],
};
it("loads only selected images and retains ancestor fonts without sibling resources", () => {
  const before = JSON.stringify(project);
  const scope = previewResourceScope(project, nodes, "selected");
  expect(
    collectImagePaintReferences(scope.imageNodes, "rendered").map(
      (ref) => ref.asset,
    ),
  ).toEqual([`assets/${"a".repeat(64)}.png`]);
  expect(usedTextFontIds(scope.fontNodes)).toEqual([
    "ancestor-font",
    "selected-font",
  ]);
  expect(scope.fontNodes[0].slots.content.map((node) => node.id)).toEqual([
    "selected",
  ]);
  expect(JSON.stringify(project)).toBe(before);
});
it("preserves full readiness when no hint is supplied", () => {
  const scope = previewResourceScope(project, nodes);
  expect(usedTextFontIds(scope.fontNodes)).toEqual([
    "ancestor-font",
    "selected-font",
    "missing-font",
  ]);
  expect(
    collectImagePaintReferences(scope.imageNodes, "rendered"),
  ).toHaveLength(2);
});
it.each([null, "absent", 2, "constructor", "__proto__"])(
  "rejects invalid and unknown scope %s",
  (id) => {
    expect(() => previewResourceScope(project, nodes, id as string)).toThrow(
      "NODE_NOT_FOUND",
    );
  },
);
it("supports actual canonical prototype-like IDs", () => {
  for (const id of ["constructor", "__proto__"]) {
    const scoped = [{ ...selected, id }];
    expect(previewResourceScope(project, scoped, id).imageNodes[0].id).toBe(id);
  }
});
it("includes resources materialized from the selected reusable instance", () => {
  const instance: ProjectNode = {
    id: "instance",
    type: "DesignComponent",
    props: {},
    slots: {},
    instance: { definitionId: "card" },
    scene: { kind: "frame", x: 0, y: 0, width: 100, height: 80 },
  };
  const p: Project = {
    ...project,
    pages: [{ ...project.pages[0], nodes: [instance] }],
    designComponents: [
      {
        id: "card",
        name: "Card",
        version: 1,
        nodes: [text("label", "card-font"), image("picture", "c")],
      },
    ],
  };
  const scope = previewResourceScope(p, [instance], "instance");
  expect(usedTextFontIds(scope.fontNodes)).toEqual(["card-font"]);
  expect(
    collectImagePaintReferences(scope.imageNodes, "rendered").map(
      (ref) => ref.asset,
    ),
  ).toEqual([`assets/${"c".repeat(64)}.png`]);
});
