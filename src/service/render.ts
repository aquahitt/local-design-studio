import { isProjectAssetPath, projectAssetMediaType } from "./project-assets";
import {
  captureRectangle,
  resolveCaptureBounds,
  assertCaptureDiagnostics,
  translateCaptureExpression,
  settleCaptureExpression,
  withCaptureTimeout,
  assertImageResourcesReady,
  imageResourceWarningsExpression,
} from "./capture";
import { collectImagePaintReferences } from "../core/image-paint";
import {
  captureMeasurementExpression,
  type CaptureMeasurement,
} from "./capture-dom";
import {
  isolateCaptureExpression,
  type CaptureIsolationResult,
} from "./capture-isolation";
import { definitionNodes, resolveSceneNodes } from "../core/design-components";
import { previewResourceScope } from "../studio/previewResources";
import { computedStylesExpression } from "./computed-styles";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseProject,
  CoreError,
  type Project,
  type ProjectNode,
} from "../core/project";
import { parseViewport, type Viewport } from "../core/viewport";

export type CaptureBoundsMode = "layout" | "visual";
export type CaptureMode = "scene" | "isolated";

export interface RenderOptions {
  pageId: string;
  revision: number;
  nodeId?: string;
  viewport?: Viewport;
  theme?: string;
  boundsMode?: CaptureBoundsMode;
  captureMode?: CaptureMode;
}
export interface RenderBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RenderComputedStyles {
  id: string;
  layout: Record<string, string>;
  content: Record<string, string> | null;
}
export interface RenderResult {
  mimeType: "image/png";
  data: string;
  revision: number;
  pageId: string;
  nodeId?: string;
  viewport: Viewport & { height: number };
  theme: string;
  bounds: RenderBounds[];
  warnings: string[];
  text: string;
  computedStyles?: RenderComputedStyles[];
  boundsMode?: CaptureBoundsMode;
  captureMode?: CaptureMode;
  captureBounds?: { x: number; y: number; width: number; height: number };
  visualBounds?: RenderBounds[];
  visualBoundsStatus?: "conservative";
  visualBoundsPolicy?: string;
}
export interface RenderRuntime {
  sourceRoot?: string;
  externalRoot?: string;
  readAsset?: (name: string) => Promise<Uint8Array>;
}

/** Validate and clone first; a screenshot never reads a changing owner document. */
export function prepareRenderSnapshot(
  project: Project,
  options: RenderOptions,
) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) =>
        ![
          "pageId",
          "revision",
          "nodeId",
          "viewport",
          "theme",
          "boundsMode",
          "captureMode",
        ].includes(key),
    )
  )
    throw new CoreError("INVALID_RENDER_OPTIONS");
  if (
    (options.boundsMode !== undefined &&
      options.boundsMode !== "layout" &&
      options.boundsMode !== "visual") ||
    (options.captureMode !== undefined &&
      options.captureMode !== "scene" &&
      options.captureMode !== "isolated")
  )
    throw new CoreError("INVALID_RENDER_OPTIONS");
  const boundsMode = options.boundsMode ?? "layout";
  const captureMode = options.captureMode ?? "scene";
  const exposeCaptureMetadata =
    options.boundsMode !== undefined || options.captureMode !== undefined;
  if (
    !Number.isInteger(options.revision) ||
    options.revision !== project.revision
  )
    throw new CoreError("REVISION_CONFLICT");
  const snapshot = parseProject(project);
  const page = snapshot.pages.find((page) => page.screenId === options.pageId);
  if (!page) throw new CoreError("PAGE_NOT_FOUND");
  const viewport = parseViewport(options.viewport ?? page.viewport);
  const fullViewport = { ...viewport, height: viewport.height ?? 850 };
  const theme = options.theme ?? project.theme;
  if (typeof theme !== "string" || !theme || theme.length > 100)
    throw new CoreError("INVALID_THEME");
  const find = (nodes: ProjectNode[]): ProjectNode | undefined => {
    for (const node of nodes) {
      if (node.id === options.nodeId) return node;
      for (const children of Object.values(node.slots)) {
        const found = find(children);
        if (found) return found;
      }
    }
  };
  if (
    options.nodeId !== undefined &&
    (typeof options.nodeId !== "string" || !find(page.nodes))
  )
    throw new CoreError("NODE_NOT_FOUND");
  if (captureMode === "isolated" && options.nodeId === undefined)
    throw new CoreError("INVALID_RENDER_OPTIONS");
  return {
    project: snapshot,
    page,
    viewport: fullViewport,
    theme,
    nodeId: options.nodeId,
    boundsMode,
    captureMode,
    exposeCaptureMetadata,
  };
}

/** Development renderer. Desktop owners inject their Chromium capture callback instead. */
export async function renderSnapshot(
  project: Project,
  options: RenderOptions,
  runtime: RenderRuntime = {},
): Promise<RenderResult> {
  const input = prepareRenderSnapshot(project, options);
  let vite: typeof import("vite"),
    react: typeof import("@vitejs/plugin-react"),
    tailwind: typeof import("@tailwindcss/vite"),
    playwright: typeof import("@playwright/test");
  try {
    [vite, react, tailwind, playwright] = await Promise.all([
      import("vite"),
      import("@vitejs/plugin-react"),
      import("@tailwindcss/vite"),
      import("@playwright/test"),
    ]);
  } catch {
    throw new CoreError("RENDER_UNAVAILABLE");
  }
  const sourceRoot = resolve(
    runtime.sourceRoot ?? fileURLToPath(new URL("../../", import.meta.url)),
  );
  const { studioLibraryPlugin, getConfiguredLibraryMetadata } =
    await import("../../scripts/library/plugin");
  const config = { externalRoot: runtime.externalRoot };
  const library = getConfiguredLibraryMetadata(config).find(
    (library) =>
      library.id === input.project.library.id &&
      library.version === input.project.library.version,
  );
  if (!library) throw new CoreError("LIBRARY_UNAVAILABLE");
  if (!library.themes.some((theme) => theme.id === input.theme))
    throw new CoreError("INVALID_THEME");
  // Windows TEMP can contain an 8.3 alias (RUNNER~1). Vite/Rolldown resolve
  // entries to long paths; root and input must use the same canonical spelling.
  const temporary = await realpath(
    await mkdtemp(join(tmpdir(), "studio-render-")),
  );
  let browser: import("@playwright/test").Browser | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const entry = join(temporary, "index.html"),
      output = join(temporary, "output");
    await writeFile(
      entry,
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${join(sourceRoot, "src/service/render-entry.tsx")}"></script></body></html>`,
    );
    await vite.build({
      root: temporary,
      configFile: false,
      logLevel: "silent",
      define: { __STUDIO_DESKTOP__: "false", __STUDIO_DEMO__: "false" },
      plugins: [
        studioLibraryPlugin(config, sourceRoot),
        tailwind.default(),
        react.default(),
      ],
      build: {
        outDir: output,
        emptyOutDir: true,
        rollupOptions: { input: entry },
      },
    });
    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };
    server = createServer((req, res) => {
      void (async () => {
        try {
          if (req.method !== "GET") {
            res.writeHead(405);
            res.end();
            return;
          }
          const path = decodeURIComponent(
            new URL(req.url ?? "/", "http://127.0.0.1").pathname,
          );
          let bytes: Uint8Array, type: string;
          if (isProjectAssetPath(path)) {
            if (!runtime.readAsset) throw new Error("ASSET_UNAVAILABLE");
            bytes = await runtime.readAsset(path.slice(8));
            type = projectAssetMediaType(path.slice(8))!;
          } else {
            const file = resolve(
                output,
                path === "/" ? "index.html" : "." + path,
              ),
              rel = relative(output, file);
            if (
              rel.startsWith("..") ||
              isAbsolute(rel) ||
              path.includes("\\") ||
              path.includes("\0")
            )
              throw new Error("INVALID_PATH");
            bytes = await readFile(file);
            type = mime[extname(file)] ?? "application/octet-stream";
          }
          res.writeHead(200, {
            "Content-Type": type,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy":
              "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'",
          });
          res.end(bytes);
        } catch {
          res.writeHead(404);
          res.end();
        }
      })();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number },
      origin = `http://127.0.0.1:${address.port}`;
    try {
      browser = await playwright.chromium.launch({ headless: true });
    } catch {
      throw new CoreError("RENDER_BROWSER_UNAVAILABLE");
    }
    const page = await browser.newPage({
      viewport: { width: input.viewport.width, height: input.viewport.height },
      deviceScaleFactor: 1,
    });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const warnings: string[] = [];
    page.on("pageerror", (error) => warnings.push(error.message));
    page.on("requestfailed", (request) => {
      if (warnings.length < 100)
        warnings.push(
          "RESOURCE_UNAVAILABLE:" +
            new URL(request.url()).pathname.slice(0, 512),
        );
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && warnings.length < 100)
        warnings.push(
          "RESOURCE_UNAVAILABLE:" +
            new URL(response.url()).pathname.slice(0, 512),
        );
    });
    await page.goto(origin, { waitUntil: "networkidle", timeout: 15000 });
    await page.evaluate(
      (serialized) =>
        window.postMessage(JSON.parse(serialized), location.origin),
      JSON.stringify({
        type: "studio-preview-render",
        project: input.project,
        library: input.project.library,
        theme: input.theme,
        nodes: input.page.nodes,
        ...(input.captureMode === "isolated"
          ? { resourceNodeId: input.nodeId }
          : {}),
      }),
    );
    await page.waitForFunction(
      (revision) =>
        document.documentElement.dataset.studioPreviewRevision ===
        String(revision),
      input.project.revision,
      { timeout: 15000 },
    );
    const resolvedNodes = resolveSceneNodes(input.project, input.page.nodes);
    const canonicalNodes = definitionNodes(resolvedNodes);
    const resourceNodes = previewResourceScope(
      input.project,
      input.page.nodes,
      input.captureMode === "isolated" ? input.nodeId : undefined,
    ).imageNodes;
    assertImageResourcesReady(
      await withCaptureTimeout(page.evaluate(imageResourceWarningsExpression)),
      collectImagePaintReferences(resourceNodes, "rendered").map(
        (ref) => ref.asset,
      ),
    );
    await withCaptureTimeout(page.evaluate(settleCaptureExpression));
    const bounds = await page.locator("[data-node-id]").evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return {
          id: node.getAttribute("data-node-id")!,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        };
      }),
    );
    const computedStyles = (await page.evaluate(
      computedStylesExpression,
    )) as RenderComputedStyles[];
    const text = (await page.locator("body").innerText()).slice(0, 10000);
    warnings.push(...(await page.locator(".render-error").allTextContents()));
    warnings.push(
      ...(await page.evaluate(() => {
        const fontWarnings = JSON.parse(
          document.documentElement.dataset.studioPreviewFontWarnings ?? "[]",
        ) as { code: string; fontId: string }[];
        return fontWarnings.map(
          (warning) => `${warning.code}:${warning.fontId}`,
        );
      })),
    );
    if (input.captureMode === "isolated") {
      const isolation = await withCaptureTimeout(
        page.evaluate<CaptureIsolationResult>(
          isolateCaptureExpression({
            nodeId: input.nodeId!,
            nodeIds: [...canonicalNodes.keys()],
          }),
        ),
      );
      assertCaptureDiagnostics(isolation.diagnostics);
    }
    const measurement = input.exposeCaptureMetadata
      ? await withCaptureTimeout(
          page.evaluate<CaptureMeasurement>(
            captureMeasurementExpression({
              nodeId: input.nodeId,
              nodeIds: [...canonicalNodes.keys()],
              visual: input.boundsMode === "visual",
            }),
          ),
        )
      : undefined;
    if (measurement) assertCaptureDiagnostics(measurement.diagnostics);
    const layoutBound = input.nodeId
      ? bounds.find((bound) => bound.id === input.nodeId)
      : { x: 0, y: 0, ...input.viewport };
    if (!layoutBound) throw new CoreError("NODE_NOT_VISIBLE");
    const captureBounds = resolveCaptureBounds(
      layoutBound,
      input.nodeId
        ? measurement?.visualBounds.find((bound) => bound.id === input.nodeId)
        : layoutBound,
      input.boundsMode,
    );
    let bytes: Buffer;
    if (input.nodeId) {
      const index = bounds.findIndex((bound) => bound.id === input.nodeId);
      if (index < 0 || bounds[index].width <= 0 || bounds[index].height <= 0)
        throw new CoreError("NODE_NOT_VISIBLE");
      const clip = captureRectangle(captureBounds);
      await withCaptureTimeout(
        page.evaluate(translateCaptureExpression(captureBounds)),
      );
      const session = await page.context().newCDPSession(page);
      try {
        if (input.captureMode === "isolated")
          await session.send("Emulation.setDefaultBackgroundColorOverride", {
            color: { r: 0, g: 0, b: 0, a: 0 },
          });
        const capture = await withCaptureTimeout(
          session.send("Page.captureScreenshot", {
            format: "png",
            clip,
            captureBeyondViewport: true,
            fromSurface: true,
          }),
        );
        bytes = Buffer.from(capture.data, "base64");
      } finally {
        await session.detach();
      }
    } else {
      captureRectangle({ x: 0, y: 0, ...input.viewport });
      bytes = await page.screenshot({
        type: "png",
        animations: "disabled",
        timeout: 15000,
      });
    }
    return {
      mimeType: "image/png",
      data: bytes.toString("base64"),
      revision: input.project.revision,
      pageId: input.page.screenId,
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      viewport: input.viewport,
      theme: input.theme,
      bounds,
      computedStyles,
      ...(input.exposeCaptureMetadata
        ? {
            boundsMode: input.boundsMode,
            captureMode: input.captureMode,
            captureBounds,
            visualBounds: measurement?.visualBounds ?? [],
            visualBoundsStatus: "conservative" as const,
            visualBoundsPolicy: measurement!.policy,
          }
        : {}),
      warnings,
      text,
    };
  } finally {
    await browser?.close();
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
}
