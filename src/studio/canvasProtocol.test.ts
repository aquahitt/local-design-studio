import { describe, expect, it } from "vitest";
import { validCanvasBounds } from "./canvasCamera";
const box = { id: "saved-node", x: -500, y: 300, width: 200, height: 100 };
const allowed = new Set(["saved-node"]);
describe("canvas geometry message payload", () => {
  it("accepts negative world bounds and an empty geometry snapshot", () => {
    expect(validCanvasBounds([box], allowed)).toBe(true);
    expect(validCanvasBounds([], allowed)).toBe(true);
  });
  it("rejects an oversized list even when every ID and rectangle is individually valid", () => {
    const rows = Array.from({ length: 10001 }, (_, i) => ({
      ...box,
      id: "n" + i,
    }));
    expect(validCanvasBounds(rows, new Set(rows.map((row) => row.id)))).toBe(
      false,
    );
  });
  it.each([
    ["unknown ID", [{ ...box, id: "virtual::not-saved" }]],
    ["duplicate ID", [box, { ...box }]],
    ["NaN", [{ ...box, x: NaN }]],
    ["positive infinity", [{ ...box, width: Infinity }]],
    ["negative infinity", [{ ...box, y: -Infinity }]],
    ["negative width", [{ ...box, width: -1 }]],
    ["negative height", [{ ...box, height: -1 }]],
    ["coordinate above budget", [{ ...box, x: 1e8 + 1 }]],
    ["string coordinate", [{ ...box, y: "1" }]],
    ["null element", [null]],
    ["missing coordinate", [{ id: "saved-node", x: 1, y: 2, width: 5 }]],
    ["array-like object", { 0: box, length: 1 }],
  ])("rejects %s", (_name, value) =>
    expect(validCanvasBounds(value, allowed)).toBe(false),
  );
});
