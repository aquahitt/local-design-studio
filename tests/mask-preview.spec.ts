import { expect, test, type Page } from "@playwright/test";
async function show(
  page: Page,
  options: {
    mode?: "alpha" | "luminance";
    unsupported?: boolean;
    reveal?: string;
  } = {},
) {
  await page.goto("/preview");
  await page.waitForFunction(
    () => document.documentElement.dataset.studioPreviewListening === "true",
  );
  await page.evaluate(async (options) => {
    const fixtureModule = "/src/core/scene-fixtures.ts";
    const { sceneProject } = await import(fixtureModule);
    const project = sceneProject();
    project.library = { id: "builtin", version: "1" };
    const source: any = {
      id: "source",
      type: "SceneFrame",
      maskSource: true,
      props: {},
      slots: {},
      scene: {
        kind: "frame",
        x: 20,
        y: 20,
        width: 100,
        height: 60,
        fills: [
          {
            id: "bands",
            kind: "linear",
            angle: 90,
            stops: [
              { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
              { offset: 0.5, color: { r: 0, g: 0, b: 0, a: 1 } },
              { offset: 0.5, color: { r: 255, g: 255, b: 255, a: 1 } },
              { offset: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
            ],
          },
        ],
      },
    };
    if (options.unsupported) {
      source.type = "Button";
      source.scene = {
        kind: "component",
        x: 20,
        y: 20,
        width: 100,
        height: 60,
      };
      source.props = { label: "MASK SOURCE SHOULD NOT EXECUTE" };
    }
    const content: any = {
      id: "content",
      type: "SceneFrame",
      props: {},
      scene: {
        kind: "frame",
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        fill: "#f00",
      },
      slots: {
        children: [
          {
            id: "button",
            type: "Button",
            props: { label: "Actual HTML content" },
            slots: {},
            scene: { kind: "component", x: 30, y: 30, width: 180, height: 44 },
          },
        ],
      },
    };
    project.pages[0].nodes = [
      {
        id: "mask",
        type: "SceneMask",
        props: {},
        scene: {
          kind: "mask",
          maskMode: options.mode ?? "alpha",
          x: 0,
          y: 0,
          width: 300,
          height: 200,
        },
        slots: { children: [source, content] },
      },
    ];
    (window as any).__ldsMaskFixture = project;
    window.postMessage(
      {
        type: "studio-preview-render",
        project,
        library: project.library,
        theme: project.theme,
        nodes: project.pages[0].nodes,
        ...(options.reveal ? { resourceNodeId: options.reveal } : {}),
      },
      location.origin,
    );
  }, options);
  await page.waitForFunction(
    () => document.documentElement.dataset.studioPreviewRevision === "0",
  );
}
async function sample(page: Page, points: number[][]) {
  const data = (
    await page.locator('[data-node-id="mask"]').screenshot()
  ).toString("base64");
  return page.evaluate(
    async ({ data, points }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    },
    { data, points },
  );
}
test("Preview masks real HTML content while keeping one canonical source geometry", async ({
  page,
}) => {
  await show(page);
  await expect(page.locator('[data-studio-mask-state="ready"]')).toHaveCount(1);
  expect(
    await sample(page, [
      [25, 25],
      [100, 25],
      [10, 25],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
    [255, 255, 255, 255],
  ]);
  await expect(
    page.getByRole("button", { name: "Actual HTML content" }),
  ).toHaveCount(1);
  expect(
    await page.locator('[data-node-id="source"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }),
  ).toEqual({ width: 100, height: 60 });
  await expect(page.locator('[data-node-id="source"]')).toHaveCount(1);
  await expect(
    page.locator("[data-studio-mask-source-holder]"),
  ).toHaveAttribute("inert", "");
});
test("Preview luminance mode cuts black source pixels without replacing content DOM", async ({
  page,
}) => {
  await show(page, { mode: "luminance" });
  await expect(page.locator('[data-studio-mask-state="ready"]')).toHaveCount(1);
  expect(
    await sample(page, [
      [25, 25],
      [100, 25],
    ]),
  ).toEqual([
    [255, 255, 255, 255],
    [255, 0, 0, 255],
  ]);
});
test("Unsupported source fails transparent and never mounts a hidden library source component", async ({
  page,
}) => {
  await show(page, { unsupported: true });
  await expect(page.locator('[data-studio-mask-state="failed"]')).toHaveCount(
    1,
  );
  expect(
    await sample(page, [
      [25, 25],
      [100, 25],
    ]),
  ).toEqual([
    [255, 255, 255, 255],
    [255, 255, 255, 255],
  ]);
  await expect(
    page.getByRole("button", {
      name: "MASK SOURCE SHOULD NOT EXECUTE",
      includeHidden: true,
    }),
  ).toHaveCount(0);
});

test("moving a source reuses decoded pixels while canonical source geometry and mask position move together", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__ldsMaskDecodes = 0;
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      if (
        this.src.startsWith("data:image/svg+xml,") &&
        decodeURIComponent(this.src).includes("foreignObject")
      )
        (window as any).__ldsMaskDecodes++;
      return original.call(this);
    };
  });
  await show(page);
  const before = await page.evaluate(() => (window as any).__ldsMaskDecodes);
  const oldX = await page
    .locator('[data-node-id="source"]')
    .evaluate((el) => el.getBoundingClientRect().x);
  await page.evaluate(() => {
    const project = (window as any).__ldsMaskFixture;
    project.revision = 1;
    project.pages[0].nodes[0].slots.children[0].scene.x += 17;
    window.postMessage(
      {
        type: "studio-preview-render",
        project,
        library: project.library,
        theme: project.theme,
        nodes: project.pages[0].nodes,
      },
      location.origin,
    );
  });
  await page.waitForFunction(
    () => document.documentElement.dataset.studioPreviewRevision === "1",
  );
  expect(await page.evaluate(() => (window as any).__ldsMaskDecodes)).toBe(
    before,
  );
  expect(
    await page
      .locator('[data-node-id="source"]')
      .evaluate((el) => el.getBoundingClientRect().x),
  ).toBe(oldX + 17);
  expect(
    await sample(page, [
      [25, 25],
      [45, 25],
    ]),
  ).toEqual([
    [255, 255, 255, 255],
    [255, 0, 0, 255],
  ]);
});
test("late source decode cannot publish an obsolete mask or ready revision", async ({
  page,
}) => {
  test.setTimeout(30000);
  await page.addInitScript(() => {
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      const source = this.src;
      await original.call(this);
      if (
        source.startsWith("data:image/svg+xml,") &&
        decodeURIComponent(source).includes("foreignObject")
      )
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            /rgba\(0,\s*0,\s*0,\s*1\)/.test(decodeURIComponent(source))
              ? 900
              : 50,
          ),
        );
    };
  });
  await show(page, { mode: "luminance" });
  const change = async (revision: number, white: boolean) =>
    page.evaluate(
      ({ revision, white }) => {
        const project = (window as any).__ldsMaskFixture;
        project.revision = revision;
        project.pages[0].nodes[0].slots.children[0].scene.fills = [
          {
            id: "solid",
            kind: "solid",
            color: {
              r: white ? 255 : 0,
              g: white ? 255 : 0,
              b: white ? 255 : 0,
              a: 1,
            },
          },
        ];
        window.postMessage(
          {
            type: "studio-preview-render",
            project,
            library: project.library,
            theme: project.theme,
            nodes: project.pages[0].nodes,
          },
          location.origin,
        );
      },
      { revision, white },
    );
  await change(1, false);
  await expect(page.locator('[data-studio-mask-state="pending"]')).toHaveCount(
    1,
  );
  expect(await sample(page, [[100, 25]])).toEqual([[255, 255, 255, 255]]);
  await change(2, true);
  await page.waitForFunction(
    () => document.documentElement.dataset.studioPreviewRevision === "2",
  );
  expect(
    await sample(page, [
      [25, 25],
      [100, 25],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ]);
  await page.waitForTimeout(1100);
  expect(
    await page.evaluate(
      () => document.documentElement.dataset.studioPreviewRevision,
    ),
  ).toBe("2");
  expect(
    await sample(page, [
      [25, 25],
      [100, 25],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ]);
});
test("isolated source presentation reveals the existing canonical source before readiness", async ({
  page,
}) => {
  await show(page, { unsupported: true, reveal: "source" });
  await expect(
    page.getByRole("button", { name: "MASK SOURCE SHOULD NOT EXECUTE" }),
  ).toHaveCount(1);
  await expect(page.locator('[data-node-id="source"]')).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      JSON.parse(
        document.documentElement.dataset.studioPreviewMaskWarnings ?? "[]",
      ),
    ),
  ).toEqual([]);
  await expect(
    page.locator("[data-studio-mask-source-holder]"),
  ).not.toHaveAttribute("inert", "");
});
