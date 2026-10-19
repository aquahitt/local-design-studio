import { describe, expect, it } from "vitest";
import { fitCanvasBounds, readCanvasView, zoomCanvasAt } from "./canvasCamera";
describe("canvas camera", () => {
  it("preserves world point under cursor and clamps zoom", () => {
    const view = { zoom: 2, panX: 40, panY: -10 };
    const p = { x: 200, y: 90 };
    const next = zoomCanvasAt(view, p, 100);
    expect(next.zoom).toBe(16);
    expect((p.x - next.panX) / next.zoom).toBe((p.x - view.panX) / view.zoom);
    expect((p.y - next.panY) / next.zoom).toBe((p.y - view.panY) / view.zoom);
  });
  it("fits negative coordinates with padding", () => {
    const v = fitCanvasBounds(
      [{ id: "a", x: -400, y: -200, width: 800, height: 400 }],
      { width: 1000, height: 600 },
    );
    expect(v.zoom).toBeCloseTo(1.13);
    expect(v.panX).toBe(500);
    expect(v.panY).toBe(300);
  });
  it("rejects invalid persisted preferences", () => {
    expect(
      readCanvasView('{"version":1,"zoom":1,"panX":null,"panY":0}'),
    ).toBeNull();
    expect(
      readCanvasView('{"version":1,"zoom":20,"panX":0,"panY":0}'),
    ).toBeNull();
    expect(readCanvasView('{"version":1,"zoom":1,"panX":2,"panY":3}')).toEqual({
      zoom: 1,
      panX: 2,
      panY: 3,
    });
  });
});
