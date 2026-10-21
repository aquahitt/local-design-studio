import { expect, it, vi } from "vitest";
import {
  captureRectangle,
  validatePhysicalCapture,
  withCaptureTimeout,
  settleCaptureExpression,
} from "./capture";
it("limits raster allocation independently of remote world coordinates", () => {
  expect(
    captureRectangle({ x: -1e6, y: 1e6, width: 80.5, height: 60.25 }),
  ).toEqual({ x: 0, y: 0, width: 81, height: 61, scale: 1 });
  for (const bounds of [
    { x: 0, y: 0, width: 8193, height: 1 },
    { x: 0, y: 0, width: 5000, height: 5000 },
  ])
    expect(() => captureRectangle(bounds)).toThrow("RENDER_RASTER_LIMIT");
  for (const width of [NaN, Infinity, 0, -1])
    expect(() => captureRectangle({ x: 0, y: 0, width, height: 1 })).toThrow(
      "NODE_NOT_VISIBLE",
    );
  expect(
    captureRectangle({ x: 0, y: 0, width: 4096, height: 4096 }).width,
  ).toBe(4096);
});

it("times out hung capture work and clears successful timers", async () => {
  vi.useFakeTimers();
  try {
    const result = withCaptureTimeout(new Promise<never>(() => {}));
    const rejection = expect(result).rejects.toThrow("RENDER_TIMEOUT");
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    expect(await withCaptureTimeout(Promise.resolve("ok"))).toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it("finishes finite animations and cancels infinite ones before bounds are measured", async () => {
  const { runInNewContext } = await import("node:vm");
  const finite = {
    effect: { getComputedTiming: () => ({ endTime: 200 }) },
    finish: vi.fn(),
    pause: vi.fn(),
    cancel: vi.fn(),
  };
  const infinite = {
    ...finite,
    effect: { getComputedTiming: () => ({ endTime: Infinity }) },
    cancel: vi.fn(),
  };
  await runInNewContext(settleCaptureExpression, {
    document: {
      fonts: { ready: Promise.resolve() },
      getAnimations: () => [finite, infinite],
    },
    requestAnimationFrame: (resolve: () => void) => resolve(),
  });
  expect(finite.finish).toHaveBeenCalledOnce();
  expect(finite.pause).toHaveBeenCalledOnce();
  expect(infinite.cancel).toHaveBeenCalledOnce();
  expect(finite.cancel).not.toHaveBeenCalled();
});

it("bounds native allocation before Retina normalization", () => {
  expect(() =>
    validatePhysicalCapture({ width: 4096, height: 4096 }, 2),
  ).not.toThrow();
  for (const ratio of [3, Infinity, NaN, 0, -1])
    expect(() =>
      validatePhysicalCapture({ width: 4096, height: 4096 }, ratio),
    ).toThrow("RENDER_RASTER_LIMIT");
  expect(() =>
    validatePhysicalCapture({ width: 8192, height: 1 }, 2),
  ).not.toThrow();
  expect(() =>
    validatePhysicalCapture({ width: 8192, height: 1 }, 2.1),
  ).toThrow("RENDER_RASTER_LIMIT");
});
