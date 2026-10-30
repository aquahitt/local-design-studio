import { expect, it } from "vitest";
import { parseProject, type ProjectNode } from "./project";
import { sceneProject } from "./scene-fixtures";
import {
  createTransformGesture,
  updateTransformGesture,
} from "./transform-gesture";
import { buildSnapIndex, solveMoveSnapping } from "./snapping";

function node(
  id: string,
  x: number,
  y = 100,
  width = 100,
  height = 60,
): ProjectNode {
  return {
    id,
    type: "SceneFrame",
    props: {},
    slots: {},
    scene: { kind: "frame", x, y, width, height },
  };
}
function capture(
  nodes = [node("source", 10, 20), node("target", 200)],
  ids = ["source"],
  pointer = { x: 20, y: 30 },
) {
  const p = parseProject(sceneProject());
  p.pages[0].nodes = nodes;
  return createTransformGesture(parseProject(p), ids, {
    tool: "move",
    pointer,
  });
}
it.each([0.05, 0.5, 1, 2, 16])(
  "uses screen pixel thresholds at zoom %s without cumulative corrections",
  (zoom) => {
    const gesture = capture(),
      index = buildSnapIndex(gesture);
    const pointer = { x: 20 + 90 - 6 / zoom, y: 30 };
    // Avoid a second edge becoming closer at very small zoom by limiting this
    // fixture to the guide whose world coordinate is fixed independently of zoom.
    const guideIndex = buildSnapIndex(capture([node("source", 10, 20)]), {
      guides: [{ id: "g", axis: "x", position: 200 }],
    });
    const g = guideIndex.source;
    const result = solveMoveSnapping(g, guideIndex, pointer, { zoom });
    // At tiny zoom the nearest source feature may differ; the selected feature
    // must still land exactly on the guide, within six screen pixels.
    expect(result.guides.find((line) => line.axis === "x")?.position).toBe(200);
    expect(Math.abs(result.pointer.x - pointer.x) * zoom).toBeLessThanOrEqual(
      6 + 1e-9,
    );
    expect(
      solveMoveSnapping(gesture, index, { x: 105, y: 30 }, { zoom: 1 }).pointer
        .x,
    ).toBe(110);
    expect(pointer).toEqual({ x: 20 + 90 - 6 / zoom, y: 30 });
  },
);
it("holds a target to the release threshold and bypasses it without changing the raw input", () => {
  const g = capture(),
    index = buildSnapIndex(g);
  const initial = solveMoveSnapping(g, index, { x: 110, y: 30 }, { zoom: 1 });
  expect(
    solveMoveSnapping(
      g,
      index,
      { x: 102, y: 30 },
      { zoom: 1, state: initial.state },
    ).pointer.x,
  ).toBe(110);
  expect(
    solveMoveSnapping(g, index, { x: 102, y: 30 }, { zoom: 1 }).pointer.x,
  ).toBe(102);
  expect(
    solveMoveSnapping(
      g,
      index,
      { x: 100, y: 30 },
      { zoom: 1, state: initial.state },
    ).pointer.x,
  ).toBe(100);
  expect(
    solveMoveSnapping(
      g,
      index,
      { x: 105, y: 30 },
      { zoom: 1, bypass: true, state: initial.state },
    ),
  ).toMatchObject({ pointer: { x: 105, y: 30 }, guides: [], state: {} });
  expect(
    solveMoveSnapping(g, index, g.startPointer, { zoom: 1 }),
  ).toMatchObject({ pointer: g.startPointer, guides: [], state: {} });
});
it("prefers an explicit guide and breaks equal object ties by stable ID, not document order", () => {
  const g = capture([
    node("source", 10, 20),
    node("z", 200),
    node("a", 200, 200),
  ]);
  expect(
    solveMoveSnapping(
      g,
      buildSnapIndex(g),
      { x: 108, y: 30 },
      { zoom: 1 },
    ).guides.find((line) => line.axis === "x")?.nodeId,
  ).toBe("a");
  const guide = solveMoveSnapping(
    g,
    buildSnapIndex(g, { guides: [{ id: "g", axis: "x", position: 203 }] }),
    { x: 108, y: 30 },
    { zoom: 1 },
  );
  expect(guide.pointer.x).toBe(113);
  expect(guide.guides.find((line) => line.axis === "x")?.kind).toBe("guide");
});
it("excludes moving descendants and hidden subtrees but keeps locked objects as targets", () => {
  const parent = node("source", 10, 20);
  parent.slots.content = [node("moving-child", 5, 5, 20, 20)];
  const hidden = node("hidden", 200);
  hidden.hidden = true;
  hidden.slots.content = [node("hidden-child", 0)];
  const g = capture([parent, hidden]),
    index = buildSnapIndex(g);
  expect(index.x).toHaveLength(0);
  expect(
    solveMoveSnapping(g, index, { x: 23, y: 30 }, { zoom: 1 }).pointer.x,
  ).toBe(23);
  const locked = node("constructor", 200);
  locked.locked = true;
  const other = capture([parent, locked]);
  expect(
    solveMoveSnapping(
      other,
      buildSnapIndex(other),
      { x: 105, y: 30 },
      { zoom: 1 },
    ).pointer.x,
  ).toBe(110);
});
it("snaps a multi-root union once and preserves actual world movement under a rotated parent", () => {
  const multi = capture(
    [
      node("a", 0, 0, 20, 20),
      node("b", 50, 0, 20, 20),
      node("target", 100, 100, 10, 10),
    ],
    ["a", "b"],
    { x: 0, y: 0 },
  );
  const result = solveMoveSnapping(
    multi,
    buildSnapIndex(multi),
    { x: 25, y: 0 },
    { zoom: 1 },
  );
  expect(result.pointer.x).toBe(30);
  const operations = updateTransformGesture(multi, result.pointer);
  expect(
    operations.valid && operations.operations.map((op) => op.geometry.x),
  ).toEqual([30, 80]);
  const parent = node("parent", 100, 0);
  parent.scene!.rotation = 90;
  parent.slots.content = [node("child", 0, 0, 20, 10)];
  const g = capture([parent, node("target", 200, 150, 50, 50)], ["child"], {
    x: 95,
    y: 10,
  });
  const snapped = solveMoveSnapping(
    g,
    buildSnapIndex(g),
    { x: 189, y: 10 },
    { zoom: 1 },
  );
  expect(snapped.pointer.x).toBeCloseTo(195);
  const moved = updateTransformGesture(g, snapped.pointer);
  expect(moved.valid).toBe(true);
  if (!moved.valid) return;
  expect(moved.operations[0].geometry.x).toBeCloseTo(0);
  expect(moved.operations[0].geometry.y).toBeCloseTo(-100);
});
it("rejects a stale capture and invalid input while keeping indexes and states immutable", () => {
  const g = capture(),
    index = buildSnapIndex(g),
    before = JSON.stringify(index);
  const state = { x: { targetId: "nonexistent", feature: "end" as const } };
  solveMoveSnapping(g, index, { x: 105, y: 30 }, { zoom: 1, state });
  expect(JSON.stringify(index)).toBe(before);
  expect(state.x.targetId).toBe("nonexistent");
  expect(Object.isFrozen(index.x)).toBe(true);
  expect(() =>
    solveMoveSnapping(capture(), index, { x: 105, y: 30 }, { zoom: 1 }),
  ).toThrow("SNAP_SNAPSHOT_MISMATCH");
  for (const zoom of [NaN, Infinity, 0, -1])
    expect(() =>
      solveMoveSnapping(g, index, { x: 105, y: 30 }, { zoom }),
    ).toThrow("INVALID_SNAP_INPUT");
  expect(() =>
    solveMoveSnapping(g, index, { x: NaN, y: 30 }, { zoom: 1 }),
  ).toThrow("INVALID_SNAP_INPUT");
});

it("rejects malformed guide inputs instead of turning them into uncontrolled targets", () => {
  const g = capture();
  for (const guides of [
    null,
    {},
    [null],
    [{ id: "g", axis: "z", position: 0 }],
    [{ id: "g", axis: "x", position: Infinity }],
    [
      { id: "g", axis: "x", position: 0 },
      { id: "g", axis: "y", position: 1 },
    ],
  ]) {
    expect(() => buildSnapIndex(g, { guides: guides as never })).toThrow(
      "INVALID_SNAP_INPUT",
    );
  }
});
