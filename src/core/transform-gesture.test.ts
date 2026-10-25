import { expect, it } from "vitest";
import { parseProject, type ProjectNode } from "./project";
import { applyBatch } from "./operations";
import { sceneProject, componentProject } from "./scene-fixtures";
import { sceneLayers, transformPoint, type Point } from "./scene";
import { getTransformFrame, transformFramePivot } from "./affine-geometry";
import {
  createTransformGesture,
  updateTransformGesture,
  type TransformHandle,
} from "./transform-gesture";
function node(id: string, x = 10, y = 20): ProjectNode {
  return {
    id,
    type: "SceneFrame",
    props: {},
    slots: {},
    scene: { kind: "frame", x, y, width: 100, height: 60 },
  };
}
function project(nodes = [node("n")]) {
  const p = parseProject(sceneProject());
  p.pages[0].nodes = nodes;
  return parseProject(p);
}
function near(a: Point, b: Point) {
  expect(a.x).toBeCloseTo(b.x, 8);
  expect(a.y).toBeCloseTo(b.y, 8);
}
const handles: { handle: TransformHandle; x: number; y: number }[] = [
  { handle: "nw", x: 0, y: 0 },
  { handle: "n", x: 0.5, y: 0 },
  { handle: "ne", x: 1, y: 0 },
  { handle: "e", x: 1, y: 0.5 },
  { handle: "se", x: 1, y: 1 },
  { handle: "s", x: 0.5, y: 1 },
  { handle: "sw", x: 0, y: 1 },
  { handle: "w", x: 0, y: 0.5 },
];
it("captures the actual parent world matrix without inverse reconstruction error", () => {
  const parent = node("parent", 100, 200);
  parent.scene!.linearTransform = [500000, 100000, 150000, 500000];
  const child = node("child", 900000, 900000);
  child.scene!.linearTransform = [100, 100, 100, 100.00001];
  parent.slots.content = [child];
  const p = project([parent]);
  const before = structuredClone(p);
  const frame = getTransformFrame(p, ["child"]);
  const start = transformFramePivot(frame, { x: 1, y: 1 });
  const capture = createTransformGesture(p, ["child"], {
    tool: "move",
    pointer: start,
  });
  expect(capture.parents[0].world).toEqual([
    500000, 100000, 150000, 500000, 100, 200,
  ]);
  expect(updateTransformGesture(capture, start)).toMatchObject({
    valid: true,
    operations: [],
    frame,
  });
  const result = updateTransformGesture(capture, {
    x: start.x + 100,
    y: start.y + 200,
  });
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  const next = applyBatch(p, {
    requestId: "exact-parent",
    baseRevision: p.revision,
    operations: result.operations,
  });
  expect(result.frame).toEqual(getTransformFrame(next, ["child"]));
  expect(p).toEqual(before);
});
it.each(handles)(
  "resizes $handle from opposite anchor and captures pointer offset without a jump",
  ({ handle, x, y }) => {
    const p = project(),
      pointer = { x: 10 + x * 100 + 3, y: 20 + y * 60 - 2 },
      capture = createTransformGesture(p, ["n"], {
        tool: "resize",
        handle,
        pointer,
      });
    expect(updateTransformGesture(capture, pointer).operations).toEqual([]);
    const dx = x === 0.5 ? 0 : x ? 40 : -40,
      dy = y === 0.5 ? 0 : y ? 20 : -20;
    const result = updateTransformGesture(capture, {
      x: pointer.x + dx,
      y: pointer.y + dy,
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const next = applyBatch(p, {
        requestId: handle,
        baseRevision: 0,
        operations: result.operations,
      }),
      s = next.pages[0].nodes[0].scene!;
    expect(s.width).toBe(x === 0.5 ? 100 : 140);
    expect(s.height).toBe(y === 0.5 ? 60 : 80);
    expect(s.x).toBe(x === 0 ? -30 : 10);
    expect(s.y).toBe(y === 0 ? 0 : 20);
    expect(result.operations.every((o) => o.type === "setNodeGeometry")).toBe(
      true,
    );
  },
);
it("Alt and Shift toggle against the immutable source; side Shift preserves aspect around opposite edge center", () => {
  const p = project(),
    capture = createTransformGesture(p, ["n"], {
      tool: "resize",
      handle: "e",
      pointer: { x: 110, y: 50 },
    });
  const point = { x: 160, y: 50 };
  const normal = updateTransformGesture(capture, point),
    alt = updateTransformGesture(capture, point, { altKey: true }),
    shift = updateTransformGesture(capture, point, { shiftKey: true });
  for (const r of [normal, alt, shift]) expect(r.valid).toBe(true);
  if (!normal.valid || !alt.valid || !shift.valid) return;
  expect(normal.operations[0].geometry).toMatchObject({
    x: 10,
    y: 20,
    width: 150,
    height: 60,
  });
  expect(alt.operations[0].geometry).toMatchObject({
    x: -40,
    y: 20,
    width: 200,
    height: 60,
  });
  expect(shift.operations[0].geometry).toMatchObject({
    x: 10,
    y: 5,
    width: 150,
    height: 90,
  });
  expect(updateTransformGesture(capture, point)).toEqual(normal);
  expect(p.pages[0].nodes[0].scene!.width).toBe(100);
  expect(capture.frame.roots[0].width).toBe(100);
});
it("uses physical projection for proportional corner scaling in a sheared/reflected affine parent", () => {
  const parent = node("parent", 100, 50);
  parent.scene!.linearTransform = [2, 1, 0.5, 3];
  const n = node("n", 4, 6);
  n.scene!.linearTransform = [-1, 0.25, 1, 1];
  parent.slots.content = [n];
  const p = project([parent]),
    frame = getTransformFrame(p, ["n"]),
    start = transformFramePivot(frame, { x: 1, y: 1 }),
    pivot = transformFramePivot(frame, { x: 0, y: 0 }),
    v = { x: start.x - pivot.x, y: start.y - pivot.y };
  const capture = createTransformGesture(p, ["n"], {
    tool: "scale",
    handle: "se",
    pointer: start,
  });
  // Perpendicular displacement must not change the projected uniform factor 1.5.
  const point = {
    x: pivot.x + 1.5 * v.x - 0.2 * v.y,
    y: pivot.y + 1.5 * v.y + 0.2 * v.x,
  };
  const result = updateTransformGesture(capture, point, { shiftKey: true });
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  const next = applyBatch(p, {
    requestId: "uniform",
    baseRevision: 0,
    operations: result.operations,
  });
  const layer = sceneLayers(next.pages[0].nodes).find(
    (l) => l.node.id === "n",
  )!;
  for (const [x, y] of [
    [0, 0],
    [100, 0],
    [100, 60],
    [0, 60],
  ]) {
    const original = transformPoint({ x, y }, frame.roots[0].world);
    near(transformPoint({ x, y }, layer.transform), {
      x: pivot.x + 1.5 * (original.x - pivot.x),
      y: pivot.y + 1.5 * (original.y - pivot.y),
    });
  }
  expect(layer.node.scene).toMatchObject({ width: 100, height: 60 });
});
it("single Resize uses local coordinates through reflection and retains shear while Scale preserves layout", () => {
  const n = node("n", 100, 50);
  n.scene!.linearTransform = [-2, 1, 0.5, 3];
  const p = project([n]),
    frame = getTransformFrame(p, ["n"]),
    start = transformFramePivot(frame, { x: 1, y: 1 }),
    end = transformPoint({ x: 150, y: 90 }, frame.roots[0].world);
  for (const tool of ["resize", "scale"] as const) {
    const capture = createTransformGesture(p, ["n"], {
        tool,
        handle: "se",
        pointer: start,
      }),
      result = updateTransformGesture(capture, end);
    expect(result.valid).toBe(true);
    if (!result.valid) continue;
    const next = applyBatch(p, {
      requestId: tool,
      baseRevision: 0,
      operations: result.operations,
    });
    expect(next.pages[0].nodes[0].scene).toMatchObject(
      tool === "resize"
        ? { width: 150, height: 90, linearTransform: [-2, 1, 0.5, 3] }
        : { width: 100, height: 60 },
    );
    const layer = sceneLayers(next.pages[0].nodes)[0];
    near(
      transformPoint(
        { x: layer.node.scene!.width, y: layer.node.scene!.height },
        layer.transform,
      ),
      end,
    );
  }
});
it("multi roots use AABB, filter selected children, and update every move from capture", () => {
  const a = node("a", 0, 0);
  a.slots.content = [node("child", 5, 5)];
  const b = node("b", 200, 100);
  const p = project([a, b]);
  const capture = createTransformGesture(p, ["a", "child", "b"], {
    tool: "scale",
    handle: "se",
    pointer: { x: 300, y: 160 },
  });
  const first = updateTransformGesture(capture, { x: 450, y: 240 }),
    second = updateTransformGesture(capture, { x: 600, y: 320 });
  expect(first.valid && second.valid).toBe(true);
  if (!second.valid) return;
  expect(second.operations.map((o) => o.nodeId)).toEqual(["a", "b"]);
  const next = applyBatch(p, {
    requestId: "multi",
    baseRevision: 0,
    operations: second.operations,
  });
  expect(next.pages[0].nodes[0].slots.content[0]).toEqual(a.slots.content[0]);
  near(
    transformPoint(
      { x: 100, y: 60 },
      sceneLayers(next.pages[0].nodes).find((l) => l.node.id === "b")!
        .transform,
    ),
    { x: 600, y: 320 },
  );
});
it("invalid zero/cross-zero final result contains no last good operations and can recover", () => {
  const p = project(),
    capture = createTransformGesture(p, ["n"], {
      tool: "resize",
      handle: "e",
      pointer: { x: 110, y: 50 },
    });
  expect(updateTransformGesture(capture, { x: 160, y: 50 }).valid).toBe(true);
  for (const x of [10, 0, NaN]) {
    const result = updateTransformGesture(capture, { x, y: 50 });
    expect(result.valid).toBe(false);
    expect(result.operations).toEqual([]);
  }
  expect(updateTransformGesture(capture, { x: 110, y: 50 })).toMatchObject({
    valid: true,
    operations: [],
  });
});
function polar(center: Point, degrees: number) {
  return {
    x: center.x + 100 * Math.cos((degrees * Math.PI) / 180),
    y: center.y + 100 * Math.sin((degrees * Math.PI) / 180),
  };
}
it("unwraps rotation across +/-180 using immutable explicit state and snaps only output to15degrees", () => {
  const p = project(),
    center = { x: 60, y: 50 },
    capture = createTransformGesture(p, ["n"], {
      tool: "rotate",
      pointer: polar(center, 170),
    });
  const initial = capture.rotationState;
  let result = updateTransformGesture(capture, polar(center, -170));
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  expect(result.degrees).toBeCloseTo(20);
  expect(initial.totalRadians).toBe(0);
  const state = result.rotationState;
  result = updateTransformGesture(
    capture,
    polar(center, -145),
    { shiftKey: true },
    state,
  );
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  expect(result.degrees).toBe(45);
  const unsnapped = updateTransformGesture(
    capture,
    polar(center, -143),
    {},
    result.rotationState,
  );
  expect(unsnapped.valid).toBe(true);
  if (unsnapped.valid) expect(unsnapped.degrees).toBeCloseTo(47);
});
it("rotation can exceed360 and return to start with a no-op, preserving unsnapped state", () => {
  const p = project(),
    center = { x: 60, y: 50 },
    capture = createTransformGesture(p, ["n"], {
      tool: "rotate",
      pointer: polar(center, 0),
    });
  let state = capture.rotationState;
  for (const angle of [90, 179, -90, 0, 90]) {
    const r = updateTransformGesture(capture, polar(center, angle), {}, state);
    expect(r.valid).toBe(true);
    state = r.rotationState;
    if (r.valid && angle === 90 && state.totalRadians > Math.PI * 2)
      expect(r.degrees).toBeCloseTo(450);
    if (r.valid && angle === 0) expect(r.operations).toEqual([]);
  }
  const invalid = updateTransformGesture(capture, center, {}, state);
  expect(invalid.valid).toBe(false);
  expect(invalid.rotationState).toEqual(state);
});
it("capture is detached and freezes source snapshot; displayed locks reject capture", () => {
  const p = project(),
    capture = createTransformGesture(p, ["n"], {
      tool: "resize",
      handle: "se",
      pointer: { x: 110, y: 80 },
    });
  p.pages[0].nodes[0].scene!.width = 999;
  const result = updateTransformGesture(capture, { x: 160, y: 110 });
  expect(result.valid).toBe(true);
  if (result.valid) expect(result.operations[0].geometry.width).toBe(150);
  expect(Object.isFrozen(capture)).toBe(true);
  const locked = parseProject(componentProject());
  locked.designComponents![0].nodes[0].locked = true;
  expect(() =>
    createTransformGesture(locked, ["instance"], {
      tool: "scale",
      handle: "se",
      pointer: { x: 300, y: 130 },
    }),
  ).toThrow("NODE_LOCKED");
});

it("Move emits complete legacy geometry without adding matrix, and preserves roots through affine parents", () => {
  const parent = node("parent", 100, 50);
  parent.scene!.linearTransform = [2, 1, 0.5, 3];
  const child = node("child", 4, 6);
  child.scene!.rotation = 90;
  parent.slots.content = [child];
  const p = project([parent]),
    capture = createTransformGesture(p, ["child"], {
      tool: "move",
      pointer: { x: 10, y: 20 },
    });
  expect(updateTransformGesture(capture, { x: 10, y: 20 })).toMatchObject({
    valid: true,
    operations: [],
  });
  const result = updateTransformGesture(capture, { x: 43, y: 9 });
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  expect(result.operations[0].geometry).toMatchObject({
    width: 100,
    height: 60,
    rotation: 90,
  });
  expect(result.operations[0].geometry).not.toHaveProperty("linearTransform");
  const expected = getTransformFrame(p, ["child"]).roots[0].world;
  near(
    { x: result.frame.roots[0].world[4], y: result.frame.roots[0].world[5] },
    { x: expected[4] + 33, y: expected[5] - 11 },
  );
  const next = applyBatch(p, {
    requestId: "move",
    baseRevision: 0,
    operations: result.operations,
  });
  expect(getTransformFrame(next, ["child"])).toEqual(result.frame);
});
it("returned effective frames match committed Resize, Scale and Rotate without applying a batch during update", () => {
  const n = node("n", 100, 50);
  n.scene!.linearTransform = [-2, 1, 0.5, 3];
  const p = project([n]),
    frame = getTransformFrame(p, ["n"]),
    start = transformFramePivot(frame, { x: 1, y: 1 });
  for (const tool of ["resize", "scale"] as const) {
    const capture = createTransformGesture(p, ["n"], {
      tool,
      handle: "se",
      pointer: start,
    });
    const result = updateTransformGesture(
      capture,
      transformPoint({ x: 150, y: 90 }, frame.roots[0].world),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) continue;
    const next = applyBatch(p, {
      requestId: `frame-${tool}`,
      baseRevision: 0,
      operations: result.operations,
    });
    expect(result.frame).toEqual(getTransformFrame(next, ["n"]));
    expect(result.frame.bounds).toEqual({
      x: -200,
      y: 50,
      width: 345,
      height: 420,
    });
  }
  const capture = createTransformGesture(p, ["n"], {
      tool: "rotate",
      pointer: { x: 200, y: 200 },
    }),
    pivot = transformFramePivot(frame, { x: 0.5, y: 0.5 }),
    v = { x: 200 - pivot.x, y: 200 - pivot.y };
  const rotated = updateTransformGesture(capture, {
    x: pivot.x - v.y,
    y: pivot.y + v.x,
  });
  expect(rotated.valid).toBe(true);
  if (rotated.valid) {
    const next = applyBatch(p, {
      requestId: "frame-rotate",
      baseRevision: 0,
      operations: rotated.operations,
    });
    expect(rotated.frame).toEqual(getTransformFrame(next, ["n"]));
    expect(rotated.degrees).toBeCloseTo(90);
  }
});

it.each(handles)(
  "proportional $handle works around opposite anchor and Alt center for Resize and Scale",
  ({ handle, x, y }) => {
    const n = node("n", 100, 50);
    n.scene!.linearTransform = [-2, 1, 0.5, 3];
    const p = project([n]),
      frame = getTransformFrame(p, ["n"]),
      start = transformFramePivot(frame, { x, y });
    for (const tool of ["resize", "scale"] as const)
      for (const altKey of [false, true]) {
        const capture = createTransformGesture(p, ["n"], {
            tool,
            handle,
            pointer: { x: start.x + 2, y: start.y - 3 },
          }),
          anchor = altKey ? { x: 0.5, y: 0.5 } : { x: 1 - x, y: 1 - y },
          pivot = transformFramePivot(frame, anchor),
          target = {
            x: pivot.x + 2 * (start.x - pivot.x) + 2,
            y: pivot.y + 2 * (start.y - pivot.y) - 3,
          };
        expect(
          updateTransformGesture(capture, capture.startPointer, {
            altKey,
            shiftKey: true,
          }),
        ).toMatchObject({ valid: true, operations: [] });
        const result = updateTransformGesture(capture, target, {
          altKey,
          shiftKey: true,
        });
        expect(result.valid).toBe(true);
        if (!result.valid) continue;
        const root = result.frame.roots[0];
        for (const corner of [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ]) {
          const old = transformFramePivot(frame, corner);
          near(
            transformPoint(
              { x: corner.x * root.width, y: corner.y * root.height },
              root.world,
            ),
            {
              x: pivot.x + 2 * (old.x - pivot.x),
              y: pivot.y + 2 * (old.y - pivot.y),
            },
          );
        }
      }
  },
);
