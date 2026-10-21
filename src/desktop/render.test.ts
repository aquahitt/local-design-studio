import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import type { Project } from "../core/project";

const state = vi.hoisted(() => ({
  createWindow: undefined as undefined | (() => object),
}));
vi.mock("electron", () => ({
  BrowserWindow: class {
    constructor() {
      return state.createWindow!();
    }
  },
  nativeImage: {
    createFromBuffer: () => ({
      resize: () => ({ toPNG: () => Buffer.from("png") }),
    }),
  },
}));
import { captureDesktopSnapshot } from "../../desktop/render";

const project: Project = {
  schemaVersion: 2,
  projectId: "slow-preview",
  name: "Slow preview",
  revision: 7,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 390, height: 600 },
      nodes: [],
    },
  ],
};
afterEach(() => vi.useRealTimers());

it("delivers a snapshot once after listener installation, allowing slow preview frames to settle", async () => {
  vi.useFakeTimers();
  const dataset: Record<string, string> = {};
  const delivered: unknown[] = [];
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  const destroy = vi.fn();
  state.createWindow = () => ({
    loadURL: async () => {
      setTimeout(() => {
        dataset.studioPreviewListening = "true";
      }, 50);
    },
    destroy,
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      capturePage: async () => ({ toPNG: () => Buffer.from("png") }),
      executeJavaScript: async (source: string) =>
        runInNewContext(source, {
          document: {
            documentElement: { dataset },
            fonts: { ready: Promise.resolve() },
            getAnimations: () => [],
            body: { innerText: "Slow preview" },
            querySelectorAll: () => [],
          },
          MessageEvent: class {
            type: string;
            data: any;
            constructor(type: string, options: { data: any }) {
              this.type = type;
              this.data = options.data;
            }
          },
          window: {
            devicePixelRatio: 2,
            dispatchEvent: (event: { data: { project: Project } }) => {
              if (!dataset.studioPreviewListening) return;
              delivered.push(event.data);
              // PreviewApp invalidates readiness on each new input object. Frames on a
              // busy/hidden Chromium window may take longer than the old 100ms resend.
              delete dataset.studioPreviewRevision;
              clearTimeout(renderTimer);
              renderTimer = setTimeout(() => {
                dataset.studioPreviewRevision = String(
                  event.data.project.revision,
                );
              }, 250);
            },
          },
          requestAnimationFrame: (callback: () => void) =>
            setTimeout(callback, 1),
        }),
    },
  });
  const capture = captureDesktopSnapshot(project, {
    pageId: "home",
    revision: 7,
  });
  const outcome = capture.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await vi.runAllTimersAsync();
  expect(await outcome).toMatchObject({
    value: { revision: 7, text: "Slow preview" },
  });
  expect(delivered).toHaveLength(1);
  expect(destroy).toHaveBeenCalledOnce();
});

it("primes the hidden native compositor while a node CDP capture waits for a frame", async () => {
  vi.useFakeTimers();
  let complete: undefined | (() => void);
  const prime = vi.fn(async () => {
      complete?.();
      return { toPNG: () => Buffer.from("warmup") };
    }),
    detach = vi.fn(),
    destroy = vi.fn();
  state.createWindow = () => ({
    destroy,
    loadURL: async () => {},
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      capturePage: prime,
      debugger: {
        attach: vi.fn(),
        detach,
        sendCommand: vi.fn(
          () =>
            new Promise((resolve) => {
              complete = () =>
                resolve({ data: Buffer.from("native png").toString("base64") });
            }),
        ),
      },
      executeJavaScript: async (source: string) => {
        if (source.includes("const listening"))
          return { listening: true, revision: "7" };
        if (source.includes("bounds: [..."))
          return {
            bounds: [{ id: "node", x: -100, y: -50, width: 80, height: 60 }],
            warnings: [],
            text: "Node",
          };
        if (source.includes("body.style.translate")) return 2;
        return [];
      },
    },
  });
  const p = {
    ...project,
    pages: [
      {
        ...project.pages[0],
        nodes: [
          {
            id: "node",
            type: "SceneFrame",
            props: {},
            slots: {},
            scene: {
              kind: "frame" as const,
              x: -100,
              y: -50,
              width: 80,
              height: 60,
            },
          },
        ],
      },
    ],
  };
  const outcome = captureDesktopSnapshot(p, {
    pageId: "home",
    revision: 7,
    nodeId: "node",
  }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await vi.runAllTimersAsync();
  expect(await outcome).toMatchObject({
    value: { revision: 7, nodeId: "node" },
  });
  expect(prime).toHaveBeenCalledExactlyOnceWith({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  expect(detach).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
});
