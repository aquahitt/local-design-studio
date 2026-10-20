import { CoreError } from "./tokens";
export type ProjectFont = {
  id: string;
  name: string;
  assetHash: string;
  format: "ttf" | "otf" | "woff" | "woff2";
  family: string;
  weight: number;
  style: "normal" | "italic" | "oblique";
};
export const FONT_LIMITS = { faces: 128, label: 160, id: 100 } as const;
export const FONT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
export function validateProjectFont(
  value: unknown,
  path = "font",
): ProjectFont {
  const fail = (field = ""): never => {
    const p = field ? `${path}.${field}` : path;
    throw new CoreError("INVALID_FONT", p, p);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const f = value as Record<string, unknown>;
  const keys = [
    "id",
    "name",
    "assetHash",
    "format",
    "family",
    "weight",
    "style",
  ];
  for (const key of Object.keys(f)) if (!keys.includes(key)) fail(key);
  if (typeof f.id !== "string" || !FONT_ID_PATTERN.test(f.id)) fail("id");
  for (const key of ["name", "family"]) {
    const v = f[key];
    if (
      typeof v !== "string" ||
      !v.trim() ||
      v !== v.trim() ||
      v.length > FONT_LIMITS.label ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(v)
    )
      fail(key);
  }
  if (typeof f.assetHash !== "string" || !/^[a-f0-9]{64}$/.test(f.assetHash))
    fail("assetHash");
  if (!["ttf", "otf", "woff", "woff2"].includes(f.format as string))
    fail("format");
  if (
    typeof f.weight !== "number" ||
    !Number.isInteger(f.weight) ||
    f.weight < 1 ||
    f.weight > 1000
  )
    fail("weight");
  if (!["normal", "italic", "oblique"].includes(f.style as string))
    fail("style");
  return f as ProjectFont;
}
export function validateProjectFonts(
  value: unknown,
  path = "fonts",
): ProjectFont[] {
  if (!Array.isArray(value) || value.length > FONT_LIMITS.faces)
    throw new CoreError("INVALID_FONTS", path, path);
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const p = `${path}[${index}]`,
      face = validateProjectFont(raw, p);
    if (seen.has(face.id))
      throw new CoreError("DUPLICATE_FONT", `${p}.id`, `${p}.id`);
    seen.add(face.id);
    return face;
  });
}
export function fontAssetPath(font: ProjectFont): string {
  validateProjectFont(font);
  return `assets/${font.assetHash}.${font.format}`;
}
/** Never interpolate human-readable metadata into CSS identifiers. */
export function projectFontFamily(font: ProjectFont): string {
  validateProjectFont(font);
  return `StudioFont_${font.assetHash}_${font.weight}_${font.style}`;
}
