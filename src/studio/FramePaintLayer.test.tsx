import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FramePaintLayer } from "./FramePaintLayer";
import type { SceneMetadata } from "../core/scene";
const asset = `assets/${"a".repeat(64)}.png`;
const scene = {
  kind: "frame",
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  fills: [
    {
      id: "photo",
      kind: "image",
      asset,
      mapping: { mode: "crop", imageToFrame: [100, 0, 0, 80, 0, 0] },
    },
  ],
} as unknown as SceneMetadata;
it("adapts the shared tree into inert decoration without selection surfaces", () => {
  const html = renderToStaticMarkup(
    <FramePaintLayer nodeId="frame" scene={scene} />,
  );
  expect(html).toContain(asset);
  expect(html).toContain("pointer-events:none");
  expect(html).not.toContain("data-node-id");
  expect(html).not.toContain("data-selection-id");
  expect(html).toContain('aria-hidden="true"');
});
it("adds no DOM for the legacy CSS-only path", () => {
  expect(
    renderToStaticMarkup(
      <FramePaintLayer
        nodeId="frame"
        scene={{
          ...scene,
          fills: [
            {
              id: "flat",
              kind: "solid",
              color: { r: 255, g: 255, b: 255, a: 1 },
            },
          ],
        }}
      />,
    ),
  ).toBe("");
});
