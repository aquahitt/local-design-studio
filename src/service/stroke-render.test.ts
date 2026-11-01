import { expect, it } from "vitest";
import { chromium } from "@playwright/test";
import { parseProject } from "../core/project";
import { renderSnapshot } from "./render";

it("default PNG capture retains layout bounds while full viewport paints outside strokes and clips children", async () => {
  const stroke = (
    id: string,
    color: { r: number; g: number; b: number; a: number },
    width: number,
    alignment: string,
  ) => ({ id, kind: "solid", color, width, alignment });
  const project = parseProject({
    schemaVersion: 2,
    projectId: "stroke-render",
    name: "Stroke render",
    revision: 0,
    library: { id: "builtin", version: "1" },
    theme: "light",
    tokens: {},
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 400, height: 400 },
        nodes: [
          {
            id: "frame",
            type: "SceneFrame",
            props: {},
            slots: {
              content: [
                {
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
                },
              ],
            },
            scene: {
              kind: "frame",
              x: 80,
              y: 70,
              width: 100,
              height: 80,
              fill: "#ffffff",
              clip: true,
              strokes: [
                stroke("outer", { r: 255, g: 0, b: 0, a: 1 }, 10, "outside"),
                stroke("inner", { r: 0, g: 255, b: 0, a: 1 }, 5, "inside"),
              ],
            },
          },
        ],
      },
    ],
  });
  const original = JSON.stringify(project);
  const full = await renderSnapshot(project, { pageId: "home", revision: 0 });
  const bound = full.bounds.find((row) => row.id === "frame")!;
  expect(bound).toMatchObject({ x: 100, y: 90, width: 100, height: 80 });
  const crop = await renderSnapshot(project, {
    pageId: "home",
    revision: 0,
    nodeId: "frame",
  });
  expect(crop.bounds).toEqual(full.bounds);
  expect(crop).not.toHaveProperty("captureMode");
  expect(crop).not.toHaveProperty("captureBounds");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const sample = async (data: string, points: number[][]) =>
      page.evaluate(
        async ({ data, points }) => {
          const image = new Image();
          image.src = "data:image/png;base64," + data;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          return {
            width: image.naturalWidth,
            height: image.naturalHeight,
            colors: points.map(([x, y]) => [
              ...ctx.getImageData(x, y, 1, 1).data,
            ]),
          };
        },
        { data, points },
      );
    expect(
      await sample(full.data, [
        [bound.x - 5, bound.y + 30],
        [bound.x + 2, bound.y + 30],
        [bound.x + 97, bound.y + 30],
        [bound.x + 105, bound.y + 30],
      ]),
    ).toEqual({
      width: 400,
      height: 400,
      colors: [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 0, 0, 255],
      ],
    });
    expect(
      await sample(crop.data, [
        [2, 30],
        [97, 30],
      ]),
    ).toEqual({
      width: 100,
      height: 80,
      colors: [
        [0, 255, 0, 255],
        [0, 0, 255, 255],
      ],
    });
    const explicit = structuredClone(project);
    explicit.pages[0].nodes[0].scene!.radius = 12;
    explicit.pages[0].nodes.unshift({
      id: "neighbor",
      type: "SceneFrame",
      props: {},
      slots: {},
      scene: {
        kind: "frame",
        x: 60,
        y: 50,
        width: 140,
        height: 120,
        fill: "#abcdef",
      },
    });
    const savedExplicit = JSON.stringify(explicit);
    for (const captureMode of ["scene", "isolated"] as const) {
      const visual = await renderSnapshot(explicit, {
        pageId: "home",
        revision: 0,
        nodeId: "frame",
        boundsMode: "visual",
        captureMode,
      });
      expect(visual).toMatchObject({
        boundsMode: "visual",
        captureMode,
        captureBounds: { x: 90, y: 80, width: 120, height: 100 },
        visualBoundsStatus: "conservative",
      });
      expect(visual.visualBoundsPolicy).toBeTruthy();
      expect(
        await sample(visual.data, [
          [0, 0],
          [5, 40],
          [107, 40],
          [115, 40],
        ]),
      ).toEqual({
        width: 120,
        height: 100,
        colors: [
          captureMode === "isolated" ? [0, 0, 0, 0] : [171, 205, 239, 255],
          [255, 0, 0, 255],
          [0, 0, 255, 255],
          [255, 0, 0, 255],
        ],
      });
    }
    const isolatedLayout = await renderSnapshot(explicit, {
      pageId: "home",
      revision: 0,
      nodeId: "frame",
      boundsMode: "layout",
      captureMode: "isolated",
    });
    expect(isolatedLayout).toMatchObject({
      captureMode: "isolated",
      boundsMode: "layout",
      captureBounds: { x: 100, y: 90, width: 100, height: 80 },
    });
    expect(JSON.stringify(explicit)).toBe(savedExplicit);
    const shadowed = structuredClone(project);
    Object.assign(shadowed.pages[0].nodes[0].scene!, {
      strokes: [],
      radius: 0,
      shadows: [
        {
          id: "shadow",
          kind: "outer",
          x: 20,
          y: 0,
          blur: 4,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    const shadowPng = await renderSnapshot(shadowed, {
      pageId: "home",
      revision: 0,
      nodeId: "frame",
      boundsMode: "visual",
      captureMode: "isolated",
    });
    expect(shadowPng.captureBounds).toEqual({
      x: 100,
      y: 76,
      width: 134,
      height: 108,
    });
    const shadowPixels = await sample(shadowPng.data, [
      [122, 54],
      [133, 54],
      [0, 0],
    ]);
    expect(shadowPixels.width).toBe(134);
    expect(shadowPixels.colors[0][3]).toBeGreaterThan(0);
    expect(shadowPixels.colors[1][3]).toBe(0);
    expect(shadowPixels.colors[2][3]).toBe(0);
    const missing = structuredClone(explicit);
    const missingAsset = "assets/" + "a".repeat(64) + ".png";
    missing.pages[0].nodes[0].scene!.fills = [
      {
        id: "missing",
        kind: "image",
        asset: missingAsset,
        mapping: { mode: "cover", anchor: { x: 0.5, y: 0.5 } },
        enabled: true,
        opacity: 1,
        blendMode: "normal",
      },
    ];
    await expect(
      renderSnapshot(missing, {
        pageId: "home",
        revision: 0,
        nodeId: "frame",
        captureMode: "scene",
      }),
    ).rejects.toMatchObject({ code: "IMAGE_RESOURCE_UNAVAILABLE" });
    const isolatedMissing = await renderSnapshot(missing, {
      pageId: "home",
      revision: 0,
      nodeId: "frame",
      boundsMode: "visual",
      captureMode: "isolated",
    });
    expect(isolatedMissing.captureBounds).toEqual({
      x: 90,
      y: 80,
      width: 120,
      height: 100,
    });
  } finally {
    await browser.close();
  }
  expect(JSON.stringify(project)).toBe(original);
}, 60000);
