import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, it } from "vitest";
import { layerStyle } from "./handoff";
import type { ProjectNode } from "./project";

const node = (
  linearTransform?: [number, number, number, number],
): ProjectNode => ({
  id: "probe",
  type: "SceneFrame",
  props: {},
  slots: {},
  scene: {
    kind: "frame",
    x: 100,
    y: 80,
    width: 40,
    height: 20,
    ...(linearTransform ? { linearTransform } : {}),
    fill: "#ff0000",
  },
});

it("emits a linear CSS matrix with x/y as the only translation and preserves legacy rotation", () => {
  expect(layerStyle(node([2, 0.5, -0.25, 3]))).toMatchObject({
    transform: "matrix(2, 0.5, -0.25, 3, 0, 0)",
    transformOrigin: "0 0",
    left: 100,
    top: 80,
    width: 40,
    height: 20,
  });
  expect(layerStyle(node()).transform).toBe("rotate(0deg)");
  const legacy = node();
  legacy.scene!.rotation = -30;
  expect(layerStyle(legacy).transform).toBe("rotate(-30deg)");
});

it("Chromium preserves independent nonuniform, shear and reflected corner geometry and scales content without rewriting layout", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 600, height: 400 },
    });
    for (const [linear, corners] of [
      [
        [2, 0, 0, 3],
        [
          [100, 80],
          [180, 80],
          [180, 140],
          [100, 140],
        ],
      ],
      [
        [1, 0.5, 0.75, 1],
        [
          [100, 80],
          [140, 100],
          [155, 120],
          [115, 100],
        ],
      ],
      [
        [-2, 0, 0.5, 1],
        [
          [100, 80],
          [20, 80],
          [30, 100],
          [110, 100],
        ],
      ],
    ] as [[number, number, number, number], number[][]][]) {
      const style = layerStyle(node(linear));
      const html = renderToStaticMarkup(
        createElement(
          "div",
          { id: "probe", style },
          [
            [0, 0],
            [40, 0],
            [40, 20],
            [0, 20],
          ].map(([left, top], i) =>
            createElement("i", {
              key: i,
              "data-corner": i,
              style: { position: "absolute", left, top, width: 0, height: 0 },
            }),
          ),
          createElement(
            "span",
            {
              id: "text",
              style: {
                fontSize: 10,
                lineHeight: "10px",
                display: "block",
                width: 20,
                height: 10,
              },
            },
            "Text",
          ),
          createElement(
            "svg",
            { id: "vector", width: 10, height: 5 },
            createElement("path", { d: "M0 0H10V5H0Z", fill: "blue" }),
          ),
        ),
      );
      await page.setContent(`<style>body{margin:0}</style>${html}`);
      const actual = await page
        .locator("[data-corner]")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return [box.x, box.y];
          }),
        );
      expect(actual).toEqual(corners);
      expect(
        await page.locator("#probe").evaluate((element) => ({
          width: (element as HTMLElement).offsetWidth,
          height: (element as HTMLElement).offsetHeight,
          fontSize: getComputedStyle(document.querySelector("#text")!).fontSize,
          vectorWidth: document.querySelector("#vector")!.getAttribute("width"),
        })),
      ).toEqual({ width: 40, height: 20, fontSize: "10px", vectorWidth: "10" });
      if (linear[0] === 2) {
        expect(await page.locator("#text").boundingBox()).toMatchObject({
          width: 40,
          height: 30,
        });
        expect(await page.locator("#vector").boundingBox()).toMatchObject({
          width: 20,
          height: 15,
        });
      }
    }
  } finally {
    await browser.close();
  }
}, 15000);
