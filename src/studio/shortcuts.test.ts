import { describe, expect, it, vi } from "vitest";
import { dispatchShortcut, shortcutLabel } from "./shortcuts";
const event = (key: string, modifiers = {}, editable = false) => ({
  key,
  code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
  defaultPrevented: false,
  isComposing: false,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: { closest: () => (editable ? {} : null) },
  preventDefault: vi.fn(),
  ...modifiers,
});
describe("studio keyboard commands", () => {
  it("uses Command on macOS and Control elsewhere", () => {
    const run = vi.fn();
    const commands = [{ id: "undo", shortcut: "Mod+Z", run }];
    expect(
      dispatchShortcut(event("z", { metaKey: true }), commands, "MacIntel"),
    ).toBe("undo");
    expect(
      dispatchShortcut(event("z", { ctrlKey: true }), commands, "Linux"),
    ).toBe("undo");
    expect(
      dispatchShortcut(event("z", { ctrlKey: true }), commands, "MacIntel"),
    ).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
    expect(shortcutLabel("Mod+Shift+Z", "MacIntel")).toBe("⌘⇧Z");
  });
  it("does not hijack editable targets, composed input, or previously handled keys", () => {
    const run = vi.fn();
    const commands = [{ id: "delete", shortcut: "Delete", run }];
    expect(
      dispatchShortcut(event("Delete", {}, true), commands, "Linux"),
    ).toBeUndefined();
    expect(
      dispatchShortcut(
        event("Delete", { isComposing: true }),
        commands,
        "Linux",
      ),
    ).toBeUndefined();
    expect(
      dispatchShortcut(
        event("Delete", { defaultPrevented: true }),
        commands,
        "Linux",
      ),
    ).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });
  it("matches exact modifiers and only prevents enabled commands", () => {
    const run = vi.fn();
    const commands = [
      { id: "duplicate", shortcut: "Mod+D", run, enabled: () => false },
    ];
    const e = event("d", { ctrlKey: true });
    expect(dispatchShortcut(e, commands, "Linux")).toBeUndefined();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(
      dispatchShortcut(
        event("d", { ctrlKey: true, altKey: true }),
        [{ ...commands[0], enabled: () => true }],
        "Linux",
      ),
    ).toBeUndefined();
  });
});
it("recognizes physical command keys when the keyboard layout is Russian", () => {
  const run = vi.fn();
  expect(
    dispatchShortcut(
      event("я", { code: "KeyZ", ctrlKey: true }),
      [{ id: "undo", shortcut: "Mod+Z", run }],
      "Linux",
    ),
  ).toBe("undo");
  expect(run).toHaveBeenCalledOnce();
});
