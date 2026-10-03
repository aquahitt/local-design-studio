import { expect, it } from "vitest";
import { selectedId } from "./selection";
it("uses stable root ID", () => {
  expect(selectedId({ selectedItem: { props: { id: "layout" } } })).toBe(
    "layout",
  );
});
it("uses stable nested ID", () => {
  expect(selectedId({ selectedItem: { props: { id: "note" } } })).toBe("note");
});
it("clears missing selection", () => {
  expect(selectedId({ selectedItem: null })).toBeNull();
});
