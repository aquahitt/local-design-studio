import { expect, test, type Page } from "@playwright/test";
const scene = {
  kind: "frame",
  x: 80,
  y: 70,
  width: 100,
  height: 80,
  linearTransform: [1, 0.2, 0.5, 1],
  strokes: [
    {
      id: "stroke",
      kind: "solid",
      color: { r: 0, g: 0, b: 0, a: 1 },
      width: 10,
      alignment: "outside",
    },
  ],
  shadows: [
    {
      id: "shadow",
      kind: "outer",
      x: 12,
      y: -5,
      blur: 4,
      spread: 2,
      color: { r: 0, g: 0, b: 0, a: 0.5 },
    },
  ],
};
async function mount(page: Page) {
  await page.goto("/preview");
  await page.evaluate(async (scene) => {
    const url = "/tests/fixtures/image-paint-runtime.tsx";
    await (
      await import(url)
    ).mount([
      { id: "visual-frame", type: "SceneFrame", props: {}, slots: {}, scene },
    ]);
  }, scene);
}
test("paint envelopes follow actual affine DOM geometry without changing scroll overflow or pixels", async ({
  page,
}) => {
  await mount(page);
  const frame = page.locator('[data-node-id="visual-frame"]');
  const envelope = page.locator(
    '[data-studio-envelope-policy="css-raster-envelope-6sigma-plus-2px"]',
  );
  await expect(envelope).toHaveCount(1);
  const bounds = (await envelope.boundingBox())!;
  expect(bounds.x).toBeCloseTo(65.5, 3);
  expect(bounds.y).toBeCloseTo(48.2, 3);
  expect(bounds.width).toBeCloseTo(188, 3);
  expect(bounds.height).toBeCloseTo(138.4, 3);
  const scroll = await frame.evaluate((element) => ({
    width: element.scrollWidth,
    height: element.scrollHeight,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
  }));
  const before = await page.screenshot();
  await page
    .locator("[data-studio-metadata-clip]")
    .evaluateAll((elements) => elements.forEach((element) => element.remove()));
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(
    await frame.evaluate((element) => ({
      width: element.scrollWidth,
      height: element.scrollHeight,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
    })),
  ).toEqual(scroll);
  expect(await page.screenshot()).toEqual(before);
  await expect(page.locator("[data-node-id]")).toHaveCount(1);
});
test("paint envelopes include the real containing-block transform instead of a model-only offset", async ({
  page,
}) => {
  await mount(page);
  await page.locator('[data-node-id="visual-frame"]').evaluate((element) => {
    Object.assign(element.parentElement!.style, {
      transform: "translate(20px,30px) scale(2,.5)",
      transformOrigin: "0 0",
    });
  });
  const bounds = (await page
    .locator(
      '[data-studio-envelope-policy="css-raster-envelope-6sigma-plus-2px"]',
    )
    .boundingBox())!;
  expect(bounds.x).toBeCloseTo(151, 3);
  expect(bounds.y).toBeCloseTo(54.1, 3);
  expect(bounds.width).toBeCloseTo(376, 3);
  expect(bounds.height).toBeCloseTo(69.2, 3);
});

import {
  captureMeasurementExpression,
  type CaptureMeasurement,
} from "../src/service/capture-dom";
test("shared visual measurement unions real paint envelopes and clips only descendants", async ({
  page,
}) => {
  await mount(page);
  const read = () =>
    page.evaluate<CaptureMeasurement>(
      captureMeasurementExpression({
        nodeId: "visual-frame",
        nodeIds: ["visual-frame"],
        visual: true,
      }),
    );
  let result = await read();
  expect(result.diagnostics).toEqual([]);
  const bounds = result.visualBounds[0];
  expect(bounds.x).toBeCloseTo(65, 3);
  expect(bounds.y).toBeCloseTo(48.2, 3);
  expect(bounds.width).toBeCloseTo(188.5, 3);
  expect(bounds.height).toBeCloseTo(138.4, 3);
  await page.locator('[data-node-id="visual-frame"]').evaluate((element) => {
    (element as HTMLElement).style.overflow = "hidden";
    const child = document.createElement("div");
    child.style.cssText =
      "position:absolute;left:90px;top:30px;width:1000px;height:50px;background:red";
    element.append(child);
  });
  result = await read();
  expect(result.diagnostics).toEqual([]);
  expect(result.visualBounds[0].width).toBeCloseTo(bounds.width, 3);
});
test("shared visual measurement follows independent CSS rotate and scale on the containing block", async ({
  page,
}) => {
  await mount(page);
  await page.locator('[data-node-id="visual-frame"]').evaluate((element) => {
    Object.assign(element.parentElement!.style, {
      rotate: "30deg",
      scale: "2 1",
      transformOrigin: "0 0",
    });
  });
  const expected = await page
    .locator("[data-studio-paint-envelope]")
    .evaluateAll((elements) => {
      const bounds = elements.map((element) => element.getBoundingClientRect());
      const x = Math.min(...bounds.map((b) => b.x)),
        y = Math.min(...bounds.map((b) => b.y));
      return {
        x,
        y,
        width: Math.max(...bounds.map((b) => b.right)) - x,
        height: Math.max(...bounds.map((b) => b.bottom)) - y,
      };
    });
  const result = await page.evaluate<CaptureMeasurement>(
    captureMeasurementExpression({ nodeId: "visual-frame", visual: true }),
  );
  expect(result.diagnostics).toEqual([]);
  for (const key of ["x", "y", "width", "height"] as const)
    expect(result.visualBounds[0][key]).toBeCloseTo(expected[key], 3);
});
test("unmeasurable filters are diagnosed only for visual mode without leaking CSS values", async ({
  page,
}) => {
  await mount(page);
  await page
    .locator('[data-node-id="visual-frame"]')
    .evaluate(
      (element) => ((element as HTMLElement).style.filter = "blur(3px)"),
    );
  const visual = await page.evaluate<CaptureMeasurement>(
    captureMeasurementExpression({ nodeId: "visual-frame", visual: true }),
  );
  expect(visual.diagnostics).toContainEqual({
    code: "VISUAL_BOUNDS_UNSUPPORTED",
    nodeId: "visual-frame",
    feature: "filter",
  });
  expect(JSON.stringify(visual.diagnostics)).not.toContain("3px");
  const layout = await page.evaluate<CaptureMeasurement>(
    captureMeasurementExpression({ nodeId: "visual-frame", visual: false }),
  );
  expect(layout.diagnostics).toEqual([]);
  expect(layout.visualBounds).toEqual([]);
});

test("absolute content escapes overflow ancestors below its containing block", async ({
  page,
}) => {
  await page.setContent(
    '<div id="root"><div data-node-id="target" style="position:relative;width:100px;height:100px"><div style="overflow:hidden;width:20px;height:20px"><div style="position:absolute;left:150px;top:0;width:50px;height:30px;background:red"></div></div></div></div>',
  );
  const result = await page.evaluate<CaptureMeasurement>(
    captureMeasurementExpression({ nodeId: "target", visual: true }),
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.visualBounds[0].width).toBeGreaterThanOrEqual(200);
});

test("ordinary affine SVG icons accept legacy Chromium SVGMatrix", async ({
  page,
}) => {
  await page.setContent(
    '<div data-node-id="target" style="width:24px;height:24px"><svg width="24" height="24"><path d="M0 0H24V24H0Z"/></svg></div>',
  );
  let result = await page.evaluate<CaptureMeasurement>(
    captureMeasurementExpression({ nodeId: "target", visual: true }),
  );
  expect(result.diagnostics).toEqual([]);
  await page.locator("svg").evaluate((el) => {
    (el as SVGElement).style.transform = "perspective(100px) rotateY(20deg)";
  });
  result = await page.evaluate<CaptureMeasurement>(
    captureMeasurementExpression({ nodeId: "target", visual: true }),
  );
  expect(result.diagnostics).toContainEqual({
    code: "VISUAL_BOUNDS_UNSUPPORTED",
    nodeId: "target",
    feature: "non-affine-transform",
  });
});

test("non-scaling SVG strokes fail explicitly instead of returning clipped bounds", async ({
  page,
}) => {
  await page.setContent(
    '<div data-node-id="target" style="width:1px;height:1px"><svg width="1" height="1" style="overflow:visible"><path d="M0 0L100 100" transform="scale(.1)" stroke="red" stroke-width="20" vector-effect="non-scaling-stroke" fill="none"/></svg></div>',
  );
  const result = await page.evaluate<CaptureMeasurement>(
    captureMeasurementExpression({ nodeId: "target", visual: true }),
  );
  expect(result.diagnostics).toContainEqual({
    code: "VISUAL_BOUNDS_UNSUPPORTED",
    nodeId: "target",
    feature: "svg-vector-effect",
  });
});
