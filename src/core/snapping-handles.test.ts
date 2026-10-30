import { expect, it } from "vitest";
import { parseProject, type ProjectNode } from "./project";
import { sceneProject } from "./scene-fixtures";
import {
  createTransformGesture,
  updateTransformGesture,
  type TransformHandle,
} from "./transform-gesture";
import { transformFramePivot, getTransformFrame } from "./affine-geometry";
import { buildSnapIndex, solveTransformSnapping } from "./snapping";

const anchors: Record<TransformHandle, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};
function project(scene: Partial<NonNullable<ProjectNode["scene"]>> = {}) {
  const p = parseProject(sceneProject());
  p.pages[0].nodes = [
    {
      id: "source",
      type: "SceneFrame",
      props: {},
      slots: {},
      scene: { kind: "frame", x: 10, y: 20, width: 100, height: 60, ...scene },
    },
  ];
  return parseProject(p);
}
it("snaps a free corner without losing pointer offset or moving the opposite anchor", () => {
  const p = project(),
    g = createTransformGesture(p, ["source"], {
      tool: "resize",
      handle: "se",
      pointer: { x: 113, y: 78 },
    });
  const result = solveTransformSnapping(
    g,
    buildSnapIndex(g, { guides: [{ id: "x", axis: "x", position: 200 }] }),
    { x: 198, y: 83 },
    { zoom: 1 },
  );
  expect(result.pointer).toEqual({ x: 203, y: 83 });
  expect(result.result.valid).toBe(true);
  if (!result.result.valid) return;
  expect(result.result.operations[0].geometry).toMatchObject({
    x: 10,
    y: 20,
    width: 190,
    height: 65,
  });
  expect(transformFramePivot(result.result.frame, { x: 0, y: 0 })).toEqual({
    x: 10,
    y: 20,
  });
});
it("intersects a rotated side constraint rather than translating an already resized box", () => {
  const p = project({ rotation: 45 }),
    t = Math.SQRT1_2;
  const start = { x: 10 + 70 * t, y: 20 + 130 * t };
  const g = createTransformGesture(p, ["source"], {
    tool: "resize",
    handle: "e",
    pointer: start,
  });
  const pointer = { x: start.x - 20 * t, y: start.y + 60 * t };
  const target = start.x + 20 * t + 3;
  const result = solveTransformSnapping(
    g,
    buildSnapIndex(g, { guides: [{ id: "x", axis: "x", position: target }] }),
    pointer,
    { zoom: 1 },
  );
  expect(result.pointer.x - pointer.x).toBeCloseTo(3, 10);
  expect(result.pointer.y - pointer.y).toBeCloseTo(3, 10);
  expect(result.result.valid).toBe(true);
  if (!result.result.valid) return;
  const corner = transformFramePivot(result.result.frame, { x: 1, y: 0.5 });
  expect(corner.x).toBeCloseTo(target, 10);
  const fixed = transformFramePivot(result.result.frame, { x: 0, y: 0.5 });
  expect(fixed.x).toBeCloseTo(10 - 30 * t, 10);
  expect(fixed.y).toBeCloseTo(20 + 30 * t, 10);
});
it("chooses one reachable proportional target and does not display the incompatible other axis", () => {
  const p = project({ x: 0, y: 0, width: 100, height: 100 });
  const g = createTransformGesture(p, ["source"], {
    tool: "resize",
    handle: "se",
    pointer: { x: 100, y: 100 },
  });
  const result = solveTransformSnapping(
    g,
    buildSnapIndex(g, {
      guides: [
        { id: "x", axis: "x", position: 147 },
        { id: "y", axis: "y", position: 148 },
      ],
    }),
    { x: 140, y: 150 },
    { zoom: 1, shiftKey: true },
  );
  expect(result.result.valid).toBe(true);
  if (!result.result.valid) return;
  expect(result.result.operations[0].geometry).toMatchObject({ x: 0, y: 0 });
  expect(result.result.operations[0].geometry.width).toBeCloseTo(147, 10);
  expect(result.result.operations[0].geometry.height).toBeCloseTo(147, 10);
  expect(result.guides.map((line) => line.axis)).toEqual(["x"]);
  expect(result.pointer.x).toBeCloseTo(142, 10);
  expect(result.pointer.y).toBeCloseTo(152, 10);
});
it("does not rescue an invalid final size or snap an unreachable side coordinate", () => {
  const p = project(),
    g = createTransformGesture(p, ["source"], {
      tool: "resize",
      handle: "se",
      pointer: { x: 110, y: 80 },
    });
  const invalid = solveTransformSnapping(
    g,
    buildSnapIndex(g, { guides: [{ id: "x", axis: "x", position: 15 }] }),
    { x: 8, y: 80 },
    { zoom: 1 },
  );
  expect(invalid.result.valid).toBe(false);
  expect(invalid.guides).toEqual([]);
  const q = project({ rotation: 90 }),
    frame = getTransformFrame(q, ["source"]),
    start = transformFramePivot(frame, { x: 1, y: 0.5 });
  const side = createTransformGesture(q, ["source"], {
    tool: "resize",
    handle: "e",
    pointer: start,
  });
  const pointer = { x: start.x, y: start.y + 20 };
  const unreachable = solveTransformSnapping(
    side,
    buildSnapIndex(side, {
      guides: [{ id: "x", axis: "x", position: start.x + 3 }],
    }),
    pointer,
    { zoom: 1 },
  );
  expect(unreachable.pointer).toEqual(pointer);
  expect(unreachable.guides).toEqual([]);
  expect(unreachable.result.valid).toBe(true);
});
for (const tool of ["resize", "scale"] as const)
  for (const handle of Object.keys(anchors) as TransformHandle[])
    for (const altKey of [false, true])
      for (const shiftKey of [false, true]) {
        it(`${tool} ${handle} preserves its anchor under reflected shear, Alt=${altKey}, Shift=${shiftKey}`, () => {
          const p = project({ linearTransform: [-1.2, 0.4, 0.3, 1.1] }),
            frame = getTransformFrame(p, ["source"]),
            anchor = anchors[handle];
          const fixed = altKey
            ? { x: 0.5, y: 0.5 }
            : { x: 1 - anchor.x, y: 1 - anchor.y };
          const start = transformFramePivot(frame, anchor),
            pivot = transformFramePivot(frame, fixed);
          const g = createTransformGesture(p, ["source"], {
            tool,
            handle,
            pointer: start,
          });
          const pointer = {
            x: start.x + (start.x - pivot.x) * 0.15,
            y: start.y + (start.y - pivot.y) * 0.15,
          };
          const raw = updateTransformGesture(g, pointer, { altKey, shiftKey });
          expect(raw.valid).toBe(true);
          if (!raw.valid) return;
          const point = transformFramePivot(raw.frame, anchor),
            axis =
              Math.abs(start.x - pivot.x) > Math.abs(start.y - pivot.y)
                ? "x"
                : "y";
          const target = point[axis] + 2;
          const result = solveTransformSnapping(
            g,
            buildSnapIndex(g, {
              guides: [{ id: "g", axis, position: target }],
            }),
            pointer,
            { zoom: 1, altKey, shiftKey },
          );
          expect(result.result.valid).toBe(true);
          if (!result.result.valid) return;
          expect(result.guides).toHaveLength(1);
          expect(
            transformFramePivot(result.result.frame, anchor)[axis],
          ).toBeCloseTo(target, 8);
          const actual = transformFramePivot(result.result.frame, fixed);
          expect(actual.x).toBeCloseTo(pivot.x, 8);
          expect(actual.y).toBeCloseTo(pivot.y, 8);
          expect(
            Math.hypot(
              result.pointer.x - pointer.x,
              result.pointer.y - pointer.y,
            ),
          ).toBeLessThanOrEqual(6 + 1e-9);
        });
      }
