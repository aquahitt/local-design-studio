import { it, expect } from "vitest";
import { parseProject } from "./project";
import { applyBatch } from "./operations";
const project = (viewport: unknown = { width: 390 }) =>
  parseProject({
    schemaVersion: 2,
    projectId: "viewport-test",
    name: "Viewport",
    revision: 0,
    library: { id: "builtin", version: "1" },
    theme: "light",
    tokens: {},
    pages: [{ screenId: "home", name: "Home", viewport, nodes: [] }],
  });
const device = {
  preset: "phone-pill",
  orientation: "portrait",
  cutout: "pill",
  safeArea: { top: 54, right: 0, bottom: 34, left: 0 },
};
it("preserves legacy width-only projects and roundtrips device geometry", () => {
  expect(project().pages[0].viewport).toEqual({ width: 390 });
  expect(
    project({ width: 390, height: 844, device }).pages[0].viewport,
  ).toEqual({ width: 390, height: 844, device });
});
it("updates height and device atomically without mutating the source", () => {
  const before = project();
  const after = applyBatch(before, {
    requestId: "device",
    baseRevision: 0,
    operations: [
      {
        type: "setViewport",
        pageId: "home",
        width: 390,
        height: 844,
        device,
      } as any,
    ],
  });
  expect(after.pages[0].viewport).toEqual({ width: 390, height: 844, device });
  expect(before.pages[0].viewport).toEqual({ width: 390 });
  const custom = applyBatch(after, {
    requestId: "custom",
    baseRevision: 1,
    operations: [
      {
        type: "setViewport",
        pageId: "home",
        width: 720,
        height: 900,
        device: null,
      } as any,
    ],
  });
  expect(custom.pages[0].viewport).toEqual({ width: 720, height: 900 });
});
it("rejects invalid dimensions, unsafe areas and unknown device fields", () => {
  for (const viewport of [
    {
      width: 390,
      height: 844,
      device: { ...device, orientation: ["portrait"] },
    },
    { width: 390, height: 844, device: { ...device, cutout: ["pill"] } },
    { width: 390, height: 0 },
    {
      width: 390,
      height: 844,
      device: { ...device, safeArea: { ...device.safeArea, top: 900 } },
    },
    { width: 390, height: 844, device: { ...device, cutout: "unknown" } },
    { width: 390, height: 844, device: { ...device, unsafe: true } },
    { width: 390, device },
  ])
    expect(() => project(viewport)).toThrow();
});
