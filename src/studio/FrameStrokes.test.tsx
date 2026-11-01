import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FramePaintLayer } from "./FramePaintLayer";
import { layerStyle } from "../core/handoff";
import { collectImagePaintReferences } from "../core/image-paint";
import type { ProjectNode } from "../core/project";

const node: ProjectNode = {
  id: "frame",
  type: "SceneFrame",
  props: {},
  slots: { content: [] },
  scene: {
    kind: "frame",
    x: 20,
    y: 30,
    width: 100,
    height: 80,
    clip: true,
    stroke: "red",
    strokeWidth: 10,
    strokes: [
      {
        id: "edge",
        kind: "solid",
        color: { r: 0, g: 0, b: 255, a: 1 },
        width: 12,
        alignment: "outside",
      },
    ],
  },
};
it("adapts stroke decorations without turning them into document layers", () => {
  const html = renderToStaticMarkup(
    <FramePaintLayer nodeId={node.id} scene={node.scene!} />,
  );
  expect(html).toContain("clipPath");
  expect(html).toContain("evenodd");
  expect(html).not.toContain("data-node-id");
  expect(html).toContain("aria-hidden");
});
it("keeps own decoration unclipped and suppresses legacy while preserving child origin", () => {
  const style = layerStyle(node);
  expect(style.overflow).toBe("visible");
  expect(style.boxShadow).toBeUndefined();
  expect(style).toMatchObject({
    left: 20,
    top: 30,
    width: 100,
    height: 80,
    padding: 0,
    isolation: "isolate",
  });
});
it("tracks image resources across independent fill and stroke ID spaces", () => {
  const image = {
    id: "same",
    kind: "image" as const,
    asset: `assets/${"a".repeat(64)}.png`,
    mapping: { mode: "cover" as const, anchor: { x: 0.5, y: 0.5 } },
  };
  const source = {
    ...node,
    scene: {
      ...node.scene!,
      fills: [image],
      strokes: [
        {
          ...image,
          asset: `assets/${"b".repeat(64)}.png`,
          width: 4,
          alignment: "inside" as const,
        },
      ],
    },
  };
  expect(collectImagePaintReferences([source]).map((ref) => ref.asset)).toEqual(
    [image.asset, source.scene.strokes[0].asset],
  );
  expect(
    collectImagePaintReferences([
      {
        ...source,
        scene: {
          ...source.scene,
          strokes: [{ ...source.scene.strokes[0], enabled: false }],
        },
      },
    ]),
  ).toHaveLength(1);
  expect(
    collectImagePaintReferences(
      [
        {
          ...source,
          scene: {
            ...source.scene,
            strokes: [{ ...source.scene.strokes[0], enabled: false }],
          },
        },
      ],
      "all",
    ),
  ).toHaveLength(2);
});

it.each([{ width: 0 }, { opacity: 0 }])(
  "does not wait for invisible stroke images but retains portable references: %j",
  (invisible) => {
    const asset = `assets/${"c".repeat(64)}.png`;
    const source = {
      ...node,
      scene: {
        ...node.scene!,
        strokes: [
          {
            id: "missing-invisible",
            kind: "image" as const,
            asset,
            mapping: { mode: "cover" as const, anchor: { x: 0.5, y: 0.5 } },
            alignment: "outside" as const,
            width: 5,
            ...invisible,
          },
        ],
      },
    };
    expect(collectImagePaintReferences([source], "rendered")).toEqual([]);
    expect(
      collectImagePaintReferences([source], "all").map((ref) => ref.asset),
    ).toEqual([asset]);
  },
);
