import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { build } from "esbuild";
import type { Project } from "../core/project";
import { createStudioServer } from "./server";
import { writeFontAsset, inspectFont } from "./font-assets";
import { projectFontSource } from "../studio/projectFonts";
import { requestedFontFace, readProjectAsset } from "./project-assets";
import { createDesktopHandler } from "../../desktop/protocol";
import type { ProjectFont } from "../core/fonts";
const font: ProjectFont = {
  id: "fixture",
  name: "Fixture",
  assetHash: "a".repeat(64),
  format: "ttf",
  family: "Studio Fixture Mono",
  weight: 400,
  style: "normal",
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
it("bounds and validates requested font identity without deriving a path from query data", () => {
  const source = projectFontSource(font),
    name = `${font.assetHash}.${font.format}`,
    search = new URL(source, "http://localhost").search;
  expect(requestedFontFace(name, search)).toMatchObject({
    assetHash: font.assetHash,
    format: "ttf",
    family: font.family,
    weight: 400,
    style: "normal",
  });
  expect(requestedFontFace(name, "")).toBeUndefined();
  expect(requestedFontFace("a".repeat(64) + ".png", "?v=1")).toBeUndefined();
  for (const value of [
    "?face=null",
    "?face=%5B%5D",
    search + "&face=x",
    search + "&path=outside",
    "?face=" + "a".repeat(5000),
    "?face=" +
      encodeURIComponent(
        JSON.stringify(["b".repeat(64), "ttf", font.family, 400, "normal"]),
      ),
    "?face=" +
      encodeURIComponent(
        JSON.stringify([
          font.assetHash,
          "ttf",
          font.family,
          { toString: null },
          "normal",
        ]),
      ),
  ])
    expect(() => requestedFontFace(name, value)).toThrow("INVALID_FONT_FACE");
});
it("desktop asset proxy preserves bounded identity query while paths remain allowlisted", async () => {
  let actual = "";
  const handle = createDesktopHandler(
    "/unused",
    () => ({ url: "http://127.0.0.1:5190", token: "agent", uiToken: "ui" }),
    async (url) => {
      actual = String(url);
      return new Response("font", { headers: { "Content-Type": "font/ttf" } });
    },
  );
  const source = projectFontSource(font),
    response = await handle(new Request("studio://preview" + source));
  expect(response.status).toBe(200);
  expect(actual).toBe("http://127.0.0.1:5190/api" + source);
});
it("allows an authentic proposed face not registered in the canonical project", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-font-new-face-"));
  roots.push(root);
  const bytes = await readFile(
    new URL("../../tests/fixtures/fonts/studio-fixture.otf", import.meta.url),
  );
  const saved = await writeFontAsset(root, {
    data: bytes.toString("base64"),
    name: "New face",
  });
  const face = {
      ...font,
      id: "new-face",
      assetHash: saved.assetHash,
      format: saved.format,
      family: saved.family,
      weight: saved.weight,
      style: saved.style,
    },
    name = saved.path.slice(7);
  const requested = requestedFontFace(
    name,
    new URL(projectFontSource(face), "http://localhost").search,
  );
  expect(
    (await readProjectAsset(root, name, [], requested)).equals(bytes),
  ).toBe(true);
});
it("rejects mismatched proposed metadata before apply and prevents poisoned font cache after apply", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-font-query-"));
  roots.push(root);
  const bytes = await readFile(
    new URL("../../tests/fixtures/fonts/studio-fixture.ttf", import.meta.url),
  );
  const actual = await inspectFont(bytes),
    valid = {
      ...font,
      ...actual,
      assetHash: createHash("sha256").update(bytes).digest("hex"),
    };
  let owner: Awaited<ReturnType<typeof createStudioServer>> | undefined;
  let hits = 0;
  const proxy = createServer((req, res) => {
    void (async () => {
      if (req.url?.startsWith("/assets/")) {
        hits++;
        const reply = await fetch(owner!.url + "/api" + req.url, {
          headers: { Authorization: `Bearer ${owner!.token}` },
        });
        res.writeHead(reply.status, {
          "Content-Type": reply.headers.get("Content-Type")!,
          "Cache-Control": reply.headers.get("Cache-Control")!,
        });
        res.end(Buffer.from(await reply.arrayBuffer()));
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end("<html><body>Isolated font proposal</body></html>");
    })().catch((e) => {
      res.statusCode = 500;
      res.end(e.message);
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw Error("NO_PORT");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    owner = await createStudioServer({
      root,
      port: 0,
      allowedOrigins: [origin],
      initialProject: {
        schemaVersion: 2,
        projectId: "font-review",
        name: "Font review",
        revision: 0,
        pages: [
          {
            screenId: "home",
            name: "Home",
            viewport: { width: 390 },
            nodes: [],
          },
        ],
        library: { id: "builtin", version: "1" },
        theme: "light",
        tokens: {},
        fonts: [valid],
      },
    });
    await writeFontAsset(root, {
      data: bytes.toString("base64"),
      name: "Fixture",
    });
    const validSource = projectFontSource(valid);
    const unauthorized = await fetch(owner.url + "/api" + validSource);
    expect(unauthorized.status).toBe(401);
    const forged = await fetch(
      owner.url +
        "/api/assets/" +
        valid.assetHash +
        ".ttf?face=%5B%22..%2Foutside%22%5D",
      { headers: { Authorization: `Bearer ${owner.token}` } },
    );
    expect(forged.status).toBe(400);
    expect(await forged.json()).toEqual({ error: "INVALID_FONT_FACE" });
    const page = await browser.newPage();
    await page.goto(origin);
    const runtime = await build({
      entryPoints: ["src/studio/projectFonts.ts"],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "StudioFontRuntime",
      platform: "browser",
    });
    await page.addScriptTag({ content: runtime.outputFiles[0].text });
    const snapshot = await fetch(owner.url + "/api/project", {
      headers: { Authorization: `Bearer ${owner.token}` },
    })
      .then((r) => r.json())
      .then((value) => JSON.stringify(value));
    const load = (font: ProjectFont, _label: string) =>
      page.evaluate(
        async ({ font, snapshot }) => {
          type Loader = ReturnType<
            typeof import("../studio/projectFonts").createProjectFontLoader
          >;
          const state = window as unknown as {
            reviewLoader?: Loader;
            StudioFontRuntime: {
              createProjectFontLoader: (doc: Document) => Loader;
            };
          };
          const loader = (state.reviewLoader ??=
            state.StudioFontRuntime.createProjectFontLoader(document));
          const result = await loader.load(
            { ...(JSON.parse(snapshot) as Project), fonts: [font] },
            [
              {
                id: "text",
                type: "SceneText",
                props: { text: "Пример Aa" },
                slots: {},
                scene: {
                  kind: "text",
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 40,
                  textStyle: { fontId: font.id },
                },
              },
            ],
          );
          return result.warnings.length ? result.warnings[0].code : "loaded";
        },
        { font, snapshot },
      );
    expect(await load(valid, "current400")).toBe("loaded");
    const proposed = { ...valid, weight: 700 };
    expect(await load(proposed, "proposed700")).toBe(
      "PROJECT_FONT_UNAVAILABLE",
    );
    expect(
      await load({ ...valid, family: "Fake family" }, "proposedFamily"),
    ).toBe("PROJECT_FONT_UNAVAILABLE");
    const current = await fetch(owner.url + "/api/project", {
      headers: { Authorization: `Bearer ${owner.token}` },
    }).then((r) => r.json());
    const applied = await fetch(owner.url + "/api/operations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        Origin: origin,
        "x-studio-ui-token": owner.uiToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: "font-query-apply",
        baseRevision: current.revision,
        operations: [
          { type: "updateProjectFont", fontId: valid.id, font: proposed },
        ],
      }),
    });
    expect(applied.status).toBe(200);
    expect(await load(proposed, "accepted700")).toBe(
      "PROJECT_FONT_UNAVAILABLE",
    );
    // A correcting proposal requests genuine 400 metadata even while canonical 700 is invalid.
    expect(await load(valid, "correctingProposal400")).toBe("loaded");
    const correctionPreview = await fetch(owner.url + "/api" + validSource, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(correctionPreview.status).toBe(200);
    expect(hits).toBeGreaterThanOrEqual(3);
    const query = projectFontSource(proposed).split("?")[1];
    const raw = await fetch(
      owner.url + "/api/assets/" + valid.assetHash + ".ttf?" + query,
      { headers: { Authorization: `Bearer ${owner.token}` } },
    );
    expect(raw.status).toBe(400);
    expect(await raw.json()).toEqual({ error: "FONT_METADATA_MISMATCH" });
  } finally {
    await browser.close();
    await owner?.close();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
}, 20000);
