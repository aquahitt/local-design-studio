import { expect, it } from "vitest";
import { demo } from "../demo/document";
import { fromPuck, toPuck } from "./bridge";
it("round-trips nested nodes and IDs", () => {
  expect(fromPuck(toPuck(demo), demo)).toEqual(demo);
});
it("preserves IDs after an edited text", () => {
  const data = toPuck(demo);
  const stack = data.content[0].props.content as Array<{
    props: Record<string, unknown>;
  }>;
  const children = stack[0].props.content as Array<{
    props: Record<string, unknown>;
  }>;
  children[1].props.text = "Новый текст";
  const result = fromPuck(data, demo);
  expect(result.nodes[0].slots.content[0].slots.content[1]).toEqual({
    id: "note",
    type: "Text",
    props: { text: "Новый текст" },
    slots: {},
  });
});
