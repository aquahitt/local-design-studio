import { useEffect } from "react";
export interface StudioCommand {
  id: string;
  shortcut?: string;
  label?: string;
  run: () => void | Promise<void>;
  enabled?: () => boolean;
  allowInEditable?: boolean;
}
type ShortcutEvent = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "defaultPrevented"
  | "isComposing"
  | "repeat"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
  | "preventDefault"
> & { target: unknown };
const mac = (platform: string) => /Mac|iPhone|iPad/.test(platform);
export function isEditableTarget(target: unknown): boolean {
  return Boolean(
    (target as Element | null)?.closest?.(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    ),
  );
}
export function dispatchShortcut(
  event: ShortcutEvent,
  commands: StudioCommand[],
  platform: string,
): string | undefined {
  if (event.defaultPrevented || event.isComposing || event.repeat) return;
  for (const command of commands) {
    if (
      !command.shortcut ||
      command.enabled?.() === false ||
      (!command.allowInEditable && isEditableTarget(event.target))
    )
      continue;
    const parts = command.shortcut.split("+");
    const key = parts.at(-1)!;
    const mod = parts.includes("Mod");
    if (
      event.metaKey !== (parts.includes("Meta") || (mod && mac(platform))) ||
      event.ctrlKey !== (parts.includes("Ctrl") || (mod && !mac(platform))) ||
      event.altKey !== parts.includes("Alt") ||
      event.shiftKey !== parts.includes("Shift")
    )
      continue;
    const physical = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    if (
      event.key.toLowerCase() !== key.toLowerCase() &&
      event.code.toLowerCase() !== physical.toLowerCase()
    )
      continue;
    event.preventDefault();
    void command.run();
    return command.id;
  }
}
export function shortcutLabel(shortcut: string, platform: string): string {
  return mac(platform)
    ? shortcut
        .replace("Mod+", "⌘")
        .replace("Shift+", "⇧")
        .replace("Alt+", "⌥")
        .replace("Ctrl+", "⌃")
    : shortcut.replace("Mod+", "Ctrl+");
}
export function useStudioShortcuts(commands: StudioCommand[]): void {
  useEffect(() => {
    const handle = (event: KeyboardEvent) =>
      dispatchShortcut(event, commands, navigator.platform);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [commands]);
}
/** Capture before opening a dialog; cleanup restores the invoker after unmount. */
export function restoreFocusOnClose(document: Document): () => void {
  const invoker = document.activeElement as HTMLElement | null;
  return () => {
    if (invoker?.isConnected) invoker.focus();
  };
}
