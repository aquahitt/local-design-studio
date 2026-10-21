import type { Point, SceneView } from "../core/scene";
export type CanvasBounds = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export const clampCanvasZoom = (zoom: number) =>
  Math.max(0.05, Math.min(16, Number.isFinite(zoom) ? zoom : 1));
export function zoomCanvasAt(
  view: SceneView,
  point: Point,
  zoom: number,
): SceneView {
  const next = clampCanvasZoom(zoom);
  return {
    zoom: next,
    panX: point.x - ((point.x - view.panX) / view.zoom) * next,
    panY: point.y - ((point.y - view.panY) / view.zoom) * next,
  };
}
export function fitCanvasBounds(
  bounds: CanvasBounds[],
  size: { width: number; height: number },
  padding = 48,
): SceneView {
  if (!bounds.length) return { zoom: 1, panX: 48, panY: 48 };
  const left = Math.min(...bounds.map((b) => b.x)),
    top = Math.min(...bounds.map((b) => b.y));
  const right = Math.max(...bounds.map((b) => b.x + b.width)),
    bottom = Math.max(...bounds.map((b) => b.y + b.height));
  const zoom = clampCanvasZoom(
    Math.min(
      Math.max(1, size.width - padding * 2) / Math.max(1, right - left),
      Math.max(1, size.height - padding * 2) / Math.max(1, bottom - top),
    ),
  );
  return {
    zoom,
    panX: size.width / 2 - ((left + right) / 2) * zoom,
    panY: size.height / 2 - ((top + bottom) / 2) * zoom,
  };
}
export function readCanvasView(raw: string | null): SceneView | null {
  try {
    const v = JSON.parse(raw ?? "null");
    return v?.version === 1 &&
      [v.zoom, v.panX, v.panY].every(
        (x) => typeof x === "number" && Number.isFinite(x),
      ) &&
      v.zoom >= 0.05 &&
      v.zoom <= 16 &&
      Math.abs(v.panX) <= 1e9 &&
      Math.abs(v.panY) <= 1e9
      ? { zoom: v.zoom, panX: v.panX, panY: v.panY }
      : null;
  } catch {
    return null;
  }
}
export function validCanvasBounds(
  value: unknown,
  allowed: Set<string>,
): value is CanvasBounds[] {
  return (
    Array.isArray(value) &&
    value.length <= 10000 &&
    value.every(
      (b) =>
        b &&
        typeof b === "object" &&
        allowed.has(b.id) &&
        [b.x, b.y, b.width, b.height].every(
          (x) =>
            typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e8,
        ) &&
        b.width >= 0 &&
        b.height >= 0,
    ) &&
    new Set(value.map((b) => b.id)).size === value.length
  );
}
