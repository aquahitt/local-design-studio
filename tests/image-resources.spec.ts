import { expect, test } from "@playwright/test";
const asset = `assets/${"a".repeat(64)}.svg`;
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><path fill="red" d="M0 0h120v120H0z"/><path fill="blue" d="M120 0h120v120H120z"/></svg>';

test("resource barrier waits for actual local SVG bytes and preserves intrinsic ratio without metadata", async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(`**/${asset}`, async (route) => {
    requested = true;
    await gate;
    await route.fulfill({ contentType: "image/svg+xml", body: source });
  });
  await page.goto("/");
  await page.evaluate(async (asset) => {
    const moduleURL = "/src/library/image-resource-runtime.ts";
    const { createImageResourceLoader } = await import(moduleURL);
    const loader = createImageResourceLoader(document);
    Object.assign(window, {
      imagePending: true,
      imageResult: null,
      imageLoader: loader,
    });
    void loader
      .load({ projectId: "image-test", revision: 1, assets: [asset] })
      .then((result: unknown) =>
        Object.assign(window, { imagePending: false, imageResult: result }),
      );
  }, asset);
  await expect.poll(() => requested).toBe(true);
  expect(await page.evaluate(() => (window as any).imagePending)).toBe(true);
  release();
  await expect
    .poll(() => page.evaluate(() => (window as any).imagePending))
    .toBe(false);
  const result = await page.evaluate(() => (window as any).imageResult);
  expect(result.warnings).toEqual([]);
  expect(result.dimensions[asset].width / result.dimensions[asset].height).toBe(
    2,
  );
});

test("decode failures and bounded timeouts never report successful dimensions", async ({
  page,
}) => {
  await page.route(`**/${asset}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: "invalid svg",
    }),
  );
  await page.goto("/");
  const result = await page.evaluate(async (asset) => {
    const moduleURL = "/src/library/image-resource-runtime.ts";
    const { createImageResourceLoader } = await import(moduleURL);
    const loader = createImageResourceLoader(document, { timeoutMs: 250 });
    const result = await loader.load({
      projectId: "image-test",
      revision: 1,
      assets: [asset],
    });
    loader.dispose();
    return result;
  }, asset);
  expect(result).toEqual({
    dimensions: {},
    warnings: [{ code: "PROJECT_IMAGE_UNAVAILABLE", asset }],
  });
});

async function sample(
  page: import("@playwright/test").Page,
  positions: [number, number][],
) {
  const screenshot = (await page.screenshot()).toString("base64");
  return page.evaluate(
    async ({ screenshot, positions }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${screenshot}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return positions.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    },
    { screenshot, positions },
  );
}

test("shared React paint adapter preserves SVG UV, image order, inset stroke and Resize versus Scale pixels", async ({
  page,
}) => {
  await page.route(`**/${asset}`, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: source }),
  );
  await page.goto("/preview");
  const frame = {
    id: "pixel-frame",
    type: "SceneFrame",
    props: {},
    slots: {},
    scene: {
      kind: "frame",
      x: 10,
      y: 10,
      width: 100,
      height: 80,
      stroke: "#00ff00",
      strokeWidth: 4,
      fills: [
        {
          id: "image",
          kind: "image",
          asset,
          mapping: { mode: "crop", imageToFrame: [100, 0, 0, 80, 0, 0] },
        },
      ],
    },
  };
  const mount = async (nodes: unknown[]) =>
    page.evaluate(async (nodes) => {
      const moduleURL = "/tests/fixtures/image-paint-runtime.tsx";
      const { mount } = await import(moduleURL);
      await mount(nodes);
    }, nodes);
  await mount([frame]);
  expect(
    await sample(page, [
      [12, 30],
      [30, 30],
      [90, 30],
    ]),
  ).toEqual([
    [0, 255, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  // Resize leaves image mapping in local pixels: source ends at x=110.
  await mount([{ ...frame, scene: { ...frame.scene, width: 150 } }]);
  expect(
    await sample(page, [
      [90, 30],
      [130, 30],
    ]),
  ).toEqual([
    [0, 0, 255, 255],
    [255, 255, 255, 255],
  ]);
  // Scale is the node wrapper, therefore the same mapped image covers twice the pixels.
  await mount([
    { ...frame, scene: { ...frame.scene, linearTransform: [2, 0, 0, 2] } },
  ]);
  expect(
    await sample(page, [
      [90, 30],
      [170, 30],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  const overlay = {
    id: "top",
    kind: "linear",
    angle: 0,
    stops: [
      { offset: 0, color: { r: 0, g: 255, b: 0, a: 1 } },
      { offset: 1, color: { r: 0, g: 255, b: 0, a: 1 } },
    ],
    opacity: 0.5,
  };
  await mount([
    {
      ...frame,
      scene: {
        ...frame.scene,
        fills: [
          overlay,
          ...frame.scene.fills,
          { ...overlay, id: "under", opacity: 1 },
        ],
      },
    },
  ]);
  const [mixed] = await sample(page, [[30, 30]]);
  expect(mixed[0]).toBeGreaterThanOrEqual(126);
  expect(mixed[0]).toBeLessThanOrEqual(128);
  expect(mixed[1]).toBeGreaterThanOrEqual(127);
  expect(mixed[1]).toBeLessThanOrEqual(129);
  expect(mixed[2]).toBe(0);
});

test("image mappings retain contain space, repeated tiles, reflection, radius and unclipped children", async ({
  page,
}) => {
  await page.route(`**/${asset}`, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: source }),
  );
  await page.goto("/preview");
  const scene = { kind: "frame", x: 10, y: 10, width: 100, height: 80 };
  const image = {
    id: "photo",
    kind: "image",
    asset,
    mapping: { mode: "contain", anchor: { x: 0.5, y: 0.5 } },
  };
  const mount = async (
    mapping: unknown,
    extra: Record<string, unknown> = {},
    slots: Record<string, unknown> = {},
  ) =>
    page.evaluate(
      async ({ scene, image, mapping, extra, slots }) => {
        const moduleURL = "/tests/fixtures/image-paint-runtime.tsx";
        const { mount } = await import(moduleURL);
        await mount([
          {
            id: "f",
            type: "SceneFrame",
            props: {},
            slots,
            scene: { ...scene, ...extra, fills: [{ ...image, mapping }] },
          },
        ]);
      },
      { scene, image, mapping, extra, slots },
    );
  await mount(image.mapping);
  expect(
    await sample(page, [
      [30, 15],
      [30, 40],
      [90, 40],
    ]),
  ).toEqual([
    [255, 255, 255, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  await mount({ mode: "tile", imageToFrame: [40, 0, 0, 40, 0, 0] });
  expect(
    await sample(page, [
      [20, 30],
      [40, 30],
      [60, 30],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [255, 0, 0, 255],
  ]);
  await mount({ mode: "crop", imageToFrame: [-100, 0, 0, 80, 100, 0] });
  expect(
    await sample(page, [
      [30, 30],
      [90, 30],
    ]),
  ).toEqual([
    [0, 0, 255, 255],
    [255, 0, 0, 255],
  ]);
  await mount(
    { mode: "cover", anchor: { x: 0.5, y: 0.5 } },
    { radius: 20, stroke: "#00ff00", strokeWidth: 4 },
  );
  expect(
    await sample(page, [
      [11, 11],
      [17, 17],
    ]),
  ).toEqual([
    [255, 255, 255, 255],
    [0, 255, 0, 255],
  ]);
  const slots = {
    default: [
      {
        id: "child",
        type: "SceneFrame",
        props: {},
        slots: {},
        scene: {
          kind: "frame",
          x: 90,
          y: 30,
          width: 50,
          height: 20,
          fill: "#ff00ff",
        },
      },
    ],
  };
  await mount(image.mapping, {}, slots);
  expect((await sample(page, [[130, 50]]))[0]).toEqual([255, 0, 255, 255]);
  await mount(image.mapping, { clip: true }, slots);
  expect((await sample(page, [[130, 50]]))[0]).toEqual([255, 255, 255, 255]);
});

test("iframe readiness settles images before revision and ignores a cancelled older snapshot", async ({
  page,
}) => {
  const missing = `assets/${"b".repeat(64)}.svg`;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(`**/${asset}`, async (route) => {
    requested = true;
    await gate;
    await route.fulfill({ contentType: "image/svg+xml", body: source });
  });
  await page.route(`**/${missing}`, (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    const project = await fetch("/api/project", {
      headers: { Authorization: `Bearer ${session.token}` },
    }).then((r) => r.json());
    const iframe = document.createElement("iframe");
    iframe.id = "resource-frame";
    iframe.src = "/preview";
    Object.assign(window, { resourceProject: project, resourceStatuses: [] });
    window.addEventListener("message", (event) => {
      if (
        event.source === iframe.contentWindow &&
        event.data.type === "studio-preview-image-status"
      )
        (window as any).resourceStatuses.push(event.data);
    });
    document.body.append(iframe);
  });
  const preview = page.frameLocator("#resource-frame");
  await expect(preview.locator("html")).toHaveAttribute(
    "data-studio-preview-listening",
    "true",
  );
  const render = async (revision: number, imageAsset: string) =>
    page.evaluate(
      ({ revision, imageAsset }) => {
        const project = { ...(window as any).resourceProject, revision };
        const frame =
          document.querySelector<HTMLIFrameElement>("#resource-frame")!;
        frame.contentWindow!.postMessage(
          {
            type: "studio-preview-render",
            project,
            library: project.library,
            theme: project.theme,
            nodes: [
              {
                id: "resource-node",
                type: "SceneFrame",
                props: {},
                slots: {},
                scene: {
                  kind: "frame",
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 80,
                  fills: [
                    {
                      id: "image",
                      kind: "image",
                      asset: imageAsset,
                      mapping: { mode: "cover", anchor: { x: 0.5, y: 0.5 } },
                    },
                  ],
                },
              },
            ],
          },
          location.origin,
        );
      },
      { revision, imageAsset },
    );
  await render(40, asset);
  await expect.poll(() => requested).toBe(true);
  expect(
    await preview.locator("html").getAttribute("data-studio-preview-revision"),
  ).toBeNull();
  await render(41, missing);
  await expect(preview.locator("html")).toHaveAttribute(
    "data-studio-preview-revision",
    "41",
  );
  expect(
    JSON.parse(
      (await preview
        .locator("html")
        .getAttribute("data-studio-preview-image-warnings"))!,
    ),
  ).toEqual([{ code: "PROJECT_IMAGE_UNAVAILABLE", asset: missing }]);
  const oldResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/${asset}`),
  );
  release();
  await (await oldResponse).finished();
  await preview
    .locator("html")
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  await expect
    .poll(() => page.evaluate(() => (window as any).resourceStatuses.length))
    .toBe(1);
  const statuses = await page.evaluate(() => (window as any).resourceStatuses);
  expect(
    statuses.map((status: { revision: number }) => status.revision),
  ).toEqual([41]);
  expect(
    await preview.locator("html").getAttribute("data-studio-preview-revision"),
  ).toBe("41");
});

test("valid over-budget scene publishes bounded iframe warnings and a settled revision", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/assets/*.png", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.goto("/");
  const revision = await page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    const project = await fetch("/api/project", {
      headers: { Authorization: `Bearer ${session.token}` },
    }).then((r) => r.json());
    const projectModule = "/src/core/project.ts";
    const { parseProject } = await import(projectModule);
    const nodes = Array.from({ length: 63 }, (_, frame) => ({
      id: `budget-frame-${frame}`,
      type: "SceneFrame",
      props: {},
      slots: {},
      scene: {
        kind: "frame",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fills: Array.from({ length: 16 }, (_, paint) => ({
          id: `paint-${paint}`,
          kind: "image",
          asset: `assets/${(frame * 16 + paint).toString(16).padStart(64, "0")}.png`,
          mapping: { mode: "cover", anchor: { x: 0.5, y: 0.5 } },
        })),
      },
    }));
    const valid = parseProject({
      schemaVersion: 2,
      projectId: "budget-scene",
      name: "Budget scene",
      library: project.library,
      theme: project.theme,
      tokens: {},
      revision: 70,
      pages: [
        { screenId: "budget", name: "Budget", viewport: { width: 390, height: 600 }, nodes },
      ],
    });
    const iframe = document.createElement("iframe");
    iframe.id = "budget-frame";
    iframe.src = "/preview";
    Object.assign(window, {
      budgetInput: {
        type: "studio-preview-render",
        project: valid,
        library: valid.library,
        theme: valid.theme,
        nodes,
      },
    });
    document.body.append(iframe);
    return valid.revision;
  });
  const preview = page.frameLocator("#budget-frame");
  await expect(preview.locator("html")).toHaveAttribute(
    "data-studio-preview-listening",
    "true",
  );
  await page.evaluate(() =>
    document
      .querySelector<HTMLIFrameElement>("#budget-frame")!
      .contentWindow!.postMessage((window as any).budgetInput, location.origin),
  );
  await expect(preview.locator("html")).toHaveAttribute(
    "data-studio-preview-revision",
    String(revision),
  );
  const warnings = JSON.parse(
    (await preview
      .locator("html")
      .getAttribute("data-studio-preview-image-warnings"))!,
  );
  expect(warnings).toHaveLength(1000);
  expect(warnings[0]).toEqual({
    code: "PROJECT_IMAGE_UNAVAILABLE",
    asset: `assets/${"0".repeat(64)}.png`,
  });
  expect(warnings[999].asset).toBe(
    `assets/${(999).toString(16).padStart(64, "0")}.png`,
  );
  expect(pageErrors).toEqual([]);
});
