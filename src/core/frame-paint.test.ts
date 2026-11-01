import { expect, it } from "vitest";
import { compileFrameDecorationTree } from "./frame-paint";
import type { FramePaintTree } from "./image-paint";
import type { SceneMetadata } from "./scene";
const scene: SceneMetadata = {
  kind: "frame",
  x: 10,
  y: 20,
  width: 100,
  height: 80,
};
function all(tree: FramePaintTree | undefined): FramePaintTree[] {
  return tree ? [tree, ...tree.children.flatMap(all)] : [];
}
it("marks only contributing stroke envelopes with their stable owner", () => {
  const tree = compileFrameDecorationTree("frame", {
    ...scene,
    strokes: [
      {
        id: "ink",
        kind: "solid",
        color: { r: 0, g: 0, b: 0, a: 1 },
        width: 10,
        alignment: "outside",
      },
      {
        id: "transparent",
        kind: "solid",
        color: { r: 0, g: 0, b: 0, a: 0 },
        width: 100,
        alignment: "outside",
      },
    ],
  });
  const markers = all(tree).filter(
    (node) => node.props["data-studio-paint-envelope"],
  );
  expect(markers).toHaveLength(1);
  expect(markers[0].props["data-studio-paint-envelope"]).toBe("frame");
  expect(markers[0].props.style).toMatchObject({
    left: -10,
    top: -10,
    width: 120,
    height: 100,
  });
});
it("publishes a clipped invisible shadow measurement envelope without a document layer", () => {
  const tree = compileFrameDecorationTree("shadow", {
    ...scene,
    shadows: [
      {
        id: "shadow",
        kind: "outer",
        x: 12,
        y: -5,
        blur: 4,
        spread: 2,
        color: { r: 0, g: 0, b: 0, a: 0.5 },
      },
    ],
  });
  const nodes = all(tree),
    marker = nodes.find(
      (node) => node.props["data-studio-paint-envelope"] === "shadow",
    );
  expect(marker?.props.style).toMatchObject({
    left: -4,
    top: -21,
    width: 132,
    height: 112,
    visibility: "hidden",
  });
  expect(marker?.props["data-studio-envelope-policy"]).toBe(
    "css-raster-envelope-6sigma-plus-2px",
  );
  const clip = nodes.find((node) => node.props["data-studio-metadata-clip"]);
  expect(clip?.props.style).toMatchObject({
    width: 0,
    height: 0,
    overflow: "clip",
    pointerEvents: "none",
  });
  expect(nodes.every((node) => node.props["data-node-id"] === undefined)).toBe(
    true,
  );
});
it("adds no measurement nodes to a legacy paintless frame", () => {
  expect(compileFrameDecorationTree("frame", scene)).toBeUndefined();
});
