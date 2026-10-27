import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { AFFINE_LIMITS, validateAffineLinear } from "./affine-validation";
import { validateScene, AFFINE_LIMITS as sceneLimits } from "./scene";
const base = { kind: "frame", x: 0, y: 0, width: 100, height: 80 };
it("keeps the legacy affine numerical boundary and scene error contract while sharing limits", () => {
  expect(sceneLimits).toBe(AFFINE_LIMITS);
  for (const matrix of [
    [1, 0, 0, 1],
    [-1, 0, 0.25, 1],
    [1e6, 0, 0, 1e6],
    [1e-6, 0, 0, 1e-6],
    [100, 0, 0, 1e-6],
  ]) {
    expect(() => validateAffineLinear(matrix, "scene")).not.toThrow();
    expect(() =>
      validateScene({ ...base, linearTransform: matrix }, "scene"),
    ).not.toThrow();
  }
  for (const matrix of [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [1e6 + 1, 0, 0, 1],
    [1e-7, 0, 0, 1e-7],
    [1, 0, 0, 1e-9],
    [NaN, 0, 0, 1],
    [1, 0, Infinity, 1],
    [1, 0, 1],
  ]) {
    for (const check of [
      () => validateAffineLinear(matrix, "scene"),
      () => validateScene({ ...base, linearTransform: matrix }, "scene"),
    ]) {
      try {
        check();
        throw new Error("accepted invalid matrix");
      } catch (e) {
        expect(e).toMatchObject({ code: "INVALID_SCENE", path: "scene" });
      }
    }
  }
});
it("has a neutral Node/SSR entry with no paint or scene runtime dependency", async () => {
  const source = readFileSync(
    new URL("./affine-validation.ts", import.meta.url),
    "utf8",
  );
  expect(source).not.toMatch(/from\s+["']\.\/(?:paint|scene)["']/);
  const module = await import("./affine-validation");
  expect(() =>
    module.validateAffineLinear([1, 0.2, 0, 1], "ssr"),
  ).not.toThrow();
});
