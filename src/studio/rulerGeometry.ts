/** Overlay measurements are CSS screen pixels, independent of document zoom. */
export const RULER_THICKNESS = 24;
export const RULER_MAX_TICKS = 512;
export type RulerTick = {
  value: number;
  position: number;
  major: boolean;
  label?: string;
};

/** Smallest 1/2/5 × 10^n interval at least target. */
export function niceRulerStep(target: number): number {
  if (!Number.isFinite(target) || target <= 0) return NaN;
  const power = 10 ** Math.floor(Math.log10(target));
  const unit = target / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/** Only visible world-origin ticks; work is bounded by the viewport, never scene extent. */
export function buildRulerTicks({
  zoom,
  pan,
  length,
  start = 0,
}: {
  zoom: number;
  pan: number;
  length: number;
  start?: number;
}): RulerTick[] {
  if (
    ![zoom, pan, length, start].every(Number.isFinite) ||
    zoom < 0.05 ||
    zoom > 16 ||
    length <= 0 ||
    start < 0 ||
    start >= length
  )
    return [];
  const visible = length - start;
  // At most five subdivisions per label, at least 16 screen pixels apart. Huge viewports
  // increase the step before enumerating, so no post-hoc truncation loses an edge.
  const targetMajorPx = Math.max(80, (visible / (RULER_MAX_TICKS - 2)) * 5);
  const majorStep = niceRulerStep(targetMajorPx / zoom);
  // 20-unit labels use 5-unit minor ticks (four subdivisions), not awkward
  // 4-unit ticks. All visible intervals stay in the same 1/2/5 family.
  const subdivisions =
    Number(majorStep.toExponential().split("e")[0]) === 2 ? 4 : 5;
  const step = majorStep / subdivisions;
  if (!Number.isFinite(step) || step <= 0) return [];
  const first = Math.ceil((start - pan) / zoom / step);
  const last = Math.floor((length - pan) / zoom / step);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return [];
  const ticks: RulerTick[] = [];
  for (
    let offset = 0;
    offset <= last - first && offset < RULER_MAX_TICKS;
    offset++
  ) {
    const index = first + offset;
    const value = index === 0 ? 0 : index * step;
    const position = value * zoom + pan;
    if (!Number.isFinite(position) || position < start || position > length)
      continue;
    const major = index % subdivisions === 0;
    ticks.push({
      value,
      position,
      major,
      ...(major ? { label: String(Number(value.toPrecision(12))) } : {}),
    });
  }
  return ticks;
}
