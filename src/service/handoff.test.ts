import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "./server";
import { inspectDocument } from "./inspect";
import { exportReactHandoff } from "./handoff";
import { libraryMetadata } from "../library/sdk";
import { builtinLibrary } from "../library/builtin";
import type { Project } from "../core/project";
import type { RenderResult } from "./render";
const project: Project = {
  schemaVersion: 2,
  projectId: "inspect",
  name: "Inspect",
  revision: 4,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 390, height: 600 },
      nodes: [
        { id: "text", type: "Text", props: { text: "Inspect me" }, slots: {} },
      ],
    },
  ],
};
const libraries = [libraryMetadata(builtinLibrary)];
const captured: RenderResult = {
  mimeType: "image/png",
  data: "",
  revision: 4,
  pageId: "home",
  viewport: { width: 390, height: 600 },
  theme: "light",
  bounds: [{ id: "text", x: 20, y: 20, width: 350, height: 60 }],
  warnings: [],
  text: "Inspect me",
  computedStyles: [
    {
      id: "text",
      layout: { "padding-left": "8px" },
      content: { "font-size": "13px", "line-height": "20.8px" },
    },
  ],
};
it("inspection uses recorded browser values and diagnoses missing computed styles", async () => {
  const result = await inspectDocument(
    project,
    { pageId: "home", revision: 4, nodeId: "text" },
    libraries,
    async () => captured,
  );
  expect(result.computedStyles?.content?.["font-size"]).toBe("13px");
  expect(result.bounds?.x).toBe(20);
  expect(result.diagnostics).toEqual([]);
  expect(
    (
      await inspectDocument(
        project,
        { pageId: "home", revision: 4, nodeId: "text" },
        libraries,
      )
    ).diagnostics[0].code,
  ).toBe("COMPUTED_STYLES_UNAVAILABLE");
});
it("owner inspect and handoff routes are read-only revision-bound APIs", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-handoff-api-"));
  const owner = await createStudioServer({
    root,
    port: 0,
    initialProject: project,
    libraryMetadata: libraries,
    renderSnapshot: async () => captured,
  });
  const post = (path: string, body: unknown) =>
    fetch(owner.url + "/api/" + path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  try {
    const inspected = await post("inspect", {
      pageId: "home",
      revision: 4,
      nodeId: "text",
    });
    expect(inspected.status).toBe(200);
    expect((await inspected.json()).computedStyles.content["font-size"]).toBe(
      "13px",
    );
    const exported = await post("handoff", { pageId: "home", revision: 4 });
    expect(exported.status).toBe(200);
    expect((await exported.json()).files["Screen.tsx"]).toContain("Inspect me");
    const stale = await post("handoff", { pageId: "home", revision: 3 });
    expect((await stale.json()).error).toBe("REVISION_CONFLICT");
    const read = await fetch(owner.url + "/api/project", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(await read.json()).toEqual(project);
  } finally {
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("missing local handoff assets remain explicit diagnostics", async () => {
  const imageProject = {
    ...project,
    pages: [
      {
        ...project.pages[0],
        nodes: [
          {
            id: "image",
            type: "StudioImage",
            props: {
              src: "assets/" + "a".repeat(64) + ".png",
              alt: "Local image",
            },
            slots: {},
          },
        ],
      },
    ],
  };
  const result = await exportReactHandoff(
    imageProject,
    { pageId: "home", revision: 4 },
    libraries,
  );
  expect(result.supported).toBe(false);
  expect(result.diagnostics[0].code).toBe("MISSING_ASSET");
  expect(result.assets).toEqual([]);
  expect(result.files["manifest.json"]).toContain("MISSING_ASSET");
});
