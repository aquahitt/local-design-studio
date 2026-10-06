import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { Project } from "../../src/core/project";
import { applyBatch } from "../../src/core/operations";
import { Nodes } from "../../src/studio/Preview";
import { builtinLibrary } from "../../src/library/builtin";

export interface SceneBenchmarkBridge {
  load(project: Project): Promise<number>;
  panZoom(): Promise<number>;
  drag(): Promise<number>;
  waitForText(): Promise<number>;
  revision(): number;
}
declare global {
  interface Window {
    sceneBenchmark: SceneBenchmarkBridge;
  }
}
const root = createRoot(document.getElementById("root")!);
let project: Project,
  camera = 0,
  request = 0,
  inputMeasurement: Promise<number> = Promise.resolve(0);
const painted = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
function draw() {
  flushSync(() =>
    root.render(
      createElement(
        "div",
        null,
        createElement("input", {
          id: "benchmark-text",
          "aria-label": "Benchmark text input",
          defaultValue: "",
          onInput: (event: React.FormEvent<HTMLInputElement>) => {
            const text = event.currentTarget.value;
            inputMeasurement = measure(async () => {
              project = applyBatch(project, {
                requestId: `text-${++request}`,
                baseRevision: project.revision,
                operations: [
                  {
                    type: "updateProps",
                    nodeId: "layer-00000",
                    props: { text },
                  },
                ],
              });
              draw();
            });
          },
        }),
        createElement(
          "div",
          {
            id: "benchmark-canvas",
            style: {
              position: "relative",
              width: 1280,
              height: 900,
              transformOrigin: "0 0",
              transform: `translate(${camera % 31}px,${camera % 17}px) scale(${camera % 2 ? 1.25 : 1})`,
            },
          },
          createElement(Nodes, {
            project,
            library: builtinLibrary,
            nodes: project.pages[0].nodes,
            selected: null,
            onSelect: () => {},
          }),
        ),
      ),
    ),
  );
}
async function measure(action: () => void | Promise<void>) {
  const start = performance.now();
  await action();
  await painted();
  return performance.now() - start;
}
window.sceneBenchmark = {
  async load(value) {
    return measure(() => {
      flushSync(() => root.render(null));
      project = value;
      camera = 0;
      draw();
    });
  },
  async panZoom() {
    return measure(() => {
      // Camera-only changes do not commit a document revision or rerender every layer.
      camera++;
      document.getElementById("benchmark-canvas")!.style.transform =
        `translate(${camera % 31}px,${camera % 17}px) scale(${camera % 2 ? 1.25 : 1})`;
    });
  },
  async drag() {
    return measure(() => {
      const x = project.pages[0].nodes[0].scene!.x + 5;
      project = applyBatch(project, {
        requestId: `drag-${++request}`,
        baseRevision: project.revision,
        operations: [
          { type: "setNodeMetadata", nodeId: "layer-00000", scene: { x } },
        ],
      });
      draw();
    });
  },
  waitForText: () => inputMeasurement,
  revision: () => project.revision,
};
