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
import type { Project, ProjectNode } from "../core/project";
import type { Paint, RGBA } from "../core/paint";
import { renderSnapshot } from "./render";
import { inspectDocument } from "./inspect";
import { computedStylesExpression } from "./computed-styles";
import type { RenderComputedStyles } from "./render";
const require = createRequire(import.meta.url);

it.each(["components", "scene", "paint"])(
  "exported %s screen builds and renders in an isolated fixture with matching real styles and spacing",
  async (mode) => {
    const project: Project = {
      schemaVersion: 2,
      projectId: "fixture",
      name: "Fixture",
      revision: 2,
      library: { id: "builtin", version: "1" },
      theme: "light",
      tokens: {
        label: { type: "string", value: "Exported actual component" },
        sample: { type: "string", value: "Line\nnext" },
      },
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
    if (mode !== "components") {
      const stack = project.pages[0].nodes[0];
      stack.scene = {
        kind: "component",
        x: 10,
        y: 20,
        width: 280,
        height: 160,
      };
      project.pages[0].nodes = [
        {
          id: "frame",
          type: "SceneFrame",
          props: {},
          scene: {
            kind: "frame",
            x: 40,
            y: 30,
            width: 300,
            height: 200,
            stroke: "#123456",
            strokeWidth: 10,
            clip: true,
          },
          slots: { content: [stack] },
        },
      ];
    }
    if (mode === "paint") {
      const rgba = (r: number, g: number, b: number, a = 1): RGBA => ({
        r,
        g,
        b,
        a,
      });
      const solid = (
        id: string,
        color: RGBA,
        blendMode: Paint["blendMode"] = "normal",
      ): Paint => ({
        id,
        kind: "solid",
        color,
        blendMode,
      });
      const frame = (
        id: string,
        x: number,
        y: number,
        width: number,
        height: number,
        fills: Paint[],
      ): ProjectNode => ({
        id,
        type: "SceneFrame",
        props: {},
        slots: {},
        scene: { kind: "frame", x, y, width, height, fills },
      });
      Object.assign(project.pages[0].nodes[0].scene!, {
        fills: [
          { ...solid("overlay", rgba(255, 255, 255, 0.25)), opacity: 0.5 },
          {
            id: "gradient",
            kind: "linear",
            angle: 90,
            stops: [
              { offset: 0, color: rgba(255, 0, 0) },
              { offset: 1, color: rgba(0, 0, 255) },
            ],
          },
        ] satisfies Paint[],
        shadows: [
          {
            id: "inner",
            kind: "inner",
            x: 0,
            y: -12,
            blur: 0,
            spread: 0,
            color: rgba(0, 0, 0, 0.5),
          },
          {
            id: "outer",
            kind: "outer",
            x: 0,
            y: 8,
            blur: 0,
            spread: 0,
            color: rgba(0, 0, 0, 0.5),
          },
        ],
      });
      const rounded = frame("rounded", 250, 360, 80, 80, [
        solid("green", rgba(0, 255, 0)),
      ]);
      Object.assign(rounded.scene!, { radius: 20, clip: true });
      rounded.slots.content = [
        frame("clipped-child", 60, 60, 40, 40, [solid("red", rgba(255, 0, 0))]),
      ];
      project.pages[0].nodes.push(
        frame("radial", 20, 260, 120, 120, [
          {
            id: "radial",
            kind: "radial",
            center: { x: 0.25, y: 0.75 },
            radius: { x: 0.5, y: 0.25 },
            stops: [
              { offset: 0, color: rgba(255, 255, 255) },
              { offset: 1, color: rgba(0, 0, 0) },
            ],
          },
        ]),
        frame("alpha", 160, 260, 80, 80, [
          solid("red", rgba(255, 0, 0, 0.5)),
          solid("blue", rgba(0, 0, 255)),
        ]),
        frame("reversed", 250, 260, 80, 80, [
          solid("blue", rgba(0, 0, 255)),
          solid("red", rgba(255, 0, 0, 0.5)),
        ]),
        frame("multiply", 160, 360, 80, 80, [
          solid("orange", rgba(255, 128, 0), "multiply"),
          solid("violet", rgba(128, 128, 255)),
        ]),
        rounded,
      );
    }
    const sourceBefore = JSON.stringify(project);
    const metadata = [libraryMetadata(builtinLibrary)];
    const exported = createReactHandoff(
      project,
      { pageId: "home", revision: 2 },
      metadata,
    );
    expect(exported.diagnostics).toEqual([]);
    const root = await mkdtemp(join(tmpdir(), "studio-react-fixture-"));
    let server: ReturnType<typeof createServer> | undefined;
    const browser = await chromium.launch({ headless: true });
    try {
      for (const [name, contents] of Object.entries(exported.files))
        await writeFile(join(root, name), contents);
      const providerRoot = join(
        root,
        "node_modules/@fixture/registered-library",
      );
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
        style.textContent =
          "#css-string{white-space:pre;line-height:10px}#css-string::before{content:var(--sample)}";
        document.head.append(style);
        const probe = document.createElement("div");
        probe.id = "css-string";
        document.body.append(probe);
      });
      expect((await page.locator("#css-string").boundingBox())?.height).toBe(
        20,
      );
      if (mode === "scene") {
        const rootBounds = await page.locator(".studio-handoff").boundingBox();
        const frameBounds = await page
          .locator('[data-node-id="frame"]')
          .boundingBox();
        expect(rootBounds).toMatchObject({
          x: 20,
          y: 20,
          width: 350,
          height: 600,
        });
        expect(frameBounds).toMatchObject({
          x: 60,
          y: 50,
          width: 300,
          height: 200,
        });
        const frame = await inspectDocument(
          project,
          { pageId: "home", revision: 2, nodeId: "frame" },
          metadata,
          renderSnapshot,
        );
        expect(frame.bounds).toEqual({ id: "frame", ...frameBounds });
        expect(
          await page
            .locator('[data-node-id="frame"]')
            .evaluate((node) => getComputedStyle(node).boxShadow),
        ).toContain("inset");
        expect(frame.modelStyle.boxShadow).toBe("inset 0 0 0 10px #123456");
      }
      if (mode === "paint") {
        const snapshot = await renderSnapshot(project, {
          pageId: "home",
          revision: 2,
        });
        expect(snapshot.warnings).toEqual([]);
        expect(snapshot.viewport).toEqual({ width: 390, height: 600 });
        const bounds: Record<string, { x: number; y: number }> = {};
        for (const id of [
          "frame",
          "stack",
          "radial",
          "alpha",
          "reversed",
          "multiply",
          "rounded",
        ]) {
          const box = await page
            .locator(`[data-node-id="${id}"]`)
            .boundingBox();
          expect(box).not.toBeNull();
          expect(snapshot.bounds.find((bound) => bound.id === id)).toEqual({
            id,
            ...box,
          });
          bounds[id] = box!;
        }
        for (const nodeId of ["frame", "radial", "multiply"]) {
          const actualPaint = await page
            .locator(`[data-node-id="${nodeId}"]`)
            .evaluate((node) => {
              const style = getComputedStyle(node);
              return {
                "background-image": style.backgroundImage,
                "background-blend-mode": style.backgroundBlendMode,
                "box-shadow": style.boxShadow,
              };
            });
          const inspected = await inspectDocument(
            project,
            { pageId: "home", revision: 2, nodeId },
            metadata,
            async () => snapshot,
          );
          expect(inspected.diagnostics).toEqual([]);
          expect(inspected.computedStyles?.layout).toMatchObject(actualPaint);
        }
        // The legacy inset stroke must not move the nested component's local origin.
        expect(bounds.frame).toMatchObject({ x: 60, y: 50 });
        expect(bounds.stack).toMatchObject({ x: 70, y: 70 });
        const samples = [
          {
            name: "gradient-left",
            id: "frame",
            x: 20,
            y: 170,
            expected: [240, 32, 47],
          },
          {
            name: "gradient-center-overlay-alpha",
            id: "frame",
            x: 150,
            y: 170,
            expected: [143, 32, 144],
          },
          {
            name: "gradient-right",
            id: "frame",
            x: 280,
            y: 170,
            expected: [46, 32, 240],
          },
          {
            name: "legacy-stroke",
            id: "frame",
            x: 2,
            y: 170,
            expected: [18, 52, 86],
          },
          {
            name: "inner-shadow",
            id: "frame",
            x: 150,
            y: 189,
            expected: [71, 16, 72],
          },
          {
            name: "outer-shadow",
            id: "frame",
            x: 150,
            y: 204,
            expected: [127, 127, 127],
          },
          {
            name: "beyond-shadow",
            id: "frame",
            x: 150,
            y: 220,
            expected: [255, 255, 255],
          },
          {
            name: "radial-off-center",
            id: "radial",
            x: 30,
            y: 90,
            expected: [250, 250, 250],
          },
          {
            name: "radial-horizontal-radius",
            id: "radial",
            x: 60,
            y: 90,
            expected: [125, 125, 125],
          },
          {
            name: "radial-vertical-radius",
            id: "radial",
            x: 30,
            y: 105,
            expected: [123, 123, 123],
          },
          {
            name: "radial-edge",
            id: "radial",
            x: 95,
            y: 90,
            expected: [0, 0, 0],
          },
          {
            name: "red-alpha-over-blue",
            id: "alpha",
            x: 40,
            y: 40,
            expected: [128, 0, 127],
          },
          {
            name: "reversed-order",
            id: "reversed",
            x: 40,
            y: 40,
            expected: [0, 0, 255],
          },
          {
            name: "multiply",
            id: "multiply",
            x: 40,
            y: 40,
            expected: [128, 64, 0],
          },
          {
            name: "rounded-center",
            id: "rounded",
            x: 40,
            y: 40,
            expected: [0, 255, 0],
          },
          {
            name: "rounded-corner",
            id: "rounded",
            x: 1,
            y: 1,
            expected: [255, 255, 255],
          },
          {
            name: "child-inside-clip",
            id: "rounded",
            x: 65,
            y: 65,
            expected: [255, 0, 0],
          },
          {
            name: "child-rounded-clip",
            id: "rounded",
            x: 78,
            y: 78,
            expected: [255, 255, 255],
          },
          {
            name: "child-outside-clip",
            id: "rounded",
            x: 85,
            y: 65,
            expected: [255, 255, 255],
          },
        ];
        const points = samples.map((sample) => ({
          x: bounds[sample.id].x + sample.x,
          y: bounds[sample.id].y + sample.y,
        }));
        // Decode both actual PNGs in Chromium, without a second image library or a
        // CSS/compiler-derived oracle. Expected RGB values above follow sRGB alpha
        // compositing, linear/radial interpolation and multiply independently.
        const captures = [
          snapshot.data,
          (
            await page.screenshot({ type: "png", animations: "disabled" })
          ).toString("base64"),
        ];
        const pixels = await page.evaluate(
          async ({ captures, points }) => {
            return Promise.all(
              captures.map(async (data) => {
                const image = new Image();
                image.src = `data:image/png;base64,${data}`;
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext("2d")!;
                context.drawImage(image, 0, 0);
                return {
                  width: canvas.width,
                  height: canvas.height,
                  samples: points.map((point) =>
                    Array.from(
                      context.getImageData(point.x, point.y, 1, 1).data,
                    ),
                  ),
                };
              }),
            );
          },
          { captures, points },
        );
        for (const [captureIndex, capture] of pixels.entries()) {
          expect([capture.width, capture.height]).toEqual([390, 600]);
          for (const [index, sample] of samples.entries()) {
            const actual = capture.samples[index];
            expect(actual[3], `${captureIndex}: ${sample.name} alpha`).toBe(
              255,
            );
            for (let channel = 0; channel < 3; channel++) {
              expect(
                Math.abs(actual[channel] - sample.expected[channel]),
                `${captureIndex}: ${sample.name} RGB ${channel}: ${actual}`,
              ).toBeLessThanOrEqual(2);
              expect(
                Math.abs(
                  actual[channel] -
                    pixels[1 - captureIndex].samples[index][channel],
                ),
                `${sample.name} preview/export parity`,
              ).toBeLessThanOrEqual(2);
            }
          }
        }
        await page.route("https://example.test/**", (route) => route.abort());
        for (const backgroundImage of [
          'url("https://example.test/private.png?token=synthetic-paint-secret")',
          'image-set("https://example.test/private.png?token=synthetic-paint-secret" 1x)',
        ]) {
          const actual = await page
            .locator('[data-node-id="frame"]')
            .evaluate((node, value) => {
              (node as HTMLElement).style.backgroundImage = value;
              return getComputedStyle(node).backgroundImage;
            }, backgroundImage);
          // A rejected CSS declaration would otherwise make this test vacuous.
          expect(actual).toContain("synthetic-paint-secret");
          const inspected = (await page.evaluate(
            computedStylesExpression,
          )) as RenderComputedStyles[];
          expect(
            inspected.find((node) => node.id === "frame")?.layout[
              "background-image"
            ],
          ).toBe("[resource URL omitted]");
          expect(JSON.stringify(inspected)).not.toContain("example.test");
          expect(JSON.stringify(inspected)).not.toContain(
            "synthetic-paint-secret",
          );
        }
      }
      expect(JSON.stringify(project)).toBe(sourceBefore);
    } finally {
      await browser.close();
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
