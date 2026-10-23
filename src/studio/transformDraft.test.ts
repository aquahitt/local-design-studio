import { describe, expect, it } from "vitest";
import {
  parseTransformNumber,
  linkedTransformValues,
  transformSnapshotMatches,
  transformSelectionMatches,
} from "./transformDraft";
describe("transform numeric drafts", () => {
  it("preserves incomplete and nonfinite values instead of coercing empty input to zero", () => {
    for (const raw of [
      "",
      " ",
      "-",
      "+",
      "1e",
      "Infinity",
      "0x10",
      "NaN",
      "1,5",
    ])
      expect(parseTransformNumber(raw)).toBeUndefined();
    expect(parseTransformNumber("-1.25e2")).toBe(-125);
    expect(parseTransformNumber(" .5 ")).toBe(0.5);
  });
  it("links sizes using the captured aspect ratio, keeping invalid drafts untouched", () => {
    expect(
      linkedTransformValues("width", "300", { width: 200, height: 100 }),
    ).toEqual({ width: "300", height: "150" });
    expect(
      linkedTransformValues("height", "-", { width: 200, height: 100 }),
    ).toEqual({ height: "-" });
  });
  it("requires the same project, revision, page and selection without treating order as a change", () => {
    const snapshot = {
      projectId: "p",
      revision: 2,
      pageId: "a",
      selectedIds: ["x", "y"],
    };
    expect(
      transformSnapshotMatches(snapshot, {
        ...snapshot,
        selectedIds: ["y", "x"],
      }),
    ).toBe(true);
    for (const next of [
      { ...snapshot, revision: 3 },
      { ...snapshot, projectId: "q" },
      { ...snapshot, pageId: "b" },
      { ...snapshot, selectedIds: ["x"] },
    ])
      expect(transformSnapshotMatches(snapshot, next)).toBe(false);
  });
});

it("permits explicit revision rebase only onto the same project, page and selected IDs", () => {
  const captured = {
    projectId: "one",
    pageId: "screen",
    revision: 4,
    selectedIds: ["a", "b"],
  };
  expect(
    transformSelectionMatches(captured, {
      ...captured,
      revision: 9,
      selectedIds: ["b", "a"],
    }),
  ).toBe(true);
  for (const current of [
    { ...captured, projectId: "two" },
    { ...captured, pageId: "other" },
    { ...captured, selectedIds: [] },
    { ...captured, selectedIds: ["a", "c"] },
  ])
    expect(transformSelectionMatches(captured, current)).toBe(false);
  expect(captured.selectedIds).toEqual(["a", "b"]);
});

it("recomputes the linked dimension from the latest captured ratio only at explicit rebase", () => {
  const previous = linkedTransformValues("width", "200", {
    width: 100,
    height: 100,
  });
  expect(previous).toEqual({ width: "200", height: "200" });
  const rebased = {
    ...previous,
    ...linkedTransformValues("width", previous.width!, {
      width: 100,
      height: 200,
    }),
  };
  expect(rebased).toEqual({ width: "200", height: "400" });
  expect(previous).toEqual({ width: "200", height: "200" });
  expect(
    linkedTransformValues("height", "300", { width: 100, height: 200 }),
  ).toEqual({ height: "300", width: "150" });
  expect(
    linkedTransformValues("width", "1e", { width: 100, height: 200 }),
  ).toEqual({ width: "1e" });
});
