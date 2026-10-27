import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TransformFrame } from "../core/affine-geometry";
import { projectTransformHandles, TransformHandles } from "./TransformHandles";
const frame: TransformFrame = {
  pageId: "page",
  rootIds: ["a"],
  roots: [
    { id: "a", width: 100, height: 80, world: [1, 0.5, 0.25, 1, 10, 20] },
  ],
  bounds: { x: 10, y: 20, width: 120, height: 130 },
};
const view = { zoom: 2, panX: 5, panY: 7 };
it("projects all local quad handles through camera, keeping rotation offset in screen pixels", () => {
  const layout = projectTransformHandles(frame, view)!;
  expect(layout.outline).toEqual([
    { x: 25, y: 47 },
    { x: 225, y: 147 },
    { x: 265, y: 307 },
    { x: 65, y: 207 },
  ]);
  expect(
    Object.fromEntries(layout.handles.map((p) => [p.handle, p.point])),
  ).toEqual({
    nw: { x: 25, y: 47 },
    n: { x: 125, y: 97 },
    ne: { x: 225, y: 147 },
    e: { x: 245, y: 227 },
    se: { x: 265, y: 307 },
    s: { x: 165, y: 257 },
    sw: { x: 65, y: 207 },
    w: { x: 45, y: 127 },
  });
  expect(
    Math.hypot(
      layout.rotate.x - layout.rotationBase.x,
      layout.rotate.y - layout.rotationBase.y,
    ),
  ).toBeCloseTo(28);
});
it("uses world AABB for multiple independent roots, never a single child's local axes", () => {
  const layout = projectTransformHandles(
    {
      ...frame,
      roots: [frame.roots[0], { ...frame.roots[0], id: "b" }],
      rootIds: ["a", "b"],
    },
    view,
  )!;
  expect(layout.outline).toEqual([
    { x: 25, y: 47 },
    { x: 265, y: 47 },
    { x: 265, y: 307 },
    { x: 25, y: 307 },
  ]);
});
it("does not expose pointer handles when disabled; numeric controls remain the keyboard alternative", () => {
  const props = { frame, view, mode: "resize" as const, onStart: () => {} };
  expect(renderToStaticMarkup(<TransformHandles {...props} disabled />)).toBe(
    "",
  );
  const markup = renderToStaticMarkup(<TransformHandles {...props} />);
  expect(markup.match(/data-transform-handle=/g)).toHaveLength(9);
  expect(markup.match(/tabindex="-1"/g)).toHaveLength(9);
  expect(markup).toContain('aria-hidden="true"');
});
it("rejects nonfinite camera coordinates instead of exposing invalid DOM hit targets", () => {
  expect(
    projectTransformHandles(frame, { ...view, panX: Infinity }),
  ).toBeUndefined();
});
