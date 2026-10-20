import { expect, it } from "vitest";
import { exportReactHandoff } from "./handoff";
import { createReactHandoff } from "../core/handoff";
import type { Project } from "../core/project";
import type { ProjectFont } from "../core/fonts";
import { projectFontFamily } from "../core/fonts";
import { builtinLibrary } from "../library/builtin";
import { libraryMetadata } from "../library/sdk";
const font: ProjectFont = {
  id: "face",
  name: 'Human " title',
  family: "Human family",
  assetHash: "c".repeat(64),
  format: "woff2",
  weight: 400,
  style: "normal",
};
const p: Project = {
  schemaVersion: 2,
  projectId: "font-handoff",
  name: "Fonts",
  revision: 1,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  fonts: [font, { ...font, id: "unused", assetHash: "d".repeat(64) }],
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 390 },
      nodes: [
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
            height: 30,
            textStyle: { fontId: font.id, lineHeight: 23 },
          },
        },
      ],
    },
  ],
};
const libraries = [libraryMetadata(builtinLibrary)];
it("packages only used project faces with portable CSS, provenance and shared text style", async () => {
  const result = await exportReactHandoff(
    p,
    { pageId: "home", revision: 1 },
    libraries,
    async () => new Uint8Array([1, 2, 3]),
  );
  expect(result.assetPaths).toEqual([`assets/${font.assetHash}.woff2`]);
  expect(result.assets[0].mediaType).toBe("font/woff2");
  expect(result.manifest.fonts).toEqual([
    { ...font, path: `assets/${font.assetHash}.woff2`, provenance: "project" },
  ]);
  expect(result.files["fonts.css"]).toContain(projectFontFamily(font));
  expect(result.files["fonts.css"]).not.toContain(font.name);
  expect(result.files["fonts.css"]).not.toContain("local(");
  expect(result.files["Screen.tsx"]).toContain('import "./fonts.css"');
  expect(result.files["Screen.tsx"]).toContain('"lineHeight":"23px"');
  expect(result.files["Runtime.tsx"]).toContain("node.contentStyle");
  expect(result.supported).toBe(true);
});
it("does not declare fidelity when an exported font is missing", async () => {
  const result = await exportReactHandoff(
    p,
    { pageId: "home", revision: 1 },
    libraries,
    async () => {
      throw new Error("missing");
    },
  );
  expect(result.supported).toBe(false);
  expect(result.diagnostics[0].code).toBe("MISSING_FONT");
  expect(JSON.parse(result.files["manifest.json"]).diagnostics[0].code).toBe(
    "MISSING_FONT",
  );
  expect(
    createReactHandoff(
      { ...p, fonts: [], pages: [{ ...p.pages[0], nodes: [] }] },
      { pageId: "home", revision: 1 },
      libraries,
    ).files["fonts.css"],
  ).toBe("");
});
