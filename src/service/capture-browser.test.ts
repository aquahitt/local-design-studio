import { chromium, type Page } from "@playwright/test";
import { expect, it } from "vitest";
import { captureRectangle, translateCaptureExpression } from "./capture";

async function rect(page: Page, id: string) {
  return page.locator("#" + id).evaluate((node) => {
    const b = node.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
}

async function pixels(page: Page, data: string, points: [number, number][]) {
  return page.evaluate(
    async ({ data, points }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { colorSpace: "srgb" })!;
      context.drawImage(image, 0, 0);
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        samples: points.map(([x, y]) =>
          Array.from(context.getImageData(x, y, 1, 1).data),
        ),
      };
    },
    { data, points },
  );
}

const fixture = `<style>
body { margin:0;padding:20px;min-height:100vh;box-sizing:border-box;background:white }
.probe { background:rgb(255,0,0) }
@media (min-width:500px) { .probe { background:rgb(0,0,255) } }
</style><body style="margin:0;padding:20px;min-height:100vh;box-sizing:border-box;background:white">
<div id="root"><div style="position:relative;min-height:850px">
<div id="fixed" style="position:fixed;right:10px;bottom:12px;width:30px;height:25px;background:blue"></div>
<div id="target" class="probe" style="position:absolute;left:-550.25px;top:-400.5px;width:80.5px;height:60.25px"></div>
</div></div></body>`;

it("keeps viewport-fixed descendants, responsive CSS and fractional node geometry when translating a remote crop", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 600 },
    });
    await page.setContent(fixture);
    const target = await rect(page, "target");
    const fixed = await rect(page, "fixed");
    expect(fixed).toEqual({ x: 350, y: 563, width: 30, height: 25 });
    await page.evaluate(translateCaptureExpression(target));
    const movedFixed = await rect(page, "fixed");
    expect(movedFixed.x).toBeCloseTo(fixed.x - target.x);
    expect(movedFixed.y).toBeCloseTo(fixed.y - target.y);
    expect(movedFixed.width).toBe(fixed.width);
    expect(movedFixed.height).toBe(fixed.height);
    expect(
      await page.evaluate(() => [
        innerWidth,
        innerHeight,
        matchMedia("(min-width:500px)").matches,
      ]),
    ).toEqual([390, 600, false]);
    expect(
      await page
        .locator("#target")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe("rgb(255, 0, 0)");
    expect(await rect(page, "target")).toEqual({
      x: 0,
      y: 0,
      width: 80.5,
      height: 60.25,
    });
    const session = await page.context().newCDPSession(page);
    const capture = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: captureRectangle(target),
    });
    expect(await pixels(page, capture.data, [[40, 30]])).toEqual({
      width: 81,
      height: 61,
      samples: [[255, 0, 0, 255]],
    });
  } finally {
    await browser.close();
  }
}, 15000);

it("crops a viewport-fixed control itself without anchoring it to tall content", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 600 },
    });
    await page.setContent(fixture);
    const fixed = await rect(page, "fixed");
    await page.evaluate(translateCaptureExpression(fixed));
    expect(await rect(page, "fixed")).toEqual({
      x: 0,
      y: 0,
      width: 30,
      height: 25,
    });
    const session = await page.context().newCDPSession(page);
    const capture = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: captureRectangle(fixed),
    });
    expect(await pixels(page, capture.data, [[15, 12]])).toEqual({
      width: 30,
      height: 25,
      samples: [[0, 0, 255, 255]],
    });
  } finally {
    await browser.close();
  }
}, 15000);

it("preserves negative rotated bounds and ancestor clipping at device scale two", async () => {
  const browser = await chromium.launch();
  try {
    for (const targetId of ["rotated", "clipped"]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 600 },
        deviceScaleFactor: 2,
      });
      await page.setContent(`<body style="margin:0;padding:20px;min-height:100vh;box-sizing:border-box;background:white"><div id="root"><div style="position:relative;min-height:850px">
        <div id="rotated" style="position:absolute;left:-2000.25px;top:-3000.5px;width:80px;height:60px;transform:rotate(30deg);background:red"></div>
        <div style="position:absolute;left:6000.25px;top:7000.5px;width:100px;height:100px;overflow:hidden"><div id="clipped" style="position:absolute;left:-20px;top:20px;width:100px;height:60px;background:red"></div></div>
      </div></div></body>`);
      const before = await rect(page, targetId);
      const dpr = await page.evaluate(translateCaptureExpression(before));
      expect(dpr).toBe(2);
      const after = await rect(page, targetId);
      expect(after.x).toBeCloseTo(0);
      expect(after.y).toBeCloseTo(0);
      expect(after.width).toBeCloseTo(before.width);
      expect(after.height).toBeCloseTo(before.height);
      const clip = captureRectangle(before);
      const session = await page.context().newCDPSession(page);
      const capture = await session.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip,
      });
      const result = await pixels(page, capture.data, [
        [Math.floor(clip.width / 2), Math.floor(clip.height / 2)],
        [5, 30],
      ]);
      expect(result.width).toBe(clip.width);
      expect(result.height).toBe(clip.height);
      expect(result.samples[0]).toEqual([255, 0, 0, 255]);
      if (targetId === "clipped")
        expect(result.samples[1]).toEqual([255, 255, 255, 255]);
      else expect(before.width).toBeCloseTo(80 * Math.cos(Math.PI / 6) + 30);
      expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([
        390, 600,
      ]);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}, 20000);

it("preserves direct body selectors from a trusted component stylesheet", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 600 },
    });
    await page.setContent(
      fixture +
        `<style>#target {background:blue} body > #root #target {background:red}</style>`,
    );
    const before = await page
      .locator("#target")
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    const target = await rect(page, "target");
    await page.evaluate(translateCaptureExpression(target));
    expect(
      await page
        .locator("#target")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe(before);
  } finally {
    await browser.close();
  }
}, 15000);

it("preserves margins, rotated fixed controls and fixed children of a transformed ancestor", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 600 },
    });
    await page.setContent(`<body style="margin:0;padding:20px;min-height:100vh;box-sizing:border-box;background:white"><div id="root"><div style="position:relative;min-height:850px">
      <div id="target" style="position:absolute;left:-550.25px;top:-400.5px;width:80.5px;height:60.25px;background:red"></div>
      <div id="fixed-margin" style="position:fixed;right:10px;bottom:12px;width:30px;height:25px;margin:3px 7px 11px 5px;background:blue"></div>
      <div id="fixed-rotated" style="position:fixed;right:70px;bottom:35px;width:40px;height:30px;transform:rotate(25deg);transform-origin:25% 70%;margin:5px;background:green"></div>
      <div id="transformed" style="position:absolute;left:70px;top:120px;width:130px;height:90px;transform:rotate(15deg);padding:6px">
        <div id="nested-fixed" style="position:fixed;right:9px;bottom:7px;width:30px;height:20px;margin:2px 3px 4px 5px;background:purple"></div>
      </div>
    </div><div id="initial-absolute" style="position:absolute;right:14px;bottom:19px;width:31px;height:29px;margin:2px 3px 4px 5px;background:orange"></div></div></body>`);
    const target = await rect(page, "target");
    const ids = [
      "fixed-margin",
      "fixed-rotated",
      "nested-fixed",
      "initial-absolute",
    ];
    const before = await Promise.all(ids.map((id) => rect(page, id)));
    await page.evaluate(translateCaptureExpression(target));
    const after = await Promise.all(ids.map((id) => rect(page, id)));
    for (let i = 0; i < ids.length; i++) {
      expect(after[i].x, ids[i] + " x").toBeCloseTo(before[i].x - target.x);
      expect(after[i].y, ids[i] + " y").toBeCloseTo(before[i].y - target.y);
      expect(after[i].width, ids[i] + " width").toBeCloseTo(before[i].width);
      expect(after[i].height, ids[i] + " height").toBeCloseTo(before[i].height);
    }
  } finally {
    await browser.close();
  }
}, 15000);
