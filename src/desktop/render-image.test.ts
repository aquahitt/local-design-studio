import { expect, it, vi } from "vitest";
import type { Project } from "../core/project";
const native = vi.hoisted(() => ({ createWindow: undefined as undefined | (() => object) }));
vi.mock("electron", () => ({ BrowserWindow: class { constructor() { return native.createWindow!(); } }, nativeImage: {} }));
import { captureDesktopSnapshot } from "../../desktop/render";

it("a settled missing native image fails before bounds/PNG and destroys only the disposable window", async () => {
  const asset = "assets/" + "a".repeat(64) + ".svg";
  const project: Project = { schemaVersion: 2, projectId: "missing-native-image", name: "Missing image", revision: 3,
    theme: "light", library: { id: "builtin", version: "1" }, tokens: {},
    pages: [{ screenId: "home", name: "Home", viewport: { width: 390, height: 600 }, nodes: [{
      id: "frame", type: "SceneFrame", props: {}, slots: {}, scene: { kind: "frame", x: 0, y: 0, width: 120, height: 80,
        fills: [{ id: "picture", kind: "image", asset, mapping: { mode: "cover", anchor: { x: .5, y: .5 } } }] },
    }] }],
  };
  const before = JSON.stringify(project), capturePage = vi.fn(), destroy = vi.fn();
  native.createWindow = () => ({ loadURL: async () => {}, destroy, webContents: {
    setWindowOpenHandler: vi.fn(), on: vi.fn(), capturePage,
    executeJavaScript: async (source: string) => {
      if (source.includes("const listening")) return { listening: true, revision: "3" };
      if (source.includes("studioPreviewImageWarnings")) return [{ code: "PROJECT_IMAGE_UNAVAILABLE", asset }];
      throw new Error("Unexpected work after failed image readiness");
    },
  } });
  await expect(captureDesktopSnapshot(project, { pageId: "home", revision: 3 })).rejects.toMatchObject({ code: "IMAGE_RESOURCE_UNAVAILABLE" });
  expect(capturePage).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalledOnce();
  expect(JSON.stringify(project)).toBe(before);
});
