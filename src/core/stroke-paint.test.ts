import { describe, expect, it } from "vitest";
import { compileFramePaintTree } from "./image-paint";
import { compileFrameStrokeTree } from "./stroke-paint";
import type { Paint, Stroke } from "./paint";
import type { SceneMetadata } from "./scene";

type Tree = {
  tag: string;
  props: Record<string, unknown>;
  children: Tree[];
};
const asset = `assets/${"a".repeat(64)}.png`;
const red = { r: 255, g: 0, b: 0, a: 0.8 };
const solid: Stroke = {
  id: "outline",
  kind: "solid",
  color: red,
  width: 10,
  alignment: "inside",
};
const frame: SceneMetadata = {
  kind: "frame",
  x: 35,
  y: 47,
  width: 100,
  height: 60,
  radius: 10,
  strokes: [solid],
};
const flatten = (tree: Tree): Tree[] => [
  tree,
  ...tree.children.flatMap(flatten),
];
const style = (tree: Tree) =>
  tree.props.style as Record<string, string | number>;
const layers = (tree: Tree) =>
  flatten(tree).filter((node) => style(node)?.clipPath);
const paths = (tree: Tree) =>
  flatten(tree).filter((node) => node.tag === "path");

/** Read the first corner and its two adjacent edges to recover a rounded contour. */
function contours(path: Tree) {
  return String(path.props.d)
    .split(/(?=M )/)
    .filter(Boolean)
    .map((contour) => {
      const tokens = contour.trim().split(/\s+/);
      const x = Number(tokens[1]),
        y = Number(tokens[2]);
      const endX = Number(tokens[4]);
      const radius = tokens[5] === "A" ? Number(tokens[6]) : 0;
      const endY = Number(tokens[tokens.indexOf("V") + 1]);
      return {
        x: x - radius,
        y,
        width: endX - x + 2 * radius,
        height: endY - y + radius,
        radius,
      };
    });
}

describe("frame stroke paint tree", () => {
  it.each(["center", "outside"] as const)(
    "keeps zero-radius %s strokes square at the outer corners",
    (alignment) => {
      const tree = compileFrameStrokeTree("frame", {
        ...frame,
        radius: 0,
        strokes: [{ ...solid, alignment }],
      })!;
      const path = paths(tree)[0];
      expect(String(path.props.d)).not.toContain("A ");
      const outset = alignment === "center" ? 5 : 10;
      expect(contours(path)[0]).toEqual({
        x: 0,
        y: 0,
        width: 100 + 2 * outset,
        height: 60 + 2 * outset,
        radius: 0,
      });
    },
  );

  it.each([
    ["inside", 0, 10],
    ["center", 5, 5],
    ["outside", 10, 0],
  ] as const)(
    "uses exact rounded ring and outer paint bounds for %s",
    (alignment, outset, inset) => {
      const tree = compileFrameStrokeTree("frame", {
        ...frame,
        strokes: [{ ...solid, alignment }],
      })!;
      expect(tree).toBeDefined();
      expect(style(tree)).toMatchObject({
        position: "absolute",
        inset: 0,
        overflow: "visible",
      });
      expect(style(tree)).not.toHaveProperty("isolation");
      expect(style(tree)).not.toHaveProperty("transform");
      expect(style(layers(tree)[0])).toMatchObject({
        left: -outset,
        top: -outset,
        width: 100 + 2 * outset,
        height: 60 + 2 * outset,
      });
      expect(contours(paths(tree)[0])).toEqual([
        {
          x: 0,
          y: 0,
          width: 100 + 2 * outset,
          height: 60 + 2 * outset,
          radius: 10 + outset,
        },
        {
          x: inset + outset,
          y: inset + outset,
          width: 100 - 2 * inset,
          height: 60 - 2 * inset,
          radius: Math.max(0, 10 - inset),
        },
      ]);
      expect(paths(tree)[0].props).toMatchObject({
        fillRule: "evenodd",
        clipRule: "evenodd",
      });
    },
  );

  it("clamps the base radius before expanding the outer contour", () => {
    const tree = compileFrameStrokeTree("frame", {
      ...frame,
      radius: 999,
      strokes: [{ ...solid, alignment: "outside" }],
    })!;
    expect(contours(paths(tree)[0]).map((contour) => contour.radius)).toEqual([
      40, 30,
    ]);
  });

  it.each([30, 40, 60])(
    "omits a collapsed inside hole for width %s",
    (width) => {
      const tree = compileFrameStrokeTree("frame", {
        ...frame,
        strokes: [{ ...solid, width }],
      })!;
      expect(contours(paths(tree)[0])).toHaveLength(1);
      expect(String(paths(tree)[0].props.d)).not.toMatch(/NaN|Infinity/);
    },
  );

  it("does not render absent, empty, disabled, zero-width, or transparent stacks", () => {
    for (const strokes of [
      undefined,
      [],
      [{ ...solid, enabled: false }],
      [{ ...solid, width: 0 }],
      [{ ...solid, opacity: 0 }],
    ])
      expect(
        compileFrameStrokeTree("frame", { ...frame, stroke: "#fff", strokes }),
      ).toBeUndefined();
    expect(
      compileFrameStrokeTree("text", {
        ...frame,
        kind: "text",
        strokes: undefined,
      }),
    ).toBeUndefined();
  });

  it("composites top-first solid and gradients with opacity exactly once", () => {
    const tree = compileFrameStrokeTree("frame", {
      ...frame,
      strokes: [
        { ...solid, opacity: 0.5, blendMode: "multiply" },
        {
          id: "linear",
          kind: "linear",
          angle: 90,
          stops: [
            { offset: 0, color: red },
            { offset: 1, color: red },
          ],
          opacity: 0.25,
          width: 4,
          alignment: "center",
        },
        {
          id: "radial",
          kind: "radial",
          center: { x: 0.2, y: 0.8 },
          radius: { x: 0.5, y: 1 },
          stops: [
            { offset: 0, color: red },
            { offset: 1, color: red },
          ],
          width: 2,
          alignment: "outside",
        },
      ],
    })!;
    const rendered = layers(tree);
    expect(
      rendered.map((node) => String(style(node).backgroundImage).split("(")[0]),
    ).toEqual(["radial-gradient", "linear-gradient", "linear-gradient"]);
    expect(style(rendered[1]).backgroundImage).toContain(
      "rgba(255, 0, 0, 0.2)",
    );
    expect(style(rendered[2])).toMatchObject({
      mixBlendMode: "multiply",
      backgroundImage:
        "linear-gradient(rgba(255, 0, 0, 0.4), rgba(255, 0, 0, 0.4))",
    });
    for (const node of rendered) expect(style(node).opacity ?? 1).toBe(1);
  });

  it.each(["cover", "contain", "crop", "tile"] as const)(
    "maps image %s against the outer envelope without legacy effects",
    (mode) => {
      const mapping =
        mode === "cover" || mode === "contain"
          ? { mode, anchor: { x: 0.2, y: 0.8 } }
          : {
              mode,
              imageToFrame: [40, 0, 0, 20, 3, 4] as [
                number,
                number,
                number,
                number,
                number,
                number,
              ],
            };
      const tree = compileFrameStrokeTree("frame", {
        ...frame,
        stroke: "#f00",
        strokeWidth: 5,
        shadows: [
          {
            id: "shadow",
            kind: "inner",
            x: 1,
            y: 2,
            blur: 3,
            spread: 4,
            color: red,
          },
        ],
        strokes: [
          {
            id: "image",
            kind: "image",
            asset,
            mapping,
            width: 10,
            alignment: "outside",
            opacity: 0.4,
            blendMode: "screen",
          },
        ],
      })!;
      const layer = layers(tree)[0];
      expect(style(layer)).toMatchObject({
        left: -10,
        top: -10,
        width: 120,
        height: 80,
        mixBlendMode: "screen",
      });
      const nodes = flatten(layer);
      expect(nodes.filter((node) => style(node)?.opacity === 0.4)).toHaveLength(
        1,
      );
      expect(nodes.some((node) => style(node)?.boxShadow)).toBe(false);
      if (mode === "cover" || mode === "contain") {
        expect(nodes.find((node) => node.tag === "img")?.props).toMatchObject({
          src: asset,
          style: { objectFit: mode, objectPosition: "20% 80%" },
        });
      } else {
        expect(
          nodes.find((node) => node.tag === "svg" && node.props.viewBox)?.props
            .viewBox,
        ).toBe("0 0 120 80");
        expect(nodes.find((node) => node.tag === "image")?.props).toMatchObject(
          {
            href: asset,
            ...(mode === "crop" ? { transform: "matrix(40 0 0 20 3 4)" } : {}),
          },
        );
        if (mode === "tile")
          expect(
            nodes.find((node) => node.tag === "rect")?.props,
          ).toMatchObject({ width: 120, height: 80 });
      }
    },
  );

  it("keeps clip and tile IDs safe and distinct from fills, nodes, and hostile stroke IDs", () => {
    const tile: Paint = {
      id: "same",
      kind: "image",
      asset,
      mapping: { mode: "tile", imageToFrame: [20, 0, 0, 20, 0, 0] },
    };
    const ids = new Set<string>();
    for (const [nodeId, strokeId] of [
      ["a", "b:c"],
      ["a:b", "c"],
      ["__proto__", "constructor"],
      ["😀", "same"],
      ["\ud83d", "same"],
      ["x') url(javascript:evil)", "same"],
    ]) {
      const scene = {
        ...frame,
        fills: [{ ...tile, id: strokeId }],
        strokes: [
          { ...tile, id: strokeId, width: 5, alignment: "outside" as const },
        ],
      };
      const strokeTree = compileFrameStrokeTree(nodeId, scene)!;
      const fillTree = compileFramePaintTree(nodeId, scene)!;
      const all = [...flatten(strokeTree), ...flatten(fillTree)];
      const localIds = all
        .filter((node) => node.props.id)
        .map((node) => String(node.props.id));
      expect(new Set(localIds).size).toBe(localIds.length);
      for (const id of localIds) {
        expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }
      for (const node of all) {
        const ref = style(node)?.clipPath ?? node.props.fill;
        if (typeof ref === "string" && ref.startsWith("url(#"))
          expect(localIds).toContain(ref.slice(5, -1));
      }
    }
  });

  it("does not mutate the scene or materialize legacy stroke fields", () => {
    const scene = structuredClone(frame);
    const before = JSON.stringify(scene);
    compileFrameStrokeTree("frame", scene);
    expect(JSON.stringify(scene)).toBe(before);
    expect(scene).not.toHaveProperty("stroke");
  });

  it("reserves a separate emitted namespace even when a fill node equals the image surrogate ID", () => {
    const source = JSON.stringify(["victim", "stroke", "same", "image"]);
    let surrogate = "stroke-image-";
    for (let index = 0; index < source.length; index++)
      surrogate += source.charCodeAt(index).toString(16).padStart(4, "0");
    const paint: Paint = {
      id: "same",
      kind: "image",
      asset,
      mapping: { mode: "tile", imageToFrame: [20, 0, 0, 20, 0, 0] },
    };
    const strokeTree = compileFrameStrokeTree("victim", {
      ...frame,
      strokes: [{ ...paint, width: 5, alignment: "outside" }],
    })!;
    const fillTree = compileFramePaintTree(surrogate, {
      ...frame,
      strokes: [],
      fills: [paint],
    })!;
    const ids = [...flatten(strokeTree), ...flatten(fillTree)]
      .filter((node) => node.props.id)
      .map((node) => node.props.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
