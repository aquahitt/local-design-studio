import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaintFields } from "./PaintFields";
import { StrokeFields } from "./StrokeFields";
import type { SceneMetadata } from "../core/scene";
vi.mock("./ImagePaintFields", () => ({
  ImagePaintFields: ({
    width,
    height,
    disabled,
  }: {
    width: number;
    height: number;
    disabled: boolean;
  }) => (
    <span
      data-width={width}
      data-height={height}
      data-disabled={String(disabled)}
    />
  ),
}));
const image = {
  id: "image",
  kind: "image" as const,
  asset: `assets/${"a".repeat(64)}.png`,
  mapping: { mode: "cover" as const, anchor: { x: 0.5, y: 0.5 } },
};
const scene: SceneMetadata = {
  kind: "frame",
  x: 0,
  y: 0,
  width: 0.5,
  height: 0.25,
  fills: [image],
};
it("passes exact positive fractional frame pixels into image mapping controls", () => {
  const html = renderToStaticMarkup(
    <PaintFields
      scene={scene}
      disabled={false}
      onChange={() => {}}
      onPendingChange={() => {}}
    />,
  );
  expect(html).toContain('data-width="0.5"');
  expect(html).toContain('data-height="0.25"');
  expect(html).toContain('data-disabled="false"');
});
it("uses exact outer stroke paint bounds for fractional image mapping", () => {
  const html = renderToStaticMarkup(
    <StrokeFields
      scene={{
        ...scene,
        strokes: [{ ...image, width: 0.1, alignment: "outside" }],
      }}
      disabled={false}
      onChange={() => {}}
      onPendingChange={() => {}}
    />,
  );
  expect(html).toContain('data-width="0.7"');
  expect(html).toContain('data-height="0.45"');
});
