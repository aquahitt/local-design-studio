import { expect, it } from "vitest";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { projectFontFamily, type ProjectFont } from "../core/fonts";
it("loads real TTF/OTF/WOFF/WOFF2 locally under connect-src none and waits for delayed bytes", async () => {
  const bundle = await build({
    entryPoints: ["src/studio/projectFonts.ts"],
    bundle: true,
    format: "iife",
    globalName: "FontRuntime",
    write: false,
  });
  const fixtures = await Promise.all(
    (["ttf", "otf", "woff", "woff2"] as const).map(async (format) => {
      const bytes = await readFile(
        new URL(
          `../../tests/fixtures/fonts/studio-fixture.${format}`,
          import.meta.url,
        ),
      );
      const font: ProjectFont = {
        id: "font-" + format,
        name: "Fixture",
        family: "Fixture",
        assetHash: createHash("sha256").update(bytes).digest("hex"),
        format,
        weight: 400,
        style: "normal",
      };
      return { bytes, font, path: `/assets/${font.assetHash}.${format}` };
    }),
  );
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>((ok) => (release = ok)),
    request = new Promise<void>((ok) => (requested = ok));
  const server = createServer((req, res) => {
    void (async () => {
      const fixture = fixtures.find(
        (f) => f.path === new URL(req.url!, "http://localhost").pathname,
      );
      if (fixture) {
        if (fixture.font.format === "woff2") {
          requested();
          await gate;
        }
        res.setHeader("Content-Type", "font/" + fixture.font.format);
        res.end(fixture.bytes);
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'unsafe-inline'; font-src 'self'; connect-src 'none'; style-src 'unsafe-inline'",
      );
      res.end("<!doctype html><html><body></body></html>");
    })().catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    for (const fixture of fixtures) {
      const project = {
        schemaVersion: 2,
        projectId: fixture.font.format,
        name: "Test",
        revision: 1,
        library: { id: "builtin", version: "1" },
        theme: "light",
        tokens: {},
        fonts: [fixture.font],
        pages: [],
      };
      const nodes = [
        {
          id: "text",
          type: "Text",
          props: { text: "Привет World" },
          slots: {},
          scene: {
            kind: "text",
            x: 0,
            y: 0,
            width: 200,
            height: 40,
            textStyle: { fontId: fixture.font.id },
          },
        },
      ];
      await page.evaluate(
        ({ project, nodes }) => {
          const w = window as any;
          w.loader ??= w.FontRuntime.createProjectFontLoader(document);
          w.ready = false;
          w.loading = w.loader.load(project, nodes).then((result: any) => {
            w.result = result;
            w.ready = true;
          });
        },
        { project, nodes },
      );
      if (fixture.font.format === "woff2") {
        await request;
        expect(await page.evaluate(() => (window as any).ready)).toBe(false);
        release();
      }
      await page.evaluate(() => (window as any).loading);
      expect(
        await page.evaluate(() => (window as any).result.warnings),
      ).toEqual([]);
      const result = await page.evaluate((family) => {
        const font = [...document.fonts].find((f) => f.family === family)!;
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d")!;
        ctx.font = `400 20px ${family}`;
        return {
          status: font.status,
          narrow: ctx.measureText("iiii").width,
          wide: ctx.measureText("WWWW").width,
          cyrillic: ctx.measureText("ЖЖЖЖ").width,
        };
      }, projectFontFamily(fixture.font));
      expect(result.status).toBe("loaded");
      if (fixture.font.format !== "otf") {
        expect(result.narrow).toBeCloseTo(result.wide, 3);
        expect(result.cyrillic).toBeCloseTo(result.wide, 3);
      }
    }
  } finally {
    release();
    await browser.close();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
}, 20000);

it("revalidates changed face metadata instead of reusing cached immutable font bytes", async () => {
  const bundle = await build({
    entryPoints: ["src/studio/projectFonts.ts"],
    bundle: true,
    format: "iife",
    globalName: "FontRuntime",
    write: false,
  });
  const bytes = await readFile(
    new URL("../../tests/fixtures/fonts/studio-fixture.ttf", import.meta.url),
  );
  const font: ProjectFont = {
    id: "face",
    name: "Fixture",
    family: "Studio Fixture Mono",
    assetHash: createHash("sha256").update(bytes).digest("hex"),
    format: "ttf",
    weight: 400,
    style: "normal",
  };
  let valid = true,
    requests = 0;
  const server = createServer((req, res) => {
    if (new URL(req.url!, "http://localhost").pathname.startsWith("/assets/")) {
      requests++;
      if (!valid) {
        res.writeHead(400);
        res.end("FONT_METADATA_MISMATCH");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "font/ttf",
        "Cache-Control": "private, max-age=31536000, immutable",
      });
      res.end(bytes);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><body></body>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const load = (descriptor: ProjectFont) =>
      page.evaluate(async (font) => {
        const w = window as any;
        w.loader ??= w.FontRuntime.createProjectFontLoader(document);
        return w.loader.load(
          {
            projectId: "same-project",
            revision: 1,
            fonts: [font],
            designComponents: [],
            pages: [],
          },
          [
            {
              id: "text",
              type: "SceneText",
              props: { text: "Привет" },
              slots: {},
              scene: {
                kind: "text",
                x: 0,
                y: 0,
                width: 100,
                height: 50,
                textStyle: { fontId: font.id },
              },
            },
          ],
        );
      }, descriptor);
    expect((await load(font)).warnings).toEqual([]);
    expect(requests).toBe(1);
    valid = false;
    expect((await load({ ...font, weight: 700 })).warnings).toMatchObject([
      { code: "PROJECT_FONT_UNAVAILABLE", fontId: "face" },
    ]);
    expect(requests).toBe(2);
    valid = true;
    expect((await load(font)).warnings).toEqual([]);
    valid = false;
    expect(
      (await load({ ...font, family: "Changed declared family" })).warnings,
    ).toHaveLength(1);
  } finally {
    await browser.close();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
}, 20000);
