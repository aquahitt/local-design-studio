import { describe, expect, it } from "vitest";
import type { Paint, Stroke } from "./paint";
import type { SceneMetadata, Matrix } from "./scene";
import {
  frameShadowLocalBounds,
  frameStrokeLocalBounds,
  frameStrokeOutsets,
  projectPaintBounds,
} from "./paint-bounds";

function stroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    id: "stroke",
    kind: "solid",
    color: { r: 20, g: 40, b: 60, a: 1 },
    width: 8,
    alignment: "outside",
    ...overrides,
  } as Stroke;
}
function frame(strokes?: Stroke[]): SceneMetadata {
  return { kind: "frame", x: 50, y: -80, width: 20, height: 10, strokes };
}
const layout = { x: 0, y: 0, width: 20, height: 10 };
const policy = "css-raster-envelope-6sigma-plus-2px";

describe("local frame stroke bounds", () => {
  it.each([
    ["inside", 0],
    ["center", 4],
    ["outside", 8],
  ] as const)("uses %s alignment's geometric outset", (alignment, outset) => {
    const scene = frame([stroke({ alignment })]);
    expect(frameStrokeOutsets(scene)).toEqual({
      top: outset,
      right: outset,
      bottom: outset,
      left: outset,
    });
    expect(frameStrokeLocalBounds(scene)).toEqual({
      x: -outset || 0,
      y: -outset || 0,
      width: 20 + 2 * outset,
      height: 10 + 2 * outset,
    });
  });

  it("takes a maximum across strokes, independent of paint order", () => {
    const strokes = [
      stroke({ id: "a", width: 10, alignment: "center" }),
      stroke({ id: "b", width: 3 }),
      stroke({ id: "c", width: 4096, alignment: "inside" }),
    ];
    const expected = { x: -5, y: -5, width: 30, height: 20 };
    expect(frameStrokeLocalBounds(frame(strokes))).toEqual(expected);
    expect(frameStrokeLocalBounds(frame(strokes.reverse()))).toEqual(expected);
  });

  it("keeps the layout rectangle for legacy inset stroke and explicit empty list", () => {
    for (const strokes of [undefined, []]) {
      const scene = { ...frame(strokes), stroke: "red", strokeWidth: 100 };
      expect(frameStrokeLocalBounds(scene)).toEqual(layout);
    }
  });

  it.each([
    { enabled: false },
    { opacity: 0 },
    { width: 0 },
    { color: { r: 0, g: 0, b: 0, a: 0 } },
  ])("ignores a stroke with no visible contribution: %j", (invisible) => {
    expect(frameStrokeLocalBounds(frame([stroke(invisible)]))).toEqual(layout);
  });

  it("handles linear, radial and image paints without assuming image alpha", () => {
    const transparent = { r: 0, g: 0, b: 0, a: 0 };
    const opaque = { ...transparent, a: 1 };
    const stops = [
      { offset: 0, color: transparent },
      { offset: 1, color: opaque },
    ];
    const paints: Paint[] = [
      { id: "linear", kind: "linear", angle: 90, stops },
      {
        id: "radial",
        kind: "radial",
        center: { x: 0.5, y: 0.5 },
        radius: { x: 1, y: 1 },
        stops,
      },
      {
        id: "image",
        kind: "image",
        asset: `assets/${"a".repeat(64)}.png`,
        mapping: { mode: "contain", anchor: { x: 0.5, y: 0.5 } },
      },
    ];
    for (const paint of paints) {
      const scene = frame([{ ...paint, width: 6, alignment: "outside" }]);
      expect(frameStrokeLocalBounds(scene)).toEqual({
        x: -6,
        y: -6,
        width: 32,
        height: 22,
      });
    }
    const invisible: Stroke = {
      id: "invisible",
      kind: "linear",
      angle: 90,
      width: 6,
      alignment: "outside",
      stops: stops.map((stop) => ({ ...stop, color: transparent })),
    };
    expect(frameStrokeLocalBounds(frame([invisible]))).toEqual(layout);
  });

  it("does not change its input", () => {
    const scene = frame([stroke()]);
    const before = structuredClone(scene);
    frameStrokeOutsets(scene);
    frameStrokeLocalBounds(scene);
    expect(scene).toEqual(before);
  });

  it("retains the layout minimum for a fully transparent scene", () => {
    expect(
      frameStrokeLocalBounds({ ...frame([stroke()]), opacity: 0 }),
    ).toEqual(layout);
  });

  it("retains fractional geometry and maximum supported width", () => {
    expect(
      frameStrokeLocalBounds(
        frame([stroke({ width: 0.5, alignment: "center" })]),
      ),
    ).toEqual({ x: -0.25, y: -0.25, width: 20.5, height: 10.5 });
    expect(frameStrokeLocalBounds(frame([stroke({ width: 4096 })]))).toEqual({
      x: -4096,
      y: -4096,
      width: 8212,
      height: 8202,
    });
  });
});

describe("affine projection of paint envelopes", () => {
  it.each([
    {
      name: "reflection",
      matrix: [-1, 0, 0, 1, -30, -40],
      expected: { x: -54, y: -44, width: 28, height: 18 },
    },
    {
      name: "shear",
      matrix: [1, 0, 2, 1, -30, -40],
      expected: { x: -42, y: -44, width: 64, height: 18 },
    },
    {
      name: "quarter rotation",
      matrix: [0, 1, -1, 0, -30, -40],
      expected: { x: -44, y: -44, width: 18, height: 28 },
    },
    {
      name: "combined reflection/shear",
      matrix: [-2, 1, 3, 2, -10, -20],
      expected: { x: -70, y: -32, width: 110, height: 64 },
    },
  ])("projects all four corners under $name", ({ matrix, expected }) => {
    // Local extrema: x=-4..24, y=-4..14. Expected values are hand-computed.
    expect(
      projectPaintBounds(
        { x: -4, y: -4, width: 28, height: 18 },
        matrix as Matrix,
      ),
    ).toEqual(expected);
  });
});

describe("own CSS box-shadow envelopes", () => {
  const shadow = {
    id: "shadow",
    kind: "outer" as const,
    x: -12,
    y: 8,
    spread: 3,
    blur: 0,
    color: { r: 0, g: 0, b: 0, a: 1 },
  };
  it("unions unblurred spread and negative offsets with the layout rectangle", () => {
    expect(frameShadowLocalBounds({ ...frame(), shadows: [shadow] })).toEqual({
      bounds: { x: -15, y: 0, width: 35, height: 21 },
      status: "exact-unblurred",
      policy,
    });
  });

  it("keeps finite blur metadata explicit and computes its independent radius", () => {
    // blur 2.5 => ceil(7.5)+2 = 10px around the spread box.
    const scene = { ...frame(), shadows: [{ ...shadow, blur: 2.5 }] };
    expect(frameShadowLocalBounds(scene)).toEqual({
      bounds: { x: -25, y: -5, width: 46, height: 36 },
      status: "conservative-raster",
      policy,
    });
  });

  it("unions separate shadow envelopes instead of adding their outsets", () => {
    const scene = {
      ...frame(),
      shadows: [
        { ...shadow, x: -10, y: 0, spread: 0 },
        { ...shadow, id: "other", x: 10, y: 0, spread: 0 },
      ],
    };
    expect(frameShadowLocalBounds(scene).bounds).toEqual({
      x: -10,
      y: 0,
      width: 40,
      height: 10,
    });
  });

  it("uses layout as the CSS shadow source, independent of stroke extent", () => {
    const scene = { ...frame([stroke({ width: 4096 })]), shadows: [shadow] };
    expect(frameShadowLocalBounds(scene).bounds).toEqual({
      x: -15,
      y: 0,
      width: 35,
      height: 21,
    });
  });

  it.each([
    { enabled: false },
    { kind: "inner" as const },
    { color: { r: 0, g: 0, b: 0, a: 0 } },
    { spread: -11 },
  ])("excludes a noncontributing shadow: %j", (patch) => {
    const scene = { ...frame(), shadows: [{ ...shadow, blur: 20, ...patch }] };
    expect(frameShadowLocalBounds(scene)).toEqual({
      bounds: layout,
      status: "exact-unblurred",
      policy,
    });
  });

  it("handles negative spread before translating the remaining box", () => {
    const scene = { ...frame(), shadows: [{ ...shadow, spread: -2 }] };
    expect(frameShadowLocalBounds(scene).bounds).toEqual({
      x: -10,
      y: 0,
      width: 30,
      height: 16,
    });
  });

  it("keeps the layout minimum and does not mutate a transparent scene", () => {
    const scene = {
      ...frame(),
      opacity: 0,
      shadows: [{ ...shadow, blur: 20 }],
    };
    const before = structuredClone(scene);
    expect(frameShadowLocalBounds(scene)).toEqual({
      bounds: layout,
      status: "exact-unblurred",
      policy,
    });
    expect(scene).toEqual(before);
  });
});
