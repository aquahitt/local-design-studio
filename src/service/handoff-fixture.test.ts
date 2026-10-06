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

it("exported registered screen builds and renders in an isolated fixture with matching real styles and spacing", async () => {
  const project: Project = {
    schemaVersion: 2,
    projectId: "fixture",
    name: "Fixture",
    revision: 2,
    library: { id: "builtin", version: "1" },
    theme: "light",
    tokens: { label: { type: "string", value: "Exported actual component" } },
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
  } finally {
    await browser.close();
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
