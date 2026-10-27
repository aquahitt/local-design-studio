import { expect, it } from "vitest";
import {
  createImageMappingGesture,
  updateImageMappingGesture,
  adjustImageMapping,
} from "./imageMappingGesture";
import { transformPoint, type Matrix } from "../core/scene";

it("moves from an immutable UV snapshot without accumulating previews", () => {
  const matrix: Matrix = [120, 30, -10, 80, 4, 8];
  const before = [...matrix];
  const capture = createImageMappingGesture(matrix, {
    tool: "move",
    pointer: { x: 20, y: 20 },
  });
  const still = updateImageMappingGesture(capture, { x: 20, y: 20 });
  expect(still).toMatchObject({ valid: true, changed: false, matrix });
  expect(updateImageMappingGesture(capture, { x: 30, y: 40 })).toMatchObject({
    valid: true,
    changed: true,
    matrix: [120, 30, -10, 80, 14, 28],
  });
  expect(updateImageMappingGesture(capture, { x: 21, y: 22 })).toMatchObject({
    valid: true,
    matrix: [120, 30, -10, 80, 5, 10],
  });
  expect(matrix).toEqual(before);
});

it("scales the source about the opposite corner and keeps its UV size one", () => {
  const matrix: Matrix = [120, 0, 0, 80, 10, 20];
  const capture = createImageMappingGesture(matrix, {
    tool: "scale",
    handle: "se",
    pointer: { x: 130, y: 100 },
  });
  const result = updateImageMappingGesture(
    capture,
    { x: 250, y: 180 },
    { shiftKey: true },
  );
  expect(result).toMatchObject({
    valid: true,
    changed: true,
    matrix: [240, 0, 0, 160, 10, 20],
  });
});

it("uses core rotation snapping and rejects an invalid final position", () => {
  const matrix: Matrix = [120, 0, 0, 80, 10, 20];
  const capture = createImageMappingGesture(matrix, {
    tool: "rotate",
    pointer: { x: 130, y: 60 },
  });
  const result = updateImageMappingGesture(
    capture,
    { x: 70, y: 120 },
    { shiftKey: true },
  );
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  expect(transformPoint({ x: 0.5, y: 0.5 }, result.matrix)).toEqual({
    x: 70,
    y: 60,
  });
  expect(result.matrix[0]).toBeCloseTo(0);
  expect(result.matrix[1]).toBeCloseTo(120);
  expect(updateImageMappingGesture(capture, { x: NaN, y: 1 }).valid).toBe(
    false,
  );
  const scale = createImageMappingGesture(matrix, {
    tool: "scale",
    handle: "se",
    pointer: { x: 130, y: 100 },
  });
  expect(updateImageMappingGesture(scale, { x: 10, y: 20 }).valid).toBe(false);
});

it("preserves reflected and sheared mappings through a neutral gesture", () => {
  const matrix: Matrix = [-120, 20, 15, 80, 140, -8];
  const point = transformPoint({ x: 1, y: 1 }, matrix);
  const capture = createImageMappingGesture(matrix, {
    tool: "scale",
    handle: "se",
    pointer: point,
  });
  expect(updateImageMappingGesture(capture, point)).toMatchObject({
    valid: true,
    changed: false,
    matrix,
  });
});

it("keyboard scale and rotation use the same centered affine geometry", () => {
  const matrix: Matrix = [120, 0, 0, 80, 10, 20];
  const scaled = adjustImageMapping(matrix, { kind: "scale", factor: 2 });
  expect(scaled).toEqual([240, 0, 0, 160, -50, -20]);
  const rotated = adjustImageMapping(scaled, { kind: "rotate", degrees: 90 });
  const center = transformPoint({ x: 0.5, y: 0.5 }, rotated);
  expect(center.x).toBeCloseTo(70, 10);
  expect(center.y).toBeCloseTo(60, 10);
  expect(rotated[1]).toBeCloseTo(240);
  expect(rotated[2]).toBeCloseTo(-160);
  expect(() =>
    adjustImageMapping(matrix, { kind: "scale", factor: 0 }),
  ).toThrow();
  expect(matrix).toEqual([120, 0, 0, 80, 10, 20]);
});
