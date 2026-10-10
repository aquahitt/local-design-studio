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
    const result = await window.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { bounds: [...document.querySelectorAll('[data-node-id]')].map(node => { const box = node.getBoundingClientRect(); return {id: node.getAttribute('data-node-id'), x: box.x, y: box.y, width: box.width, height: box.height}; }), text: document.body.innerText.slice(0, 10000), warnings: [...document.querySelectorAll('.render-error')].map(node => node.textContent) };
    })()`);
    const computedStyles = await window.webContents.executeJavaScript(
      computedStylesExpression,
    );
    const bounds = result.bounds as RenderResult["bounds"];
    const bound = input.nodeId
      ? bounds.find((row) => row.id === input.nodeId)
      : undefined;
    if (input.nodeId && (!bound || bound.width <= 0 || bound.height <= 0))
      throw new Error("NODE_NOT_VISIBLE");
    const rectangle = bound
      ? {
          x: Math.max(0, Math.floor(bound.x)),
          y: Math.max(0, Math.floor(bound.y)),
          width: Math.ceil(bound.width),
          height: Math.ceil(bound.height),
        }
      : undefined;
    const image = await window.webContents.capturePage(rectangle);
    // capturePage follows the display scale (for example, Retina 2x). Recreate a
    // single 1x representation before resizing so PNG pixels match CSS coordinates.
    const png = nativeImage
      .createFromBuffer(image.toPNG(), { scaleFactor: 1 })
      .resize({
        width: rectangle?.width ?? input.viewport.width,
        height: rectangle?.height ?? input.viewport.height,
        quality: "best",
      })
      .toPNG({ scaleFactor: 1 });
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
  } finally {
    window.destroy();
  }
}
