import { expect, it } from "vitest";
import { transform } from "esbuild";
import { runInNewContext } from "node:vm";
import { createReactHandoff, layerStyle } from "./handoff";
import type { Project, ProjectNode } from "./project";
import { libraryMetadata } from "../library/sdk";
import { builtinLibrary } from "../library/builtin";

const asset = (hex: string) => `assets/${hex.repeat(64)}.svg`;
const frame = (id: string, hex: string, hidden = false, enabled = true): ProjectNode => ({
  id, type: "SceneFrame", props: {}, slots: {}, hidden,
  scene: { kind: "frame", x: 0, y: 0, width: 120, height: 80,
    fills: [{ id: "picture", kind: "image", asset: asset(hex), enabled, mapping: { mode: "cover", anchor: { x: .5, y: .5 } } }] },
});
const project = (): Project => ({ schemaVersion: 2, projectId: "image-handoff", name: "Image handoff", revision: 1,
  library: { id: "builtin", version: "1" }, tokens: {}, theme: "light",
  pages: [{ screenId: "home", name: "Home", viewport: { width: 390, height: 600 }, nodes: [
    frame("visible", "a"), frame("hidden", "b", true), frame("disabled", "c", false, false),
    { id: "instance", type: "SceneComponent", props: {}, slots: {}, instance: { definitionId: "picture" }, scene: { kind: "component", x: 140, y: 0, width: 120, height: 80 } },
  ] }],
  designComponents: [{ id: "picture", name: "Picture", version: 1, nodes: [frame("definition-image", "d")] }],
});
const metadata = [libraryMetadata(builtinLibrary)];

it("portable assets include hidden/disabled paints and materialized definition images", () => {
  const source = project(), before = JSON.stringify(source);
  const result = createReactHandoff(source, { pageId: "home", revision: 1 }, metadata);
  expect(result.assetPaths).toEqual(["a", "b", "c", "d"].map(asset));
  expect(result.files["Screen.tsx"]).toContain('"paintTree"');
  expect(result.files["Screen.tsx"]).toContain("definition-image");
  expect(result.files["Runtime.tsx"]).toContain("resolveImageAsset");
  expect(JSON.stringify(source)).toBe(before);
});

it("layered paint root keeps only outer effects while inset stroke belongs to the compiled tree", () => {
  const node = frame("inset", "a");
  Object.assign(node.scene!, { stroke: "#123456", strokeWidth: 9, shadows: [
    { id: "inside", kind: "inner", x: 0, y: 0, blur: 3, spread: 0, color: { r: 0, g: 0, b: 0, a: .5 } },
    { id: "outside", kind: "outer", x: 4, y: 5, blur: 6, spread: 0, color: { r: 0, g: 0, b: 0, a: .5 } },
  ] });
  const style = layerStyle(node);
  expect(style.boxShadow).not.toContain("inset");
  expect(style.boxShadow).toContain("4px 5px 6px");
  expect(style.border).toBeUndefined();
});

it("generated minified resource module is closed, loads only rendered refs and exposes settled status", async () => {
  const handoff = createReactHandoff(project(), { pageId: "home", revision: 1 }, metadata);
  const compiled = await transform(handoff.files["imageResources.ts"], { loader: "ts", format: "cjs", target: "es2022", minify: true });
  const sources: string[] = [];
  const document = { location: { href: "https://studio.test/app/index.html" }, createElement: () => ({
    naturalWidth: 300, naturalHeight: 150, onload: null, onerror: null,
    set src(value: string) { sources.push(value); }, decode: async () => {},
  }) };
  const module = { exports: {} as Record<string, any> };
  runInNewContext(compiled.code, { module, exports: module.exports, document, URL, setTimeout, clearTimeout,
    requestAnimationFrame: (done: () => void) => done() });
  const api = module.exports;
  expect(api.resolveImageAsset(asset("a"))).toBe("https://studio.test/app/" + asset("a"));
  const result = await api.waitForImageResources();
  expect(result.warnings).toEqual([]);
  expect(Object.keys(result.dimensions).sort()).toEqual([asset("a"), asset("d")]);
  expect(sources.sort()).toEqual(["a", "d"].map(hex => "https://studio.test/app/" + asset(hex)));
  expect(api.getImageResourceStatus().pending).toBe(false);
  await api.waitForImageResources();
  expect(sources).toHaveLength(2);
  expect(() => api.resolveImageAsset(asset("a"), "https://foreign.test/")).toThrow("IMAGE_RESOURCE_BASE_UNAVAILABLE");
});

it("a valid export above the image resource budget settles with explicit warnings", async () => {
  const source = project();
  source.designComponents = [];
  source.pages[0].nodes = Array.from({ length: 1001 }, (_, index) => {
    const node = frame(`many-${index}`, "a");
    const paint = node.scene!.fills![0];
    if (paint.kind === "image") paint.asset = `assets/${index.toString(16).padStart(64, "0")}.svg`;
    return node;
  });
  const handoff = createReactHandoff(source, { pageId: "home", revision: 1 }, metadata);
  const compiled = await transform(handoff.files["imageResources.ts"], { loader: "ts", format: "cjs", target: "es2022", minify: true });
  const module = { exports: {} as Record<string, any> };
  runInNewContext(compiled.code, { module, exports: module.exports, URL, setTimeout, clearTimeout,
    document: { location: { href: "https://studio.test/app/index.html" }, createElement: () => ({ naturalWidth: 200, naturalHeight: 100, decode: async () => {} }) },
    requestAnimationFrame: (done: () => void) => done() });
  const status = await module.exports.waitForImageResources();
  expect(status.warnings.length).toBeGreaterThan(0);
  expect(status.warnings.every((warning: { code: string }) => warning.code === "PROJECT_IMAGE_UNAVAILABLE")).toBe(true);
  expect(module.exports.getImageResourceStatus().pending).toBe(false);
});
