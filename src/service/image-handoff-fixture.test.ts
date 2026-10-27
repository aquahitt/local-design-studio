import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  unlink,
} from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute, extname } from "node:path";
import { createRequire } from "node:module";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { chromium } from "@playwright/test";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { build as bundle } from "esbuild";
import { writeImageAsset, readImageAsset } from "./image-assets";
import { exportReactHandoff } from "./handoff";
import { renderSnapshot, type RenderResult } from "./render";
import { createStudioServer } from "./server";
import { libraryMetadata } from "../library/sdk";
import { builtinLibrary } from "../library/builtin";
import type { Project, ProjectNode } from "../core/project";
import type { ImageMapping } from "../core/paint";

const require = createRequire(import.meta.url);
it("portable image handoff and owner PNG share decoded pixels; corrupt/missing bytes reject render and inspect", async () => {
  const temp = await mkdtemp(join(tmpdir(), "studio-image-handoff-")),
    root = join(temp, "project"),
    clean = join(temp, "clean-export");
  await Promise.all([mkdir(root), mkdir(clean)]);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path fill="red" d="M0 0h100v100H0z"/><path fill="blue" d="M100 0h100v100H100z"/></svg>';
  const image = {
    path: "assets/" + createHash("sha256").update(svg).digest("hex") + ".svg",
  };
  const frame = (
    id: string,
    x: number,
    y: number,
    mapping: ImageMapping,
  ): ProjectNode => ({
    id,
    type: "SceneFrame",
    props: {},
    slots: {},
    scene: {
      kind: "frame",
      x,
      y,
      width: 120,
      height: 80,
      fills: [
        { id: "picture", kind: "image", asset: image.path, mapping },
        { id: "underlay", kind: "solid", color: { r: 0, g: 255, b: 0, a: 1 } },
      ],
    },
  });
  const cover = frame("cover", 0, 0, {
    mode: "cover",
    anchor: { x: 0.5, y: 0.5 },
  });
  cover.scene!.fills!.unshift({
    id: "overlay",
    kind: "solid",
    color: { r: 255, g: 255, b: 255, a: 0.25 },
  });
  Object.assign(cover.scene!, {
    radius: 12,
    stroke: "#123456",
    strokeWidth: 6,
  });
  const project: Project = {
    schemaVersion: 2,
    projectId: "image-portable-fixture",
    revision: 2,
    name: "Image fixture",
    tokens: {},
    theme: "light",
    library: { id: "builtin", version: "1" },
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 390, height: 600 },
        nodes: [
          cover,
          frame("contain", 140, 0, {
            mode: "contain",
            anchor: { x: 0.5, y: 0.5 },
          }),
          frame("crop", 0, 110, {
            mode: "crop",
            imageToFrame: [120, 0, 0, 80, 0, 0],
          }),
          frame("tile", 140, 110, {
            mode: "tile",
            imageToFrame: [40, 0, 0, 40, 0, 0],
          }),
        ],
      },
    ],
  };
  const original = JSON.stringify(project),
    metadata = [libraryMetadata(builtinLibrary)];
  let assetSettled = false;
  const readAsset = async (name: string) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const bytes = await readImageAsset(root, name);
    assetSettled = true;
    return bytes;
  };
  const owner = await createStudioServer({
    root,
    port: 0,
    initialProject: project,
    libraryMetadata: metadata,
    renderSnapshot: (snapshot, options) =>
      renderSnapshot(snapshot, options, { readAsset }),
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
  let server: ReturnType<typeof createServer> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    expect(
      (
        await writeImageAsset(root, {
          name: "Two colors",
          mediaType: "image/svg+xml",
          data: Buffer.from(svg).toString("base64"),
        })
      ).path,
    ).toBe(image.path);
    const rendered = await post("render", { pageId: "home", revision: 2 });
    expect(rendered.status).toBe(200);
    expect(assetSettled).toBe(true);
    const snapshot = (await rendered.json()) as RenderResult;
    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.bounds.find((bound) => bound.id === "cover")).toMatchObject(
      { x: 20, y: 20, width: 120, height: 80 },
    );
    const handoff = await exportReactHandoff(
      project,
      { pageId: "home", revision: 2 },
      metadata,
      readAsset,
    );
    expect(handoff.supported).toBe(true);
    const entries: Record<string, Uint8Array> = Object.fromEntries(
      Object.entries(handoff.files).map(([name, source]) => [
        name,
        strToU8(source),
      ]),
    );
    for (const row of handoff.assets)
      entries[row.path] = Buffer.from(row.data, "base64");
    for (const [name, bytes] of Object.entries(unzipSync(zipSync(entries)))) {
      if (name.startsWith("assets/"))
        await mkdir(join(clean, "assets"), { recursive: true });
      await writeFile(join(clean, name), bytes);
    }
    // An integrator supplies the registered runtime independently from the artifact.
    const provider = join(clean, "node_modules/@fixture/registered-library");
    await mkdir(provider, { recursive: true });
    await writeFile(
      join(provider, "package.json"),
      JSON.stringify({
        name: "@fixture/registered-library",
        type: "module",
        exports: "./index.js",
      }),
    );
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
      outfile: join(provider, "index.js"),
    });
    await mkdir(join(clean, "public/assets"), { recursive: true });
    for (const row of handoff.assets)
      await writeFile(
        join(clean, "public", row.path),
        Buffer.from(row.data, "base64"),
      );
    await writeFile(
      join(clean, "main.tsx"),
      'import {createRoot} from "react-dom/client";import {Screen} from "./Screen";import {library} from "@fixture/registered-library";import {waitForImageResources,getImageResourceStatus} from "./imageResources";(window as any).__imageHandoff={waitForImageResources,getImageResourceStatus};createRoot(document.getElementById("root")!).render(<Screen library={library}/>);',
    );
    await writeFile(
      join(clean, "index.html"),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
    );
    await build({
      root: clean,
      configFile: false,
      logLevel: "silent",
      plugins: [react()],
      resolve: {
        alias: [
          "react",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "react-dom",
          "react-dom/client",
        ].map((name) => ({
          find: new RegExp("^" + name.replaceAll("/", "\\/") + "$"),
          replacement: require.resolve(name),
        })),
      },
      build: { outDir: "dist", minify: true },
    });
    server = createServer((req, res) => {
      void (async () => {
        try {
          const path = new URL(req.url ?? "/", "http://localhost").pathname;
          const file = resolve(
              clean,
              "dist",
              path === "/" ? "index.html" : "." + path,
            ),
            rel = relative(join(clean, "dist"), file);
          if (rel.startsWith("..") || isAbsolute(rel))
            throw new Error("INVALID_PATH");
          res.setHeader(
            "Content-Type",
            (
              {
                ".html": "text/html",
                ".js": "text/javascript",
                ".css": "text/css",
                ".svg": "image/svg+xml",
                ".png": "image/png",
              } as Record<string, string>
            )[extname(file)] ?? "application/octet-stream",
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
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 390, height: 600 },
    });
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      { waitUntil: "networkidle" },
    );
    await expect
      .poll(() =>
        page
          .locator(".studio-handoff")
          .getAttribute("data-image-resource-status"),
      )
      .toBe("ready");
    const resourceStatus = await page.evaluate(async () =>
      (globalThis as any).__imageHandoff.waitForImageResources(),
    );
    expect(resourceStatus.warnings).toEqual([]);
    expect(resourceStatus.dimensions[image.path]).toEqual({
      width: 300,
      height: 150,
    });
    const samples = [
      { x: 30, y: 60, rgb: [255, 64, 64] },
      { x: 130, y: 60, rgb: [64, 64, 255] },
      { x: 23, y: 60, rgb: [18, 52, 86] },
      { x: 21, y: 21, rgb: [255, 255, 255] },
      { x: 220, y: 23, rgb: [0, 255, 0] },
      { x: 170, y: 60, rgb: [255, 0, 0] },
      { x: 30, y: 160, rgb: [255, 0, 0] },
      { x: 130, y: 160, rgb: [0, 0, 255] },
      { x: 170, y: 150, rgb: [255, 0, 0] },
      { x: 190, y: 150, rgb: [0, 0, 255] },
      { x: 210, y: 150, rgb: [255, 0, 0] },
    ];
    const captures = [
      snapshot.data,
      (await page.screenshot()).toString("base64"),
    ];
    const pixels = await page.evaluate(
      async ({ captures, samples }) =>
        Promise.all(
          captures.map(async (data) => {
            const image = new Image();
            image.src = "data:image/png;base64," + data;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            return samples.map(({ x, y }) =>
              Array.from(context.getImageData(x, y, 1, 1).data),
            );
          }),
        ),
      { captures, samples },
    );
    for (const capture of pixels)
      for (const [index, sample] of samples.entries()) {
        expect(capture[index][3]).toBe(255);
        for (let channel = 0; channel < 3; channel++)
          expect(
            Math.abs(capture[index][channel] - sample.rgb[channel]),
            JSON.stringify({
              index,
              actual: capture[index],
              expected: sample.rgb,
            }),
          ).toBeLessThanOrEqual(2);
      }
    expect(pixels[0]).toEqual(pixels[1]);
    await writeFile(join(root, image.path), svg.replace("red", "green"));
    const corrupt = await post("render", { pageId: "home", revision: 2 });
    expect(corrupt.status).toBe(400);
    const corruptError = await corrupt.json();
    expect(corruptError.error).toBe("IMAGE_RESOURCE_UNAVAILABLE");
    expect(corruptError.path).toBe(image.path);
    await unlink(join(root, image.path));
    const missing = await post("inspect", {
      pageId: "home",
      revision: 2,
      nodeId: "cover",
    });
    expect(missing.status).toBe(400);
    const missingError = await missing.json();
    expect(missingError.error).toBe("IMAGE_RESOURCE_UNAVAILABLE");
    expect(missingError.path).toBe(image.path);
    const overBudget = structuredClone(project);
    overBudget.pages[0].nodes = Array.from({ length: 1001 }, (_, index) => {
      const node = frame(`budget-${index}`, 0, 0, {
        mode: "cover",
        anchor: { x: 0.5, y: 0.5 },
      });
      const paint = node.scene!.fills![0];
      if (paint.kind === "image")
        paint.asset = `assets/${index.toString(16).padStart(64, "0")}.svg`;
      return node;
    });
    await expect(
      renderSnapshot(
        overBudget,
        { pageId: "home", revision: 2 },
        { readAsset },
      ),
    ).rejects.toMatchObject({ code: "IMAGE_RESOURCE_UNAVAILABLE" });
    expect(JSON.stringify(project)).toBe(original);
    expect(
      JSON.parse(await readFile(join(root, "project.json"), "utf8")),
    ).toEqual(project);
  } finally {
    await browser?.close();
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await owner.close();
    await rm(temp, { recursive: true, force: true });
  }
}, 90000);
