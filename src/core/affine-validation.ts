import { CoreError } from "./tokens";
export const AFFINE_LIMITS = Object.freeze({
  maxCoefficient: 1_000_000,
  minSingularValue: 0.000001,
  maxSingularValue: 1_000_000,
  maxConditionNumber: 100_000_000,
});

/** Shared numerical policy; callers retain their original error path. */
export function validateAffineLinear(
  value: unknown,
  path: string,
): asserts value is [number, number, number, number] {
  const fail = (): never => {
    throw new CoreError("INVALID_SCENE", path, path);
  };
  const linear = value;
  if (
    !Array.isArray(linear) ||
    linear.length !== 4 ||
    linear.some(
      (n) =>
        typeof n !== "number" ||
        !Number.isFinite(n) ||
        Math.abs(n) > AFFINE_LIMITS.maxCoefficient,
    )
  )
    fail();
  const [a, b, c, d] = linear as number[];
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (!scale) fail();
  const na = a / scale,
    nb = b / scale,
    nc = c / scale,
    nd = d / scale;
  // Largest eigenvalue of L^T L, normalized to avoid overflow/underflow.
  const first = na * na + nb * nb,
    second = nc * nc + nd * nd;
  const cross = na * nc + nb * nd;
  const largest = Math.sqrt(
    (first + second + Math.hypot(first - second, 2 * cross)) / 2,
  );
  // Product of singular values is |det L|; subtraction of eigenvalues loses
  // the small singular value precisely where the condition check matters.
  const smallest = Math.abs(na * nd - nb * nc) / largest;
  const epsilon = 16 * Number.EPSILON;
  if (
    smallest * scale < AFFINE_LIMITS.minSingularValue * (1 - epsilon) ||
    largest * scale > AFFINE_LIMITS.maxSingularValue * (1 + epsilon) ||
    largest / smallest > AFFINE_LIMITS.maxConditionNumber * (1 + epsilon)
  )
    fail();
}
