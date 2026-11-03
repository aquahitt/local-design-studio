import { expect, test, type Page } from "@playwright/test";

async function mount(page: Page, nodes: unknown[]) {
  await page.evaluate(async (nodes) => {
    const url = "/tests/fixtures/image-paint-runtime.tsx";
    await (await import(url)).mount(nodes);
  }, nodes);
}
async function pixels(page: Page, points: number[][]) {
  const png = await page.screenshot();
  return page.evaluate(
    async ({ data, points }) => {
      const image = await createImageBitmap(
        await (await fetch("data:image/png;base64," + data)).blob(),
      );
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      image.close();
      return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    },
    { data: png.toString("base64"), points },
  );
}
const solid = (
  id: string,
  color: { r: number; g: number; b: number; a: number },
  width: number,
  alignment: string,
) => ({ id, kind: "solid", color, width, alignment });
const red = { r: 255, g: 0, b: 0, a: 1 },
  green = { r: 0, g: 255, b: 0, a: 1 };
const child = {
  id: "child",
  type: "SceneFrame",
  props: {},
  slots: {},
  scene: {
    kind: "frame",
    x: 95,
    y: 20,
    width: 30,
    height: 30,
    fill: "#0000ff",
  },
};
const frame = {
  id: "frame",
  type: "SceneFrame",
  props: {},
  slots: { content: [child] },
  scene: {
    kind: "frame",
    x: 80,
    y: 80,
    width: 100,
    height: 80,
    fill: "#ffffff",
    radius: 8,
    clip: true,
    strokes: [
      solid("outer", red, 10, "outside"),
      solid("inner", green, 6, "inside"),
    ],
  },
};

test("outside strokes survive own child clipping while ancestor clipping and local origin stay intact", async ({
  page,
}) => {
  await page.goto("/preview");
  await mount(page, [frame]);
  const box = await page.locator('[data-node-id="frame"]').boundingBox();
  expect(box).toMatchObject({ x: 80, y: 80, width: 100, height: 80 });
  await expect(page.locator("[data-node-id]")).toHaveCount(2);
  expect(
    await pixels(page, [
      [75, 115],
      [82, 115],
      [120, 120],
      [177, 115],
      [185, 115],
      [195, 115],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [255, 255, 255, 255],
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [255, 255, 255, 255],
  ]);
  const parent = {
    id: "parent",
    type: "SceneFrame",
    props: {},
    slots: { content: [{ ...frame, scene: { ...frame.scene, x: 5, y: 5 } }] },
    scene: { kind: "frame", x: 80, y: 80, width: 100, height: 80, clip: true },
  };
  await mount(page, [parent]);
  expect(
    await pixels(page, [
      [77, 120],
      [82, 120],
      [187, 120],
    ]),
  ).toEqual([
    [255, 255, 255, 255],
    [255, 0, 0, 255],
    [255, 255, 255, 255],
  ]);
});

test("image stroke and fill with equal paint IDs keep separate UV resources and ready pixels", async ({
  page,
}) => {
  const fill = `assets/${"a".repeat(64)}.svg`,
    stroke = `assets/${"b".repeat(64)}.svg`;
  const source = (a: string, b: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><path fill="${a}" d="M0 0h120v120H0z"/><path fill="${b}" d="M120 0h120v120H120z"/></svg>`;
  await page.route(`**/${fill}`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: source("red", "blue"),
    }),
  );
  await page.route(`**/${stroke}`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: source("lime", "yellow"),
    }),
  );
  await page.goto("/preview");
  const paint = {
    id: "same",
    kind: "image",
    mapping: { mode: "cover", anchor: { x: 0.5, y: 0.5 } },
  };
  await mount(page, [
    {
      ...frame,
      slots: {},
      scene: {
        ...frame.scene,
        radius: 0,
        fills: [{ ...paint, asset: fill }],
        strokes: [{ ...paint, asset: stroke, width: 10, alignment: "outside" }],
      },
    },
  ]);
  expect(
    await pixels(page, [
      [71, 71],
      [75, 115],
      [100, 115],
      [160, 115],
      [185, 115],
      [120, 65],
    ]),
  ).toEqual([
    [0, 255, 0, 255],
    [0, 255, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255],
    [255, 255, 255, 255],
  ]);
  await expect(page.locator("[data-node-id]")).toHaveCount(1);
});

test("zero-width and zero-opacity image strokes do not request unavailable bytes", async ({
  page,
}) => {
  const asset = `assets/${"c".repeat(64)}.png`;
  let requested = 0;
  await page.route(`**/${asset}`, (route) => {
    requested++;
    return route.fulfill({ status: 404, body: "missing" });
  });
  await page.goto("/preview");
  const base = {
    id: "missing",
    kind: "image",
    asset,
    mapping: { mode: "cover", anchor: { x: 0.5, y: 0.5 } },
    width: 10,
    alignment: "outside",
  };
  for (const invisible of [{ width: 0 }, { opacity: 0 }])
    await mount(page, [
      {
        ...frame,
        slots: {},
        scene: { ...frame.scene, strokes: [{ ...base, ...invisible }] },
      },
    ]);
  expect(requested).toBe(0);
});

test("stroke inspector converts legacy explicitly, preserves one draft, Undo and conflicted raw width", async ({
  page,
}) => {
  test.setTimeout(45000);
  const { randomUUID } = await import("node:crypto");
  const { selectStudioOption } = await import("./select-helpers");
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const session = await page.request.get("/api/session").then((r) => r.json());
  const headers = {
    Authorization: `Bearer ${session.token}`,
    "x-studio-ui-token": session.uiToken,
    "Content-Type": "application/json",
    Origin: origin,
  };
  const api = async (path: string, body?: unknown) => {
    const r = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      signal: AbortSignal.timeout(5000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };
  const read = () => api("/api/project");
  const batch = async (operations: unknown[]) =>
    api("/api/operations", {
      requestId: randomUUID(),
      baseRevision: (await read()).revision,
      operations,
    });
  const id = "strokes-" + randomUUID(),
    nodeId = id + "-frame";
  const initial = await batch([
    {
      type: "addPage",
      page: {
        screenId: id,
        name: id,
        viewport: { width: 500, height: 400 },
        nodes: [
          {
            id: nodeId,
            type: "SceneFrame",
            props: {},
            slots: {},
            scene: {
              kind: "frame",
              x: 40,
              y: 40,
              width: 180,
              height: 140,
              fill: "#ffffff",
              stroke: "#ff0000",
              strokeWidth: 4,
            },
          },
        ],
      },
    },
  ]);
  const open = async () => {
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await selectStudioOption(page, "Экран", id);
    await page
      .getByRole("button", { name: "Выделить " + nodeId, exact: true })
      .click();
  };
  const node = async () => {
    const p = await read();
    return {
      revision: p.revision,
      node: p.pages.find((p: any) => p.screenId === id).nodes[0],
    };
  };
  let primaryError: unknown;
  try {
    await expect(page.getByTestId("save-status")).toContainText(
      "ревизия " + initial.revision,
    );
    await open();
    const inspector = page.locator(".layout-inspector");
    const convert = inspector.getByRole("button", {
      name: "Преобразовать прежнюю обводку",
      exact: true,
    });
    await expect(convert).toBeVisible();
    await convert.click();
    await expect(
      inspector.getByLabel("Цвет обводки 1", { exact: true }),
    ).toHaveValue("#ff0000");
    await inspector.getByLabel("Ширина обводки 1", { exact: true }).fill("12");
    await selectStudioOption(page, "Выравнивание обводки 1", "Снаружи");
    await inspector
      .getByRole("button", { name: "Добавить обводку", exact: true })
      .click();
    await inspector
      .getByLabel("Цвет обводки 1", { exact: true })
      .fill("#00ff00");
    await inspector.getByLabel("Ширина обводки 1", { exact: true }).fill("7");
    await selectStudioOption(page, "Выравнивание обводки 1", "По центру");
    expect((await node()).revision).toBe(initial.revision);
    await inspector
      .getByRole("button", { name: "Применить слой", exact: true })
      .click();
    await expect
      .poll(async () => (await node()).revision)
      .toBe(initial.revision + 1);
    const saved = await node();
    expect(saved.node.scene.strokes).toMatchObject([
      { kind: "solid", width: 7, alignment: "center", color: { g: 255 } },
      { kind: "solid", width: 12, alignment: "outside", color: { r: 255 } },
    ]);
    await page.reload();
    await open();
    await expect(
      inspector.getByLabel("Ширина обводки 1", { exact: true }),
    ).toHaveValue("7");
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await expect
      .poll(async () => (await node()).revision)
      .toBe(initial.revision + 2);
    expect((await node()).node.scene).not.toHaveProperty("strokes");
    await convert.click();
    const width = inspector.getByLabel("Ширина обводки 1", { exact: true });
    await width.fill("-");
    await expect(
      inspector.getByRole("button", { name: "Применить слой", exact: true }),
    ).toBeDisabled();
    const external = await batch([
      { type: "setNodeMetadata", nodeId, name: "External" },
    ]);
    await expect(inspector.getByRole("status")).toContainText(
      "Документ изменился. Ввод сохранён.",
    );
    await expect(width).toHaveValue("-");
    await inspector
      .getByRole("button", { name: "Сбросить слой", exact: true })
      .click();
    await expect(convert).toBeVisible();
    await convert.click();
    await expect(width).toHaveValue("4");
    expect((await node()).revision).toBe(external.revision);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      if (!page.isClosed()) await page.keyboard.press("Escape");
      await batch([{ type: "removePage", pageId: id }]);
    } catch (error) {
      if (!primaryError) throw error;
      await test.info().attach("cleanup-error", {
        body: String(error),
        contentType: "text/plain",
      });
    }
  }
});

test("minified standalone React handoff preserves stroke pixels and its independent child clip", async ({
  page,
}) => {
  const { build } = await import("esbuild");
  const { createReactHandoff } = await import("../src/core/handoff");
  const { libraryMetadata } = await import("../src/library/sdk");
  const { builtinLibrary } = await import("../src/library/builtin");
  const { parseProject } = await import("../src/core/project");
  const asset = `assets/${"d".repeat(64)}.svg`;
  await page.route(`**/${asset}`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><path fill="lime" d="M0 0h60v60H0z"/><path fill="yellow" d="M60 0h60v60H60z"/></svg>',
    }),
  );
  const painted = {
    ...frame,
    scene: {
      ...frame.scene,
      strokes: [
        {
          id: "texture",
          kind: "image",
          asset,
          mapping: { mode: "cover", anchor: { x: 0.5, y: 0.5 } },
          width: 10,
          alignment: "outside",
        },
        solid("inside", red, 5, "inside"),
      ],
    },
  };
  await page.goto("/preview");
  await mount(page, [painted]);
  const coordinates = [
    [75, 115],
    [82, 115],
    [120, 120],
    [177, 115],
    [185, 115],
    [195, 115],
  ];
  const expected = await pixels(page, coordinates);
  const editorBox = (await page
    .locator('[data-node-id="frame"]')
    .boundingBox())!;
  const project = parseProject({
    schemaVersion: 2,
    projectId: "stroke-handoff",
    name: "Stroke handoff",
    revision: 0,
    library: { id: "builtin", version: "1" },
    theme: "light",
    tokens: {},
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 600, height: 500 },
        nodes: [painted],
      },
    ],
  });
  const handoff = createReactHandoff(project, { pageId: "home", revision: 0 }, [
    libraryMetadata(builtinLibrary),
  ]);
  expect(handoff.supported).toBe(true);
  expect(handoff.manifest.assets).toContain(asset);
  const bundle = await build({
    stdin: {
      contents:
        'import {createElement} from "react";import {createRoot} from "react-dom/client";import {Screen} from "./Screen";document.body.style.cssText="margin:0;background:white";const host=document.createElement("div");host.style.cssText="position:relative;width:600px;height:500px";document.body.append(host);createRoot(host).render(createElement(Screen,{library:{id:"builtin",version:"1",components:{}}}));',
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    minify: true,
    jsx: "automatic",
    plugins: [
      {
        name: "portable-stroke-export",
        setup(build) {
          build.onResolve(
            {
              filter:
                /^\.\/(Screen|Runtime|imageResources|maskResources|resources|styles|tokens|fonts)(\.(tsx?|css))?$/,
            },
            (args) => ({ path: args.path.slice(2), namespace: "portable" }),
          );
          build.onLoad({ filter: /.*/, namespace: "portable" }, (args) => {
            if (args.path.endsWith(".css"))
              return { contents: "", loader: "empty" };
            const name = args.path.includes(".")
              ? args.path
              : ["Screen", "Runtime"].includes(args.path)
                ? args.path + ".tsx"
                : args.path + ".ts";
            const contents = handoff.files[name];
            if (contents === undefined)
              throw new Error("Missing portable file " + name);
            return {
              contents,
              loader: name.endsWith(".tsx") ? "tsx" : "ts",
              resolveDir: process.cwd(),
            };
          });
        },
      },
    ],
  });
  await page.goto("/preview");
  await page.route("**/stroke-handoff-test.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.addStyleTag({
    content: ["styles.css", "tokens.css", "fonts.css"]
      .map((name) => handoff.files[name])
      .join("\n"),
  });
  await page.addScriptTag({
    url: new URL("/stroke-handoff-test.js", page.url()).href,
  });
  await expect(page.locator(".studio-handoff")).toHaveAttribute(
    "data-image-resource-status",
    "ready",
  );
  // The portable scaffold intentionally has body padding. Compare in the frame's
  // local coordinate system rather than changing the generated stylesheet.
  const exported = page.locator('[data-node-id="frame"]');
  const exportedBox = (await exported.boundingBox())!;
  expect(exportedBox.width).toBe(editorBox.width);
  expect(exportedBox.height).toBe(editorBox.height);
  await expect(exported).toHaveCSS("left", "80px");
  await expect(exported).toHaveCSS("top", "80px");
  expect(
    await pixels(
      page,
      coordinates.map(([x, y]) => [
        x + exportedBox.x - editorBox.x,
        y + exportedBox.y - editorBox.y,
      ]),
    ),
  ).toEqual(expected);
  await expect(page.locator("[data-node-id]")).toHaveCount(2);
});

for (const [name, paint, expected] of [
  ["solid alpha", { kind: "solid", color: green, opacity: 0.5 }, [0, 128, 127]],
  [
    "gradient alpha",
    {
      kind: "linear",
      angle: 90,
      opacity: 0.5,
      stops: [
        { offset: 0, color: { ...green, a: 0.5 } },
        { offset: 1, color: { ...green, a: 0.5 } },
      ],
    },
    [0, 64, 191],
  ],
  [
    "multiply",
    { kind: "solid", color: green, opacity: 0.5, blendMode: "multiply" },
    [0, 0, 127],
  ],
  [
    "image alpha",
    {
      kind: "image",
      asset: `assets/${"e".repeat(64)}.svg`,
      mapping: { mode: "cover", anchor: { x: 0.5, y: 0.5 } },
      opacity: 0.5,
    },
    [0, 128, 127],
  ],
] as const)
  test(`stroke ${name} composites once against the frame backdrop`, async ({
    page,
  }) => {
    await page.route(`**/assets/${"e".repeat(64)}.svg`, (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path fill="lime" d="M0 0h1v1H0z"/></svg>',
      }),
    );
    await page.goto("/preview");
    await mount(page, [
      {
        ...frame,
        slots: {},
        scene: {
          ...frame.scene,
          radius: 0,
          fill: "#0000ff",
          strokes: [{ id: "blend", width: 10, alignment: "inside", ...paint }],
        },
      },
    ]);
    const [actual] = await pixels(page, [[82, 115]]);
    // Source-over/multiply calculations rounded to 8-bit channels can differ by one unit.
    expected.forEach((channel, index) =>
      expect(Math.abs(actual[index] - channel)).toBeLessThanOrEqual(1),
    );
    expect(actual[3]).toBe(255);
  });

test("a stroke wider than half the frame paints the collapsed inner hole without changing bounds", async ({
  page,
}) => {
  await page.goto("/preview");
  await mount(page, [
    {
      ...frame,
      slots: {},
      scene: {
        ...frame.scene,
        radius: 12,
        strokes: [solid("wide", green, 60, "inside")],
      },
    },
  ]);
  expect(
    await pixels(page, [
      [90, 100],
      [120, 120],
      [170, 140],
      [75, 115],
    ]),
  ).toEqual([
    [0, 255, 0, 255],
    [0, 255, 0, 255],
    [0, 255, 0, 255],
    [255, 255, 255, 255],
  ]);
  expect(
    await page.locator('[data-node-id="frame"]').boundingBox(),
  ).toMatchObject({ x: 80, y: 80, width: 100, height: 80 });
});
