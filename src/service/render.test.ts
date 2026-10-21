import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { renderSnapshot, prepareRenderSnapshot } from "./render";
import { applyBatch } from "../core/operations";
import type { Project } from "../core/project";
const project: Project = {
  schemaVersion: 2,
  projectId: "render-test",
  name: "Render test",
  revision: 7,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 1280, height: 600 },
      nodes: [
        {
          id: "text",
          type: "Text",
          props: { text: "Screenshot text at the selected revision" },
          slots: {},
        },
      ],
    },
  ],
};
it("rendering rejects stale revisions, missing pages, unsafe widths and unknown selection before browser work", () => {
  expect(() =>
    prepareRenderSnapshot(project, { revision: 6, pageId: "home" }),
  ).toThrow("REVISION_CONFLICT");
  expect(() =>
    prepareRenderSnapshot(project, { revision: 7, pageId: "missing" }),
  ).toThrow("PAGE_NOT_FOUND");
  expect(() =>
    prepareRenderSnapshot(project, {
      revision: 7,
      pageId: "home",
      nodeId: "missing",
    }),
  ).toThrow("NODE_NOT_FOUND");
  expect(() =>
    prepareRenderSnapshot(project, {
      revision: 7,
      pageId: "home",
      viewport: { width: 1 },
    }),
  ).toThrow("INVALID_VIEWPORT");
});
it("actual browser screenshots use the preview renderer at 390 and 1280 widths with revision and bounds", async () => {
  const before = JSON.stringify(project);
  const edited = applyBatch(project, {
    requestId: "agent-text-screenshot",
    baseRevision: 7,
    operations: [
      {
        type: "updateProps",
        nodeId: "text",
        props: {
          text: "Screenshot text at the selected revision. The agent replaced a short label with a longer explanation to verify real text wrapping on narrow mobile screens and wide desktop screens before approving a visual change.",
        },
      },
    ],
  });
  const heights: number[] = [];
  for (const width of [390, 1280]) {
    const rendered = await renderSnapshot(edited, {
      revision: 8,
      pageId: "home",
      viewport: { width, height: 600 },
    });
    expect(rendered.revision).toBe(8);
    expect(rendered.viewport.width).toBe(width);
    expect(rendered.mimeType).toBe("image/png");
    const bytes = Buffer.from(rendered.data, "base64");
    await writeFile(join(tmpdir(), `studio-alpha3-render-${width}.png`), bytes);
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(width);
    expect(bytes.readUInt32BE(20)).toBe(600);
    expect(rendered.bounds).toMatchObject([{ id: "text" }]);
    expect(rendered.bounds[0].width).toBeLessThanOrEqual(width);
    expect(rendered.bounds[0].height).toBeGreaterThan(10);
    heights.push(rendered.bounds[0].height);
    expect(rendered.warnings).toEqual([]);
    // The real preview wraps the real component; actual rendered text is recorded for accessibility and QA.
    expect(rendered.text).toContain("Screenshot text at the selected revision");
  }
  expect(heights[0]).toBeGreaterThan(heights[1]);
  expect(JSON.stringify(project)).toBe(before);
  expect(edited.revision).toBe(8);
}, 60000);

it("captures an operator-enabled external component and node crop using its real theme", async () => {
  const external = {
    ...project,
    library: { id: "external-example", version: "1.0.0" },
    theme: "dark",
    pages: [
      {
        ...project.pages[0],
        nodes: [
          {
            id: "notice",
            type: "Notice",
            props: { message: "Operator library screenshot", tone: "warning" },
            slots: {},
          },
        ],
      },
    ],
  };
  const result = await renderSnapshot(
    external,
    {
      revision: 7,
      pageId: "home",
      nodeId: "notice",
      viewport: { width: 390, height: 600 },
    },
    {
      externalRoot: join(process.cwd(), "examples/library/external"),
    },
  );
  expect(result.nodeId).toBe("notice");
  expect(result.theme).toBe("dark");
  expect(result.text).toContain("Operator library screenshot");
  expect(result.text).toContain("Warning");
  const bytes = Buffer.from(result.data, "base64");
  expect(bytes.readUInt32BE(16)).toBe(Math.ceil(result.bounds[0].width));
  expect(bytes.readUInt32BE(20)).toBe(Math.ceil(result.bounds[0].height));
  expect(result.warnings).toEqual([]);
  await writeFile(
    join(tmpdir(), "studio-alpha3-render-external-node.png"),
    bytes,
  );
}, 60000);

it("captures negative and far scene nodes with original bounds and unchanged viewport", async () => {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const decoder = await browser.newPage();
    for (const [x, y] of [
      [-550.25, -400.5],
      [6000.25, 7000.5],
    ]) {
      const sceneProject: Project = {
        ...project,
        pages: [
          {
            ...project.pages[0],
            nodes: [
              {
                id: "remote",
                type: "SceneFrame",
                props: {},
                slots: {},
                scene: {
                  kind: "frame",
                  x,
                  y,
                  width: 80.5,
                  height: 60.25,
                  fill: "#ff0000",
                },
              },
            ],
          },
        ],
      };
      const before = JSON.stringify(sceneProject);
      const rendered = await renderSnapshot(sceneProject, {
        pageId: "home",
        revision: 7,
        nodeId: "remote",
        viewport: { width: 390, height: 600 },
      });
      const bound = rendered.bounds.find((row) => row.id === "remote")!;
      expect(bound.x).toBeCloseTo(x + 20);
      expect(bound.y).toBeCloseTo(y + 20);
      expect(rendered.viewport).toEqual({ width: 390, height: 600 });
      const pixels = await decoder.evaluate(async (data) => {
        const image = new Image();
        image.src = "data:image/png;base64," + data;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
          center: Array.from(context.getImageData(40, 30, 1, 1).data),
        };
      }, rendered.data);
      expect(pixels).toEqual({
        width: 81,
        height: 61,
        center: [255, 0, 0, 255],
      });
      expect(JSON.stringify(sceneProject)).toBe(before);
    }
  } finally {
    await browser.close();
  }
}, 60000);

it("preserves rotated bounds and ancestor clipping in remote crops and rejects oversized rasters", async () => {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const nodes: Project["pages"][number]["nodes"] = [
    {
      id: "rotated",
      type: "SceneFrame",
      props: {},
      slots: {},
      scene: {
        kind: "frame",
        x: -2000.25,
        y: 3000.5,
        width: 80,
        height: 60,
        rotation: 30,
        fill: "#ff0000",
      },
    },
    {
      id: "clip-parent",
      type: "SceneFrame",
      props: {},
      scene: {
        kind: "frame",
        x: 5000,
        y: -3000,
        width: 100,
        height: 100,
        clip: true,
      },
      slots: {
        content: [
          {
            id: "clip-child",
            type: "SceneFrame",
            props: {},
            slots: {},
            scene: {
              kind: "frame",
              x: -20,
              y: 20,
              width: 100,
              height: 60,
              fill: "#ff0000",
            },
          },
        ],
      },
    },
    {
      id: "too-large",
      type: "SceneFrame",
      props: {},
      slots: {},
      scene: { kind: "frame", x: 20000, y: 20000, width: 5000, height: 5000 },
    },
  ];
  const input: Project = {
    ...project,
    pages: [{ ...project.pages[0], nodes }],
  };
  const before = JSON.stringify(input);
  try {
    const decoder = await browser.newPage();
    for (const nodeId of ["rotated", "clip-child"]) {
      const rendered = await renderSnapshot(input, {
        pageId: "home",
        revision: 7,
        nodeId,
        viewport: { width: 390, height: 600 },
      });
      const bound = rendered.bounds.find((row) => row.id === nodeId)!;
      const pixels = await decoder.evaluate(async (data) => {
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
          center: Array.from(
            ctx.getImageData(
              Math.floor(image.naturalWidth / 2),
              Math.floor(image.naturalHeight / 2),
              1,
              1,
            ).data,
          ),
          left: Array.from(ctx.getImageData(5, 30, 1, 1).data),
        };
      }, rendered.data);
      expect(pixels.width).toBe(Math.ceil(bound.width));
      expect(pixels.height).toBe(Math.ceil(bound.height));
      expect(pixels.center).toEqual([255, 0, 0, 255]);
      if (nodeId === "clip-child")
        expect(pixels.left).toEqual([255, 255, 255, 255]);
      else {
        expect(bound.width).toBeCloseTo(
          80 * Math.cos(Math.PI / 6) + 60 * 0.5,
          1,
        );
        expect(bound.x).toBeLessThan(-1900);
      }
    }
    await expect(
      renderSnapshot(input, {
        pageId: "home",
        revision: 7,
        nodeId: "too-large",
      }),
    ).rejects.toThrow("RENDER_RASTER_LIMIT");
    expect(JSON.stringify(input)).toBe(before);
  } finally {
    await browser.close();
  }
}, 60000);
