import { describe, expect, test } from "vitest";
import { beginDraft, editDraft, receiveDraft, rebaseDraft } from "./draft";
describe("inspector draft against external revisions", () => {
  test("keeps unsaved text and old base revision when external operation arrives", () => {
    const d = editDraft(beginDraft({ text: "before" }, 3), '{"text":"typing"}');
    const next = receiveDraft(d, { text: "external" }, 4);
    expect(next.value).toBe('{"text":"typing"}');
    expect(next.baseRevision).toBe(3);
    expect(next.conflict).toBe(true);
  });
  test("explicit rebase keeps user input but acknowledges latest revision", () => {
    const d = receiveDraft(
      editDraft(beginDraft({ text: "a" }, 0), "draft"),
      { text: "b" },
      1,
    );
    const next = rebaseDraft(d, 1);
    expect(next.value).toBe("draft");
    expect(next.baseRevision).toBe(1);
    expect(next.conflict).toBe(false);
  });
  test("clean inspector follows external edits", () => {
    const next = receiveDraft(beginDraft({ text: "a" }, 0), { text: "b" }, 1);
    expect(JSON.parse(next.value)).toEqual({ text: "b" });
    expect(next.dirty).toBe(false);
  });
});
