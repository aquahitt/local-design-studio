import { describe, expect, it } from "vitest";
import {
  buildRulerTicks,
  niceRulerStep,
  RULER_MAX_TICKS,
} from "./rulerGeometry";
describe("ruler geometry", () => {
  it("chooses ceiling intervals from 1/2/5 powers of ten", () => {
    expect(
      [0.01, 0.012, 0.03, 1, 1.2, 2, 2.1, 5, 5.1, 1001].map(niceRulerStep),
    ).toEqual([0.01, 0.02, 0.05, 1, 2, 2, 5, 5, 10, 2000]);
  });
  it("anchors tick values at world zero and projects using camera pan and zoom", () => {
    const ticks = buildRulerTicks({ zoom: 2, pan: 113, length: 500 });
    expect(ticks.find((t) => t.value === 0)).toMatchObject({
      position: 113,
      major: true,
      label: "0",
    });
    expect(
      ticks.some((t) => t.value < 0 && t.major && t.label?.startsWith("-")),
    ).toBe(true);
    for (const tick of ticks)
      expect(tick.position).toBeCloseTo(tick.value * 2 + 113, 10);
  });
  it("generates only visible ticks, respecting the corner overlay without shifting origin", () => {
    const ticks = buildRulerTicks({
      zoom: 1,
      pan: 110,
      length: 433,
      start: 24,
    });
    expect(ticks.every((t) => t.position >= 24 && t.position <= 433)).toBe(
      true,
    );
    expect(ticks.find((t) => t.value === 0)?.position).toBe(110);
    const shifted = buildRulerTicks({
      zoom: 1,
      pan: 111,
      length: 433,
      start: 24,
    });
    expect(shifted.find((t) => t.value === 0)?.position).toBe(111);
  });
  it("keeps readable screen spacing at both zoom extremes", () => {
    for (const zoom of [0.05, 0.1, 0.3, 1, 3, 8, 16]) {
      const ticks = buildRulerTicks({ zoom, pan: -380.25, length: 1200 });
      const major = ticks.filter((t) => t.major);
      expect(major.length).toBeGreaterThan(1);
      expect(major[1].position - major[0].position).toBeGreaterThanOrEqual(
        79.999,
      );
      expect(major[1].position - major[0].position).toBeLessThanOrEqual(
        200.001,
      );
      expect(ticks.length).toBeLessThanOrEqual(RULER_MAX_TICKS);
      expect(
        ticks.every(
          (t) => Number.isFinite(t.position) && Number.isFinite(t.value),
        ),
      ).toBe(true);
    }
  });
  it("bounds work for huge visible extents and large negative world coordinates", () => {
    for (const length of [400, 100000, 1e9]) {
      const ticks = buildRulerTicks({ zoom: 0.05, pan: 1e9, length });
      expect(ticks.length).toBeLessThanOrEqual(RULER_MAX_TICKS);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.every((t) => t.position >= 0 && t.position <= length)).toBe(
        true,
      );
      expect(ticks.every((t) => t.label !== "-0")).toBe(true);
    }
  });
  it("returns empty for unmeasured or invalid camera/viewport inputs", () => {
    for (const input of [
      { zoom: 0, pan: 0, length: 10 },
      { zoom: NaN, pan: 0, length: 10 },
      { zoom: 1, pan: Infinity, length: 10 },
      { zoom: 1, pan: 0, length: 0 },
      { zoom: 1, pan: 0, length: -1 },
      { zoom: 1, pan: 0, length: 10, start: 11 },
    ])
      expect(buildRulerTicks(input)).toEqual([]);
  });
});

it("does not promote an exact decimal power because of binary rounding", () => {
  expect(niceRulerStep(1e-4)).toBe(1e-4);
  expect(niceRulerStep(1e-7)).toBe(1e-7);
});

it("keeps minor as well as major intervals in the 1/2/5 family", () => {
  const ticks = buildRulerTicks({ zoom: 0.05, pan: 0, length: 1000 });
  const interval = ticks[1].value - ticks[0].value;
  const normalized = interval / 10 ** Math.floor(Math.log10(interval));
  expect([1, 2, 5]).toContain(normalized);
});
