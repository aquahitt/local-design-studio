import { expect, it } from "vitest";
import { transform } from "esbuild";
import { parseProject, type ProjectNode } from "./project";
import { sceneProject } from "./scene-fixtures";
import { createReactHandoff } from "./handoff";
import { builtinLibrary } from "../library/builtin";
import { libraryMetadata } from "../library/sdk";
function fixture(unsupported = false, hidden = false) {
  const p = parseProject(sceneProject());
  p.library = { id: "builtin", version: "1" };
  const source: ProjectNode = {
    id: "source",
    type: unsupported ? "Future" : "SceneFrame",
    maskSource: true,
    hidden,
    props: {},
    scene: {
      kind: unsupported ? "component" : "frame",
      x: 20,
      y: 20,
      width: 100,
      height: 60,
      ...(!unsupported ? { fill: "#fff" } : {}),
    },
    slots: unsupported
      ? {
          children: [
            { id: "unknown-child", type: "Future", props: {}, slots: {} },
          ],
        }
      : {},
  };
  p.pages[0].nodes = [
    {
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
      slots: {
        children: [
          source,
          {
            id: "content",
            type: "Button",
            props: { label: "Preserved HTML" },
            slots: {},
            scene: { kind: "component", x: 20, y: 20, width: 100, height: 60 },
          },
        ],
      },
    },
  ];
  return parseProject(p);
}
it("exports known mask sources with an explicit portable mask barrier and original canonical roles", () => {
  const result = createReactHandoff(
    fixture(),
    { pageId: "home", revision: 0 },
    [libraryMetadata(builtinLibrary)],
  );
  expect(result.supported).toBe(true);
  expect(result.diagnostics).toEqual([]);
  expect(result.files["Screen.tsx"]).toContain("maskData");
  expect(result.files["Screen.tsx"]).toContain("waitForResources");
  expect(result.files).toHaveProperty("maskResources.ts");
  expect(result.files).toHaveProperty("resources.ts");
});
it("export diagnoses a visible unsupported mask source but ignores a genuinely hidden source subtree", () => {
  const bad = createReactHandoff(
    fixture(true),
    { pageId: "home", revision: 0 },
    [libraryMetadata(builtinLibrary)],
  );
  expect(bad.supported).toBe(false);
  expect(
    bad.diagnostics.some((d) => d.code === "MASK_SOURCE_UNSUPPORTED"),
  ).toBe(true);
  const hidden = createReactHandoff(
    fixture(true, true),
    { pageId: "home", revision: 0 },
    [libraryMetadata(builtinLibrary)],
  );
  expect(hidden.supported).toBe(true);
  expect(hidden.diagnostics).toEqual([]);
});
it("generated mask readiness is standalone after minification and does not require studio source modules", async () => {
  const result = createReactHandoff(
    fixture(),
    { pageId: "home", revision: 0 },
    [libraryMetadata(builtinLibrary)],
  );
  const compiled = await transform(result.files["maskResources.ts"], {
    loader: "ts",
    format: "cjs",
    minify: true,
    target: "es2022",
  });
  const module = { exports: {} as any };
  new Function("module", "exports", compiled.code)(module, module.exports);
  expect(
    await module.exports
      .createMaskReadinessRuntime({ querySelectorAll: () => [] })
      .wait(),
  ).toEqual({ warnings: [] });
  expect(compiled.code).not.toContain("/src/");
});

it("treats an opacity-zero unsupported source subtree as an empty mask without executing library components", () => {
  const project = fixture(true);
  project.pages[0].nodes[0].slots.children[0].scene!.opacity = 0;
  const result = createReactHandoff(project, { pageId: "home", revision: 0 }, [
    libraryMetadata(builtinLibrary),
  ]);
  expect(result.supported).toBe(true);
  expect(result.diagnostics).toEqual([]);
});
