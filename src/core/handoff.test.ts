import { expect, it } from "vitest";
import { createReactHandoff, inspectModel } from "./handoff";
import type { Project } from "./project";
import { libraryMetadata } from "../library/sdk";
import { builtinLibrary } from "../library/builtin";
const project: Project = {
  schemaVersion: 2,
  projectId: "handoff",
  name: "Handoff",
  revision: 3,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: { title: { type: "string", value: "Token heading" } },
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 390, height: 600 },
      nodes: [
        {
          id: "text",
          type: "Text",
          props: { text: { $token: "title" } },
          slots: {},
        },
      ],
    },
  ],
};
const libraries = [libraryMetadata(builtinLibrary)];
it("handoff records registered component mapping, resolved tokens and explicit trusted-runtime requirements", () => {
  const result = createReactHandoff(
    project,
    { pageId: "home", revision: 3 },
    libraries,
  );
  expect(result.supported).toBe(true);
  expect(result.manifest.requiredLibrary).toEqual(project.library);
  expect(result.manifest.components).toMatchObject([
    { type: "Text", fields: ["text"] },
  ]);
  expect(result.files["Screen.tsx"]).toContain("Token heading");
  expect(result.files["Runtime.tsx"]).toContain("definition.render");
  expect(result.files["tokens.json"]).toContain('"title"');
  expect(result.files["tokens.css"]).toContain('--title: "Token heading"');
  expect(result.requirements.join(" ")).toContain("builtin@1");
  expect(result.files).not.toHaveProperty("library.js");
});
it("inspection preserves token refs and component mapping without fabricating computed styles", () => {
  const result = inspectModel(
    project,
    { pageId: "home", revision: 3, nodeId: "text" },
    libraries,
  );
  expect(result.resolvedProps.text).toBe("Token heading");
  expect(result.tokenRefs).toEqual([
    { path: "props.text", token: "title", value: "Token heading" },
  ]);
  expect(result.component).toMatchObject({
    libraryId: "builtin",
    version: "1",
    type: "Text",
  });
  expect(result.modelStyle.padding).toBe(8);
});
it("unknown registered mappings return diagnostics and stale revisions never export", () => {
  const unknown = {
    ...project,
    pages: [
      {
        ...project.pages[0],
        nodes: [{ ...project.pages[0].nodes[0], type: "PrivateContext" }],
      },
    ],
  };
  const result = createReactHandoff(
    unknown,
    { pageId: "home", revision: 3 },
    libraries,
  );
  expect(result.supported).toBe(false);
  expect(result.diagnostics).toMatchObject([
    { code: "UNREGISTERED_COMPONENT", nodeId: "text" },
  ]);
  expect(() =>
    createReactHandoff(project, { pageId: "home", revision: 2 }, libraries),
  ).toThrow("REVISION_CONFLICT");
});

it("themed prefixed tokens keep one CSS prefix and match the preview variable contract", () => {
  const themed = {
    ...project,
    theme: "dark",
    tokens: {
      "--bg": {
        type: "color" as const,
        value: "#ffffff",
        themes: { dark: "#101010" },
      },
    },
  };
  const metadata = [
    {
      ...libraries[0],
      themes: [...libraries[0].themes, { id: "dark", name: "Dark" }],
    },
  ];
  themed.pages = [
    {
      ...project.pages[0],
      nodes: [{ ...project.pages[0].nodes[0], props: { text: "Themed page" } }],
    },
  ];
  const result = createReactHandoff(
    themed,
    { pageId: "home", revision: 3 },
    metadata,
  );
  expect(result.files["tokens.css"]).toContain("--bg: #101010");
  expect(result.files["tokens.css"]).not.toContain("----bg");
  expect(result.files["Screen.tsx"]).toContain('"--bg":"#101010"');
});
