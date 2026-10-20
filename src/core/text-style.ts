import { CoreError } from "./tokens";
import { FONT_ID_PATTERN, projectFontFamily } from "./fonts";
export type TextStyle = {
  fontId?: string;
  /** Explicit CSS pixels, never a unitless multiplier. */
  lineHeight?: number;
  letterSpacing?: number;
  align?: "start" | "center" | "end" | "justify";
  direction?: "ltr" | "rtl" | "auto";
};
export function validateTextStyle(
  value: unknown,
  path = "textStyle",
): TextStyle {
  const fail = (field = ""): never => {
    const p = field ? `${path}.${field}` : path;
    throw new CoreError("INVALID_TEXT_STYLE", p, p);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v))
    if (
      !["fontId", "lineHeight", "letterSpacing", "align", "direction"].includes(
        key,
      )
    )
      fail(key);
  if (
    v.fontId !== undefined &&
    (typeof v.fontId !== "string" || !FONT_ID_PATTERN.test(v.fontId))
  )
    fail("fontId");
  for (const key of ["lineHeight", "letterSpacing"])
    if (
      v[key] !== undefined &&
      (typeof v[key] !== "number" ||
        !Number.isFinite(v[key]) ||
        Math.abs(v[key] as number) > 1_000_000 ||
        (key === "lineHeight" && (v[key] as number) <= 0))
    )
      fail(key);
  if (
    v.align !== undefined &&
    !["start", "center", "end", "justify"].includes(v.align as string)
  )
    fail("align");
  if (
    v.direction !== undefined &&
    !["ltr", "rtl", "auto"].includes(v.direction as string)
  )
    fail("direction");
  return v as TextStyle;
}

/** Shared whole-layer typography for preview and portable React handoff. */
export function compileTextStyle(
  scene: import("./scene").SceneMetadata,
  project: Pick<import("./project").Project, "fonts">,
): Record<string, string | number> {
  const style = scene.textStyle;
  const font = project.fonts?.find((font) => font.id === style?.fontId);
  return {
    fontSize: scene.fontSize ?? 16,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    lineHeight: style?.lineHeight === undefined ? 1.4 : `${style.lineHeight}px`,
    ...(style?.letterSpacing === undefined
      ? {}
      : { letterSpacing: style.letterSpacing }),
    ...(style?.align === undefined ? {} : { textAlign: style.align }),
    ...(style?.direction === undefined
      ? {}
      : style.direction === "auto"
        ? { unicodeBidi: "plaintext" }
        : { direction: style.direction }),
    ...(font
      ? {
          fontFamily: projectFontFamily(font),
          fontWeight: font.weight,
          fontStyle: font.style,
          fontSynthesis: "none",
        }
      : {}),
  };
}
/** Input must already be materialized; hidden ancestors suppress all descendant faces. */
export function usedTextFontIds(
  nodes: import("./project").ProjectNode[],
): string[] {
  const ids = new Set<string>();
  const walk = (rows: import("./project").ProjectNode[]) => {
    for (const node of rows) {
      if (node.hidden) continue;
      if (node.scene?.kind === "text" && node.scene.textStyle?.fontId)
        ids.add(node.scene.textStyle.fontId);
      for (const children of Object.values(node.slots)) walk(children);
    }
  };
  walk(nodes);
  return [...ids];
}
