import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  mkdir,
  writeFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import * as react from "react";
import * as reactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { DesktopLibraries } from "../../desktop/libraries";
const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "studio-libraries-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("requires explicit operator trust and persists roots separately from projects", async () => {
  const settings = await temp();
  const project = await temp();
  const root = resolve("examples/library/external");
  const libraries = new DesktopLibraries(settings);
  await expect(libraries.configure(project, root, false)).rejects.toThrow(
    "LIBRARY_TRUST_REQUIRED",
  );
  expect(await libraries.load(project)).toBeUndefined();
  const bundle = await libraries.configure(project, root, true);
  expect(bundle.metadata.id).toBe("external-example");
  const restored = await new DesktopLibraries(settings).load(project);
  expect(restored?.metadata).toEqual(bundle.metadata);
  const preferences = JSON.parse(await readFile(join(settings, "libraries.json"), "utf8"));
  expect(preferences[await realpath(project)]).toBe(await realpath(root));
  await libraries.clear(project);
  expect(await new DesktopLibraries(settings).load(project)).toBeUndefined();
});
it("compiles the public TSX SDK library without loading its code into the owner", async () => {
  const libraries = new DesktopLibraries(await temp());
  const bundle = await libraries.configure(
    await temp(),
    resolve("examples/library/external"),
    true,
  );
  (globalThis as any).__studioRuntime = {
    react,
    reactDOM,
    jsxRuntime,
    jsxDevRuntime,
  };
  const { default: library } = await import(
    /* @vite-ignore */ pathToFileURL(join(bundle.root, "library.js")).href
  );
  expect(
    renderToStaticMarkup(
      createElement(library.components.Notice.render, {
        message: "Runtime connected",
      }),
    ),
  ).toContain("Runtime connected");
  expect(bundle.files).toContain("library.js");
  expect(bundle.files).toContain("library.css");
});
it("rejects symbolic links in operator preference files", async () => {
  const settings = await temp();
  const outside = await temp();
  await writeFile(join(outside, "settings.json"), "{}");
  await symlink(
    join(outside, "settings.json"),
    join(settings, "libraries.json"),
  );
  await expect(
    new DesktopLibraries(settings).load(await temp()),
  ).rejects.toThrow("UNSAFE_SYMLINK");
});
it("does not compile a library root supplied inside project data", async () => {
  const project = await temp();
  await writeFile(
    join(project, "project.json"),
    JSON.stringify({ library: { root: resolve("examples/library/external") } }),
  );
  expect(
    await new DesktopLibraries(await temp()).load(project),
  ).toBeUndefined();
});
it("inspects metadata without executing library top-level code", async () => {
  const root = await temp();
  const manifest = JSON.parse(
    await readFile(
      resolve("examples/library/external/studio.library.json"),
      "utf8",
    ),
  );
  manifest.entry = "library.tsx";
  await writeFile(join(root, "studio.library.json"), JSON.stringify(manifest));
  await writeFile(
    join(root, "library.tsx"),
    "throw new Error('EDITOR_EXECUTED_LIBRARY'); export const library = {};",
  );
  const bundle = await new DesktopLibraries(await temp()).configure(
    await temp(),
    root,
    true,
  );
  expect(bundle.metadata.id).toBe("external-example");
});
