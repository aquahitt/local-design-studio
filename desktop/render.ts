import {
  captureRectangle,
  validatePhysicalCapture,
  translateCaptureExpression,
  settleCaptureExpression,
  withCaptureTimeout,
} from "../src/service/capture";
import { computedStylesExpression } from "../src/service/computed-styles";
import { BrowserWindow, nativeImage } from "electron";
import type { Project } from "../src/core/project";
import {
  prepareRenderSnapshot,
  type RenderOptions,
  type RenderResult,
} from "../src/service/render";
import type { DesktopLibrary } from "../src/desktop/types";

/** Isolated Chromium capture uses the same preview bundle as the editor, with no preload. */
export async function captureDesktopSnapshot(
  project: Project,
  options: RenderOptions,
  desktopLibrary?: DesktopLibrary,
): Promise<RenderResult> {
  const input = prepareRenderSnapshot(project, options);
  const started = Date.now();
  let stage = "create-window";
  const mark = (next: string) => {
    stage = next;
    if (process.env.STUDIO_CAPTURE_DIAGNOSTICS === "1") {
      const diagnostic = { stage, elapsedMs: Date.now() - started };
      const state = globalThis as typeof globalThis & {
        __studioCaptureDiagnostics?: (typeof diagnostic)[];
      };
      state.__studioCaptureDiagnostics = [
        ...(state.__studioCaptureDiagnostics ?? []),
        diagnostic,
      ].slice(-64);
      console.error("Studio capture stage", diagnostic);
    }
  };
  const window = new BrowserWindow({
    show: false,
    width: input.viewport.width,
    height: input.viewport.height,
    useContentSize: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  try {
    mark("load-preview");
    await window.loadURL("studio://preview/preview");
    const payload = JSON.stringify({
      type: "studio-preview-render",
      project: input.project,
      library: input.project.library,
      theme: input.theme,
      nodes: input.page.nodes,
      desktopLibrary,
    });
    const deadline = Date.now() + 15000;
    // Wait for React's listener, then deliver once. Repeated delivery creates a
    // new input object and cancels PreviewApp's pending frame readiness signal.
    mark("preview-readiness");
    let delivered = false;
    while (true) {
      const state = (await window.webContents.executeJavaScript(
        `(() => { const listening = document.documentElement.dataset.studioPreviewListening === 'true'; if (listening && !${JSON.stringify(delivered)}) window.dispatchEvent(new MessageEvent('message', { origin: 'studio://app', source: window, data: ${payload} })); return { listening, revision: document.documentElement.dataset.studioPreviewRevision }; })()`,
      )) as { listening: boolean; revision?: string };
      delivered ||= state.listening;
      if (delivered && state.revision === String(project.revision)) break;
      if (Date.now() > deadline) {
        // No project text, props, paths or credentials enter the diagnostic.
        console.error("Desktop snapshot readiness timed out", {
          stage: delivered ? "preview-render" : "preview-listener",
          receivedRevision: state.revision ?? null,
          expectedRevision: project.revision,
        });
        throw new Error("RENDER_TIMEOUT");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    mark("settle-animation");
    await withCaptureTimeout(
      window.webContents.executeJavaScript(settleCaptureExpression),
    );
    mark("measure-bounds");
    const result = await window.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { bounds: [...document.querySelectorAll('[data-node-id]')].map(node => { const box = node.getBoundingClientRect(); return {id: node.getAttribute('data-node-id'), x: box.x, y: box.y, width: box.width, height: box.height}; }), text: document.body.innerText.slice(0, 10000), warnings: [...document.querySelectorAll('.render-error')].map(node => node.textContent) };
    })()`);
    mark("computed-styles");
    const computedStyles = await window.webContents.executeJavaScript(
      computedStylesExpression,
    );
    const bounds = result.bounds as RenderResult["bounds"];
    const bound = input.nodeId
      ? bounds.find((row) => row.id === input.nodeId)
      : undefined;
    if (input.nodeId && (!bound || bound.width <= 0 || bound.height <= 0))
      throw new Error("NODE_NOT_VISIBLE");
    let png: Buffer;
    if (bound) {
      const rectangle = captureRectangle(bound);
      mark("translate-node");
      const pixelRatio = await withCaptureTimeout(
        window.webContents.executeJavaScript(translateCaptureExpression(bound)),
      );
      validatePhysicalCapture(rectangle, pixelRatio);
      window.webContents.debugger.attach("1.3");
      try {
        mark("cdp-screenshot");
        // Electron's native capturer makes a hidden page paint without showing
        // its BrowserWindow. CDP alone can wait forever for that frame on Linux
        // and Windows. Prime only one pixel while the CDP request is pending;
        // keep the original viewport and discard the native warm-up image.
        const [capture] = await withCaptureTimeout(
          Promise.all([
            window.webContents.debugger.sendCommand("Page.captureScreenshot", {
              format: "png",
              fromSurface: true,
              captureBeyondViewport: true,
              clip: rectangle,
            }),
            Promise.resolve().then(async () => {
              mark("native-prime");
              const image = await window.webContents.capturePage({x:0,y:0,width:1,height:1});
              mark("cdp-after-prime");
              return image;
            }),
          ]),
        );
        // Keep native DPR during CDP capture: fractional CDP scaling can drop ICC metadata.
        // Normalize the native PNG to the documented CSS-pixel dimensions afterwards.
        png = nativeImage
          .createFromBuffer(Buffer.from(capture.data, "base64"), {
            scaleFactor: 1,
          })
          .resize({
            width: rectangle.width,
            height: rectangle.height,
            quality: "best",
          })
          .toPNG({ scaleFactor: 1 });
      } finally {
        window.webContents.debugger.detach();
      }
    } else {
      captureRectangle({ x: 0, y: 0, ...input.viewport });
      validatePhysicalCapture(
        input.viewport,
        await withCaptureTimeout(
          window.webContents.executeJavaScript("window.devicePixelRatio"),
        ),
      );
      mark("native-page-screenshot");
      const image = await window.webContents.capturePage();
      // Page capture follows display scale. Normalize its single representation to CSS pixels.
      png = nativeImage
        .createFromBuffer(image.toPNG(), { scaleFactor: 1 })
        .resize({
          width: input.viewport.width,
          height: input.viewport.height,
          quality: "best",
        })
        .toPNG({ scaleFactor: 1 });
    }
    mark("complete");
    return {
      mimeType: "image/png",
      data: png.toString("base64"),
      revision: project.revision,
      pageId: input.page.screenId,
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      viewport: input.viewport,
      theme: input.theme,
      bounds,
      computedStyles,
      text: result.text,
      warnings: result.warnings,
    };
  } catch (error) {
    console.error("Studio capture failed", {
      stage,
      elapsedMs: Date.now() - started,
      code:
        error instanceof Error && "code" in error
          ? String(error.code)
          : "RENDER_FAILED",
    });
    throw error;
  } finally {
    window.destroy();
  }
}
