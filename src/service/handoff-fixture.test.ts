import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { build as viteBuild } from "vite";
import react from "@vitejs/plugin-react";
import { build as bundle } from "esbuild";
import { chromium } from "@playwright/test";
import { createReactHandoff } from "../core/handoff";
import { libraryMetadata } from "../library/sdk";
import { builtinLibrary } from "../library/builtin";
import type { Project } from "../core/project";
import { renderSnapshot } from "./render";
import { inspectDocument } from "./inspect";
const require = createRequire(import.meta.url);

it.each(["components", "scene"])("exported %s screen builds and renders in an isolated fixture with matching real styles and spacing", async (mode) => {
  const project: Project = {
    schemaVersion: 2,
    projectId: "fixture",
    name: "Fixture",
    revision: 2,
    library: { id: "builtin", version: "1" },
    theme: "light",
    tokens: { label: { type: "string", value: "Exported actual component" }, sample: { type: "string", value: "Line\nnext" } },
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 390, height: 600 },
        nodes: [
          {
            id: "stack",
            type: "Stack",
            props: { gap: 16 },
            slots: {
              content: [
                {
                  id: "text",
                  type: "Text",
                  props: { text: { $token: "label" } },
                  slots: {},
                },
                {
                  id: "button",
                  type: "Button",
                  props: { label: "Fixture button" },
                  slots: {},
                },
              ],
            },
          },
        ],
      },
    ],
  };
  if (mode === "scene") {
    const stack = project.pages[0].nodes[0];
    stack.scene = { kind: "component", x: 10, y: 20, width: 280, height: 160 };
    project.pages[0].nodes = [{ id: "frame", type: "SceneFrame", props: {},
      scene: { kind: "frame", x: 40, y: 30, width: 300, height: 200,
        stroke: "#123456", strokeWidth: 10, clip: true },
      slots: { content: [stack] } }];
  }
  const metadata = [libraryMetadata(builtinLibrary)];
  const exported = createReactHandoff(
    project,
    { pageId: "home", revision: 2 },
    metadata,
  );
  const root = await mkdtemp(join(tmpdir(), "studio-react-fixture-"));
  let server: ReturnType<typeof createServer> | undefined;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, contents] of Object.entries(exported.files))
      await writeFile(join(root, name), contents);
    const providerRoot = join(root, "node_modules/@fixture/registered-library");
    await mkdir(providerRoot, { recursive: true });
    await writeFile(
      join(providerRoot, "package.json"),
      JSON.stringify({
        name: "@fixture/registered-library",
        type: "module",
        exports: "./index.js",
      }),
    );
    // The export does not distribute this code. The integrator supplies the explicitly registered real runtime as a dependency.
    await bundle({
      stdin: {
        contents: `export {builtinLibrary as library} from ${JSON.stringify(resolve("src/library/builtin.tsx"))}`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      platform: "browser",
      format: "esm",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      outfile: join(providerRoot, "index.js"),
    });
    await writeFile(
      join(root, "main.tsx"),
      'import {createRoot} from "react-dom/client";import {Screen} from "./Screen";import {library} from "@fixture/registered-library";createRoot(document.getElementById("root")!).render(<Screen library={library}/>);',
    );
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
    );
    const alias = [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
    ].map((name) => ({
      find: new RegExp("^" + name.replaceAll("/", "\\/") + "$"),
      replacement: require.resolve(name),
    }));
    await viteBuild({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [react()],
      resolve: { alias },
      build: { outDir: "dist" },
    });
    server = createServer((req, res) => {
      void (async () => {
        try {
          const path = (req.url ?? "/").split("?")[0],
            file = join(root, "dist", path === "/" ? "index.html" : path);
          res.setHeader(
            "Content-Type",
            extname(file) === ".js"
              ? "text/javascript"
              : extname(file) === ".css"
                ? "text/css"
                : "text/html",
          );
          res.end(await readFile(file));
        } catch {
          res.writeHead(404);
          res.end();
        }
      })();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    const page = await browser.newPage({
      viewport: { width: 390, height: 600 },
    });
    await page.goto(`http://127.0.0.1:${address.port}`, {
      waitUntil: "networkidle",
    });
    expect(await page.locator('[data-node-id="text"] p').textContent()).toBe(
      "Exported actual component",
    );
    expect(
      await page.getByRole("button", { name: "Fixture button" }).isVisible(),
    ).toBe(true);
    const styles = await page
      .locator('[data-node-id="text"]')
      .evaluate((node) => ({
        bounds: node.getBoundingClientRect().toJSON(),
        fontSize: getComputedStyle(node.firstElementChild!).fontSize,
        paddingLeft: getComputedStyle(node).paddingLeft,
      }));
    const inspection = await inspectDocument(
      project,
      { pageId: "home", revision: 2, nodeId: "text" },
      metadata,
      renderSnapshot,
    );
    expect(inspection.computedStyles?.content?.["font-size"]).toBe(
      styles.fontSize,
    );
    expect(inspection.computedStyles?.layout["padding-left"]).toBe(
      styles.paddingLeft,
    );
    expect(inspection.bounds?.x).toBe(styles.bounds.x);
    expect(inspection.bounds?.width).toBe(styles.bounds.width);
    expect(inspection.tokenRefs[0].value).toBe("Exported actual component");
    expect(inspection.diagnostics).toEqual([]);
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = '#css-string{white-space:pre;line-height:10px}#css-string::before{content:var(--sample)}';
      document.head.append(style);
      const probe = document.createElement("div"); probe.id = "css-string";
      document.body.append(probe);
    });
    expect((await page.locator("#css-string").boundingBox())?.height).toBe(20);
    if (mode === "scene") {
      const rootBounds = await page.locator(".studio-handoff").boundingBox();
      const frameBounds = await page.locator('[data-node-id="frame"]').boundingBox();
      expect(rootBounds).toMatchObject({ x: 20, y: 20, width: 350, height: 600 });
      expect(frameBounds).toMatchObject({ x: 60, y: 50, width: 300, height: 200 });
      const frame = await inspectDocument(project, { pageId: "home", revision: 2, nodeId: "frame" }, metadata, renderSnapshot);
      expect(frame.bounds).toEqual({ id: "frame", ...frameBounds });
      expect(await page.locator('[data-node-id="frame"]').evaluate(node => getComputedStyle(node).boxShadow)).toContain("inset");
      expect(frame.modelStyle.boxShadow).toBe("inset 0 0 0 10px #123456");
    }
  } finally {
    await browser.close();
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
