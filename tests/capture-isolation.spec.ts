import { expect, test, type Page } from "@playwright/test";
import { transform } from "esbuild";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  isolateCaptureExpression,
  type CaptureIsolationResult,
} from "../src/service/capture-isolation";

async function mount(page: Page) {
  await page.setViewportSize({ width: 600, height: 500 });
  await page.goto("/preview");
  await page.evaluate(async () => {
    document.getElementById("root")?.remove();
    const url = "/tests/fixtures/image-paint-runtime.tsx";
    await (
      await import(url)
    ).mount([
      {
        id: "target",
        type: "SceneFrame",
        props: {},
        slots: {},
        scene: {
          kind: "frame",
          x: 80,
          y: 70,
          width: 80,
          height: 60,
          fill: "#00ff00",
        },
      },
      {
        id: "sibling",
        type: "SceneFrame",
        props: {},
        slots: {},
        scene: {
          kind: "frame",
          x: 80,
          y: 70,
          width: 80,
          height: 60,
          fill: "#ff0000",
        },
      },
    ]);
    document.querySelector('[data-node-id="target"]')!.parentElement!.id =
      "root";
  });
}

async function pixels(page: Page, points: number[][]) {
  const png = await page.screenshot({ omitBackground: true });
  return page.evaluate(
    async ({ data, points }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
    },
    { data: png.toString("base64"), points },
  );
}

test("isolates pixels without losing layout, inherited opacity, own clipping or hidden descendants", async ({
  page,
}) => {
  await mount(page);
  const before = await page.evaluate(() => {
    const host = document.getElementById("root")!;
    host.style.cssText =
      "position:relative;width:100px;height:100px;overflow:hidden;background:magenta;border:7px solid black;padding:11px;opacity:.5;font:18px monospace";
    const target = document.querySelector<HTMLElement>(
      '[data-node-id="target"]',
    )!;
    target.style.overflow = "hidden";
    const hidden = document.createElement("div");
    hidden.id = "hidden-child";
    hidden.style.cssText =
      "position:absolute;inset:0;background:blue;visibility:hidden";
    const visible = document.createElement("div");
    visible.id = "visible-child";
    visible.style.cssText =
      "position:absolute;left:60px;top:0;width:40px;height:20px;background:blue;visibility:visible";
    hidden.append(visible);
    target.append(hidden);
    const flow = document.createElement("div");
    flow.id = "flow";
    flow.style.cssText = "height:24px;background:red";
    host.prepend(flow);
    const style = document.createElement("style");
    style.textContent =
      "#root > [data-node-id]:nth-child(2) { margin-left:3px }";
    document.head.append(style);
    const sibling = document.querySelector('[data-node-id="sibling"]')!;
    return {
      target: target.getBoundingClientRect().toJSON(),
      sibling: sibling.getBoundingClientRect().toJSON(),
      flow: flow.getBoundingClientRect().toJSON(),
      count: host.children.length,
    };
  });
  const result = await page.evaluate<CaptureIsolationResult>(
    isolateCaptureExpression({
      nodeId: "target",
      nodeIds: ["target", "sibling", "absent-hidden"],
    }),
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.boundsBefore.map((bound: { id: string }) => bound.id)).toEqual([
    "target",
    "sibling",
  ]);
  expect(
    await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>(
        '[data-node-id="target"]',
      )!;
      return {
        target: target.getBoundingClientRect().toJSON(),
        sibling: document
          .querySelector('[data-node-id="sibling"]')!
          .getBoundingClientRect()
          .toJSON(),
        flow: document.getElementById("flow")!.getBoundingClientRect().toJSON(),
        count: document.getElementById("root")!.children.length,
      };
    }),
  ).toEqual(before);
  expect(
    await page
      .locator("#hidden-child")
      .evaluate((node) => getComputedStyle(node).visibility),
  ).toBe("hidden");
  expect(
    await page
      .locator("#visible-child")
      .evaluate((node) => getComputedStyle(node).visibility),
  ).toBe("visible");
  expect(
    await page.locator('[data-node-id="target"]').evaluate((node) => ({
      font: getComputedStyle(node).fontSize,
      overflow: getComputedStyle(node).overflow,
    })),
  ).toEqual({ font: "18px", overflow: "hidden" });
  const x = before.target.x,
    y = before.target.y;
  expect(
    await pixels(page, [
      [10, 10],
      [x + 5, y + 30],
      [x + 65, y + 5],
      [x + 85, y + 5],
    ]),
  ).toEqual([
    [0, 0, 0, 0],
    [0, 255, 0, 128],
    [0, 0, 255, 128],
    [0, 0, 0, 0],
  ]);
  expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([
    600, 500,
  ]);
});

test("retains affine ancestry and fixed containing blocks when removing only paint containment", async ({
  page,
}) => {
  await mount(page);
  const before = await page.evaluate(() => {
    const host = document.getElementById("root")!;
    host.style.cssText =
      "position:relative;width:350px;height:250px;contain:strict;transform:matrix(1,.2,.3,1,20,15);overflow:clip;clip-path:inset(20px);mask-image:linear-gradient(black,black)";
    const target = document.querySelector<HTMLElement>(
      '[data-node-id="target"]',
    )!;
    const fixed = document.createElement("div");
    fixed.id = "fixed";
    fixed.style.cssText =
      "position:fixed;right:5px;bottom:7px;width:20px;height:15px;background:blue";
    target.append(fixed);
    return {
      target: target.getBoundingClientRect().toJSON(),
      fixed: fixed.getBoundingClientRect().toJSON(),
    };
  });
  const result = await page.evaluate<CaptureIsolationResult>(
    isolateCaptureExpression({ nodeId: "target" }),
  );
  expect(result.diagnostics).toEqual([]);
  expect(
    await page.evaluate(() => ({
      target: document
        .querySelector('[data-node-id="target"]')!
        .getBoundingClientRect()
        .toJSON(),
      fixed: document.getElementById("fixed")!.getBoundingClientRect().toJSON(),
    })),
  ).toEqual(before);
  expect(
    await page.locator("#root").evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        contain: style.contain,
        clip: style.clipPath,
        mask: style.maskImage,
        overflow: style.overflow,
      };
    }),
  ).toEqual({
    contain: "size layout style",
    clip: "none",
    mask: "none",
    overflow: "visible",
  });
});

test("diagnoses context-dependent ancestor effects before any DOM mutation", async ({
  page,
}) => {
  await mount(page);
  for (const [property, value, feature] of [
    ["filter", "blur(1px)", "filter"],
    ["backdrop-filter", "blur(1px)", "backdrop-filter"],
    ["mix-blend-mode", "multiply", "mix-blend-mode"],
  ]) {
    await page
      .locator("#root")
      .evaluate(
        (node, { property, value }) =>
          (node as HTMLElement).style.setProperty(property, value),
        { property, value },
      );
    const html = await page.content();
    const result = await page.evaluate<CaptureIsolationResult>(
      isolateCaptureExpression({ nodeId: "target" }),
    );
    expect(result.diagnostics).toEqual([
      { code: "ISOLATED_CAPTURE_UNSUPPORTED", feature },
    ]);
    expect(await page.content()).toBe(html);
    await page
      .locator("#root")
      .evaluate(
        (node, property) =>
          (node as HTMLElement).style.removeProperty(property),
        property,
      );
  }
});

test("rejects ambiguous targets and unattributed body portals without leaking their content", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    const portal = document.createElement("div");
    portal.id = "private-portal";
    portal.style.cssText = "position:fixed;inset:0;background:red";
    document.body.append(portal);
  });
  const html = await page.content();
  expect(
    (
      await page.evaluate<CaptureIsolationResult>(
        isolateCaptureExpression({ nodeId: "target" }),
      )
    ).diagnostics,
  ).toEqual([{ code: "ISOLATED_CAPTURE_UNSUPPORTED", feature: "portal" }]);
  expect(await page.content()).toBe(html);
  await page.evaluate(() => {
    document.getElementById("private-portal")!.remove();
    const duplicate = document.createElement("div");
    duplicate.dataset.nodeId = "target";
    document.getElementById("root")!.append(duplicate);
  });
  expect(
    (
      await page.evaluate<CaptureIsolationResult>(
        isolateCaptureExpression({ nodeId: "target" }),
      )
    ).diagnostics,
  ).toEqual([
    {
      code: "ISOLATED_CAPTURE_UNSUPPORTED",
      nodeId: "target",
      feature: "ambiguous-node",
    },
  ]);
});

test("the closed expression survives minification and safely serializes target IDs", async ({
  page,
}) => {
  await mount(page);
  const id = 'target\"\\\n);throw new Error("injected")//';
  await page
    .locator('[data-node-id="target"]')
    .evaluate((node, id) => node.setAttribute("data-node-id", id), id);
  const source = await readFile(
    new URL("../src/service/capture-isolation.ts", import.meta.url),
    "utf8",
  );
  const compiled = await transform(source, {
    loader: "ts",
    format: "esm",
    minify: true,
    keepNames: true,
    target: "es2022",
  });
  const script = compiled.code.replace(/export\s*\{[^}]*\};?\s*$/, "");
  const exported = compiled.code.match(/export\s*\{([^}]*)\}/)![1];
  const builder = exported
    .split(",")
    .map((entry) => entry.trim().split(/\s+as\s+/))
    .find(
      (entry) => entry[entry.length - 1] === "isolateCaptureExpression",
    )![0];
  const expression = new Function(script + `; return ${builder};`)()({
    nodeId: id,
  });
  expect(
    (await page.evaluate<CaptureIsolationResult>(expression)).diagnostics,
  ).toEqual([]);
});

test("rejects external pseudo-element paint before isolating", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent =
      '[data-node-id="sibling"]::before { content:""; visibility:visible; position:absolute; inset:0; background:red; z-index:5 }';
    document.head.append(style);
  });
  const before = await page.content();
  const result = await page.evaluate<CaptureIsolationResult>(
    isolateCaptureExpression({ nodeId: "target" }),
  );
  expect(result.diagnostics).toEqual([
    { code: "ISOLATED_CAPTURE_UNSUPPORTED", feature: "outside-pseudo-element" },
  ]);
  expect(await page.content()).toBe(before);
});

test("tsx CLI factories remain closed when evaluated by Chromium", async ({
  page,
}) => {
  await page.setContent(
    '<div id="root"><div data-node-id="target" style="width:100px;height:100px;background:blue"></div></div>',
  );
  const isolationUrl = new URL(
    "../src/service/capture-isolation.ts",
    import.meta.url,
  ).href;
  const boundsUrl = new URL("../src/service/capture-dom.ts", import.meta.url)
    .href;
  const script = `import {isolateCaptureExpression} from ${JSON.stringify(isolationUrl)}; import {captureMeasurementExpression} from ${JSON.stringify(boundsUrl)}; console.log(JSON.stringify([isolateCaptureExpression({nodeId:"target"}),captureMeasurementExpression({nodeId:"target",visual:true})]));`;
  const expressions = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { encoding: "utf8" },
    ),
  ) as string[];
  expect(
    (await page.evaluate<CaptureIsolationResult>(expressions[0])).diagnostics,
  ).toEqual([]);
  const measurement = await page.evaluate<{ diagnostics: unknown[] }>(
    expressions[1],
  );
  expect(measurement.diagnostics).toEqual([]);
});
