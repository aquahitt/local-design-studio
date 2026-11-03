import { expect, it } from "vitest";
import { chromium } from "@playwright/test";
import { parseProject, type ProjectNode } from "../core/project";
import { sceneProject } from "../core/scene-fixtures";
import { renderSnapshot } from "./render";
function fixture(unsupported = false) {
  const project = parseProject(sceneProject());
  project.library = { id: "builtin", version: "1" };
  const source: ProjectNode = {
    id: "source",
    type: unsupported ? "Button" : "SceneFrame",
    maskSource: true,
    props: unsupported ? { label: "Raw mask source" } : {},
    slots: {},
    scene: {
      kind: unsupported ? "component" : "frame",
      x: 20,
      y: 20,
      width: 100,
      height: 60,
      ...(!unsupported ? { fill: "#fff" } : {}),
    },
  };
  const content: ProjectNode = {
    id: "content",
    type: "SceneFrame",
    props: {},
    slots: {},
    scene: { kind: "frame", x: 0, y: 0, width: 800, height: 500, fill: "#f00" },
  };
  project.pages[0].nodes = [
    {
      id: "mask",
      type: "SceneMask",
      props: {},
      scene: {
        kind: "mask",
        maskMode: "alpha",
        x: 0,
        y: 0,
        width: 300,
        height: 200,
      },
      slots: { children: [source, content] },
    },
  ];
  return parseProject(project);
}
it("PNG rejects failed masks, scopes isolated content/source correctly and constrains visual content by the real mask envelope", async () => {
  const project = fixture(),
    original = JSON.stringify(project);
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
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          return {
            width: image.width,
            height: image.height,
            pixels: points.map(([x, y]) => [
              ...ctx.getImageData(x, y, 1, 1).data,
            ]),
          };
        },
        { data, points },
      );
    const mask = await renderSnapshot(project, {
      pageId: "home",
      revision: 0,
      nodeId: "mask",
      captureMode: "isolated",
      boundsMode: "visual",
    });
    expect(mask.captureBounds).toMatchObject({ width: 300, height: 200 });
    expect(
      await sample(mask.data, [
        [25, 25],
        [10, 25],
        [250, 100],
      ]),
    ).toEqual({
      width: 300,
      height: 200,
      pixels: [
        [255, 0, 0, 255],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    });
    const invalid = fixture(true),
      saved = JSON.stringify(invalid);
    await expect(
      renderSnapshot(invalid, { pageId: "home", revision: 0, nodeId: "mask" }),
    ).rejects.toMatchObject({ code: "MASK_SOURCE_UNSUPPORTED" });
    const content = await renderSnapshot(invalid, {
      pageId: "home",
      revision: 0,
      nodeId: "content",
      captureMode: "isolated",
      boundsMode: "visual",
    });
    expect(
      await sample(content.data, [
        [10, 10],
        [700, 400],
      ]),
    ).toEqual({
      width: 800,
      height: 500,
      pixels: [
        [255, 0, 0, 255],
        [255, 0, 0, 255],
      ],
    });
    const source = await renderSnapshot(invalid, {
      pageId: "home",
      revision: 0,
      nodeId: "source",
      captureMode: "isolated",
    });
    expect(source.text).toContain("Raw mask source");
    expect((await sample(source.data, [[50, 20]])).pixels[0][3]).toBe(255);
    expect(JSON.stringify(invalid)).toBe(saved);
  } finally {
    await browser.close();
  }
  expect(JSON.stringify(project)).toBe(original);
}, 60000);
