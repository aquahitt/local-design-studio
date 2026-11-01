import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PngExport, validateRenderPng } from "./PngExport";
import { StudioClient } from "./client";
import type { Project } from "../core/project";
import type { RenderResult } from "../service/render";

const project: Project = {
  schemaVersion: 2,
  projectId: "project",
  name: "Example",
  revision: 3,
  library: { id: "studio", version: "1" },
  theme: "light",
  tokens: {},
  pages: [
    {
      screenId: "page",
      name: "Page",
      viewport: { width: 390 },
      nodes: [
        { id: "layer", name: "Layer", type: "Text", props: {}, slots: {} },
      ],
    },
  ],
};
const context = {
  projectId: "project",
  revision: 3,
  pageId: "page",
  nodeId: "layer",
  boundsMode: "visual" as const,
  captureMode: "isolated" as const,
};
function png(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return btoa(String.fromCharCode(...bytes));
}
function result(): RenderResult {
  return {
    mimeType: "image/png",
    data: png(101, 51),
    revision: 3,
    pageId: "page",
    nodeId: "layer",
    boundsMode: "visual",
    captureMode: "isolated",
    captureBounds: { x: -2, y: -3, width: 101, height: 51 },
    visualBounds: [
      { id: "layer", x: -1.9, y: -2.8, width: 100.2, height: 50.1 },
    ],
    visualBoundsStatus: "conservative",
    visualBoundsPolicy: "paint-envelope",
    bounds: [],
    warnings: [],
    text: "",
    viewport: { width: 390, height: 850 },
    theme: "light",
  };
}
it("starts with selected-layer visual export controls and no download before preparation", () => {
  const html = renderToStaticMarkup(
    <PngExport
      client={new StudioClient("", "")}
      project={project}
      page={project.pages[0]}
      nodeId="layer"
    />,
  );
  expect(html).toContain('aria-label="Состав PNG"');
  expect(html).toContain('aria-label="Границы PNG"');
  expect(html).toContain("Отдельный слой");
  expect(html).toContain("Всё оформление");
  expect(html).toContain("Подготовить PNG");
  expect(html).not.toContain("Скачать PNG");
  if (!__STUDIO_DEMO__)
    expect(html).not.toMatch(/disabled=""[^>]*>Подготовить PNG/);
});
it("requires selection and confirmed document state before making a request", () => {
  for (const [nodeId, disabled, copy] of [
    [null, false, "Выбери слой для экспорта PNG."],
    ["layer", true, "Сначала примени или сбрось изменения слоя."],
  ] as const) {
    const html = renderToStaticMarkup(
      <PngExport
        client={new StudioClient("", "")}
        project={project}
        page={project.pages[0]}
        nodeId={nodeId}
        disabled={disabled}
      />,
    );
    expect(html).toContain(copy);
    expect(html).toMatch(/disabled=""[^>]*>Подготовить PNG/);
  }
});
it("accepts integer raster geometry with fractional visual bounds", () => {
  expect(validateRenderPng(result(), context)).toMatchObject({
    width: 101,
    height: 51,
  });
});
it("rejects stale, incompatible and missing capture metadata rather than offering a fake PNG", () => {
  for (const changed of [
    { mimeType: "image/svg+xml" },
    { revision: 2 },
    { pageId: "other" },
    { nodeId: "other" },
    { captureMode: "scene" },
    { boundsMode: "layout" },
    { captureBounds: undefined },
    { visualBoundsStatus: undefined },
    { visualBoundsPolicy: undefined },
    { captureBounds: { x: 0, y: 0, width: NaN, height: 2 } },
    { data: btoa("not a PNG") },
    { data: "http://example.com/file.png" },
    { data: png(8193, 1) },
    { data: png(8192, 8192) },
    { data: png(0, 1) },
  ])
    expect(() =>
      validateRenderPng({ ...result(), ...changed } as RenderResult, context),
    ).toThrow();
});

it.runIf(__STUDIO_DEMO__)(
  "keeps the file-service PNG API disabled in the browser demo",
  () => {
    const html = renderToStaticMarkup(
      <PngExport
        client={new StudioClient("", "")}
        project={project}
        page={project.pages[0]}
        nodeId="layer"
      />,
    );
    expect(html).toContain("Экспорт PNG доступен в локальной студии.");
    expect(html).toMatch(/disabled=""[^>]*>Подготовить PNG/);
  },
);

it("rejects raster geometry that disagrees with capture bounds", () => {
  for (const captureBounds of [
    { x: 0, y: 0, width: 100, height: 51 },
    { x: 0, y: 0, width: 101, height: 50 },
    { x: 0, y: 0, width: 100.2, height: 50.1 },
  ]) {
    expect(() =>
      validateRenderPng({ ...result(), captureBounds }, context),
    ).toThrow("PNG_EXPORT_INVALID_RESULT");
  }
});

it("requires valid visual bounds for exactly the selected node", () => {
  for (const visualBounds of [
    [],
    [{ id: "other", x: 0, y: 0, width: 101, height: 51 }],
    [{ id: "layer", x: 0, y: 0, width: NaN, height: 51 }],
    [{ id: "layer", x: 0, y: 0, width: 101, height: -1 }],
    [
      { id: "layer", x: 0, y: 0, width: 101, height: 51 },
      { id: "layer", x: 0, y: 0, width: 101, height: 51 },
    ],
  ]) {
    expect(() =>
      validateRenderPng({ ...result(), visualBounds }, context),
    ).toThrow("PNG_EXPORT_INVALID_RESULT");
  }
});
