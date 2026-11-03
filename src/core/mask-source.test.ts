import { expect, it } from "vitest";
import { parseProject, type ProjectNode } from "./project";
import { sceneProject } from "./scene-fixtures";
import { compileMaskSource } from "./mask-source";
import { serializeMaskSVG, EMPTY_MASK_SVG } from "./mask-svg";
const source = (overrides: Partial<ProjectNode> = {}): ProjectNode => ({
  id: "source",
  type: "SceneFrame",
  props: {},
  slots: {},
  maskSource: true,
  scene: { kind: "frame", x: 20, y: 30, width: 100, height: 80, fill: "#fff" },
  ...overrides,
});
function fixture(node = source()) {
  const project = parseProject(sceneProject());
  const mask: ProjectNode = {
    id: "mask",
    type: "SceneMask",
    props: {},
    scene: {
      kind: "mask",
      maskMode: "alpha",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    },
    slots: { children: [node] },
  };
  project.pages[0].nodes = [mask];
  return { project: parseProject(project), mask };
}
it("compiles only the explicit source with full outside decoration in group coordinates", () => {
  const { project, mask } = fixture();
  mask.slots.children[0].scene!.strokes = [
    {
      id: "outside",
      kind: "solid",
      color: { r: 255, g: 255, b: 255, a: 1 },
      width: 10,
      alignment: "outside",
    },
  ];
  mask.slots.children.push({
    ...source(),
    id: "content",
    maskSource: undefined,
    scene: { kind: "component", x: 1000, y: 1000, width: 300, height: 200 },
  });
  delete mask.slots.children[1].maskSource;
  const descriptor = compileMaskSource(project, mask);
  expect(descriptor).toMatchObject({
    version: 1,
    maskId: "mask",
    sourceId: "source",
    mode: "alpha",
    bounds: { x: 10, y: 20, width: 120, height: 100 },
    diagnostics: [],
  });
  const output = serializeMaskSVG(descriptor);
  expect(output.diagnostics).toEqual([]);
  expect(output.svg).toContain("foreignObject");
  expect(output.svg).not.toContain("data-node-id");
  expect(output.svg).not.toContain("data-studio-paint-envelope");
  expect(output.maskImage).toMatch(/^url\("data:image\/svg\+xml,/);
});
it.each([
  { hidden: true },
  {
    scene: {
      kind: "component" as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      opacity: 0,
    },
  },
])(
  "hidden or transparent source is empty without loading or guessing child content",
  (overrides) => {
    const { project, mask } = fixture(source(overrides));
    const output = serializeMaskSVG(compileMaskSource(project, mask));
    expect(output.diagnostics).toEqual([]);
    expect(output.svg).toBe(EMPTY_MASK_SVG);
  },
);
it("unsupported visible source fails transparent instead of rendering a placeholder", () => {
  const { project, mask } = fixture(
    source({
      type: "UnknownComponent",
      scene: { kind: "component", x: 0, y: 0, width: 100, height: 100 },
    }),
  );
  const output = serializeMaskSVG(compileMaskSource(project, mask));
  expect(output.diagnostics).toContainEqual({
    code: "MASK_SOURCE_UNSUPPORTED",
    nodeId: "source",
    feature: "primitive-kind",
  });
  expect(output.svg).toBe(EMPTY_MASK_SVG);
});
it("never leaves an unresolved nested image for the SVG decoder to draw as a broken-image glyph", () => {
  const { project, mask } = fixture();
  mask.slots.children[0].scene!.fills = [
    {
      id: "picture",
      kind: "image",
      asset: "assets/" + "a".repeat(64) + ".png",
      mapping: { mode: "cover", anchor: { x: 0.5, y: 0.5 } },
    },
  ];
  const output = serializeMaskSVG(compileMaskSource(project, mask));
  expect(
    output.diagnostics.some((d) => d.code === "MASK_IMAGE_UNAVAILABLE"),
  ).toBe(true);
  expect(output.svg).toBe(EMPTY_MASK_SVG);
  expect(output.svg).not.toContain("assets/");
});
it("diagnoses context-dependent colors and oversized source surfaces explicitly", () => {
  const a = fixture();
  a.mask.slots.children[0].scene!.fill = "currentColor";
  expect(
    compileMaskSource(a.project, a.mask).diagnostics.some(
      (d) => d.feature === "context-color",
    ),
  ).toBe(true);
  const b = fixture();
  b.mask.slots.children[0].scene!.width = 9000;
  expect(
    compileMaskSource(b.project, b.mask).diagnostics.some(
      (d) => d.code === "MASK_SOURCE_LIMIT",
    ),
  ).toBe(true);
});
it("an empty source never allocates a huge mask surface just because the group layout is large", () => {
  const { project, mask } = fixture(source({ hidden: true }));
  mask.scene!.width = 1_000_000;
  const descriptor = compileMaskSource(project, mask);
  expect(descriptor.diagnostics).toEqual([]);
  expect(
    descriptor.bounds.width * descriptor.bounds.height,
  ).toBeLessThanOrEqual(1);
  expect(serializeMaskSVG(descriptor).svg).toBe(EMPTY_MASK_SVG);
});
it("translation moves the mask envelope without redecoding identical source pixels", () => {
  const { project, mask } = fixture();
  const first = compileMaskSource(project, mask),
    svg = serializeMaskSVG(first).svg;
  mask.slots.children[0].scene!.x += 17;
  mask.slots.children[0].scene!.y += 60;
  const moved = compileMaskSource(project, mask);
  expect(moved.bounds.x - first.bounds.x).toBe(17);
  expect(moved.bounds.y - first.bounds.y).toBe(60);
  expect(serializeMaskSVG(moved).svg).toBe(svg);
});
it.each(["WindowText", "ButtonHighlight", "ActiveCaption"])(
  "does not reinterpret deprecated system color %s inside a detached SVG",
  (color) => {
    const { project, mask } = fixture();
    mask.slots.children[0].scene!.fill = color;
    expect(compileMaskSource(project, mask).diagnostics).toContainEqual({
      code: "MASK_SOURCE_UNSUPPORTED",
      nodeId: "source",
      feature: "context-color",
    });
  },
);
