import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { zipSync, unzipSync, strToU8 } from "fflate";
import type { Project } from "../core/project";
import { libraryMetadata } from "../library/sdk";
import { builtinLibrary } from "../library/builtin";
import { exportReactHandoff } from "./handoff";

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="red"/></svg>');
const asset = `assets/${createHash("sha256").update(svg).digest("hex")}.svg`;
const project: Project = {
  schemaVersion: 2, projectId: "image-export", revision: 3, name: "Image export",
  theme: "light", tokens: {}, library: { id: "builtin", version: "1" },
  pages: [{ screenId: "home", name: "Home", viewport: { width: 390, height: 600 },
    nodes: [{ id: "image", type: "StudioImage", props: { src: asset }, slots: {} }] }],
};
const libraries = [libraryMetadata(builtinLibrary)];

it("exports immutable local image bytes into the portable ZIP without project mutation", async () => {
  const original = JSON.stringify(project);
  const exported = await exportReactHandoff(project, { pageId: "home", revision: 3 }, libraries, async () => svg);
  expect(exported.supported).toBe(true);
  expect(exported.manifest.assets).toEqual([asset]);
  const entries = Object.fromEntries(Object.entries(exported.files).map(([path, text]) => [path, strToU8(text)]));
  for (const row of exported.assets) entries[row.path] = Buffer.from(row.data, "base64");
  expect(Buffer.from(unzipSync(zipSync(entries))[asset])).toEqual(svg);
  expect(JSON.stringify(project)).toBe(original);
});

it("does not call a corrupt or active image a complete portable export", async () => {
  for (const bytes of [Buffer.from("corrupt"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]) {
    const snapshot = structuredClone(project);
    if (bytes.toString().includes("<script>")) snapshot.pages[0].nodes[0].props.src = `assets/${createHash("sha256").update(bytes).digest("hex")}.svg`;
    const result = await exportReactHandoff(snapshot, { pageId: "home", revision: 3 }, libraries, async () => bytes);
    expect(result.supported).toBe(false);
    expect(result.assets).toEqual([]);
    expect(result.diagnostics).toMatchObject([{ code: "MISSING_ASSET" }]);
  }
});
