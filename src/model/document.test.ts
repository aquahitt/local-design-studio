import { describe, expect, it } from "vitest";
import { demo } from "../demo/document";
import { parseScreen } from "./document";
describe("screen", () => {
  it("accepts the fixture", () => expect(parseScreen(demo)).toEqual(demo));
  it("rejects unknown schema", () => {
    expect(() => parseScreen({ ...demo, schemaVersion: 2 })).toThrow();
  });
  it("rejects duplicate nested ID", () => {
    const doc = structuredClone(demo);
    doc.nodes[0].slots.content[0].id = "layout";
    expect(() => parseScreen(doc)).toThrow("INVALID_NODE_ID");
  });
  it("rejects executable property", () => {
    const doc = structuredClone(demo);
    doc.nodes[0].slots.content[0].slots.content[1].props.script = "alert(1)";
    expect(() => parseScreen(doc)).toThrow("UNKNOWN_FIELD");
  });
});
