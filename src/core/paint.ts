import { validateAffineLinear, AFFINE_LIMITS } from "./affine-validation";
import { CoreError } from "./tokens";

/** Structured sRGB channels. Opacity is separate from the layer's opacity. */
export type RGBA = { r: number; g: number; b: number; a: number };
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
export type PaintBase = {
  id: string;
  enabled?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
};
export type Stop = { offset: number; color: RGBA };
export type ImageMapping =
  | { mode: "cover" | "contain"; anchor: { x: number; y: number } }
  | { mode: "crop" | "tile"; imageToFrame: [number, number, number, number, number, number] };
export type ImagePaint = PaintBase & { kind: "image"; asset: string; mapping: ImageMapping };
export const IMAGE_ASSET_PATTERN = /^assets\/[a-f0-9]{64}\.(png|svg)$/;
export function validateImageMapping(value: unknown, path: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path);
  const mode = (value as { mode?: unknown }).mode;
  if (mode === "cover" || mode === "contain") {
    const mapping = record(value, ["mode", "anchor"], path);
    const anchor = record(mapping.anchor, ["x", "y"], `${path}.anchor`);
    number(anchor.x, `${path}.anchor.x`, 0, 1);
    number(anchor.y, `${path}.anchor.y`, 0, 1);
  } else if (mode === "crop" || mode === "tile") {
    const mapping = record(value, ["mode", "imageToFrame"], path);
    const matrix = mapping.imageToFrame;
    if (!Array.isArray(matrix) || matrix.length !== 6) fail(`${path}.imageToFrame`);
    matrix.forEach((n, i) =>
      number(
        n,
        `${path}.imageToFrame[${i}]`,
        -AFFINE_LIMITS.maxCoefficient,
        AFFINE_LIMITS.maxCoefficient
      )
    );
    validateAffineLinear(matrix.slice(0, 4), `${path}.imageToFrame`);
  } else fail(`${path}.mode`);
}
export type Paint =
  | ImagePaint
  | (PaintBase &
      (
        | { kind: "solid"; color: RGBA }
        | { kind: "linear"; angle: number; stops: Stop[] }
        | {
            kind: "radial";
            center: { x: number; y: number };
            radius: { x: number; y: number };
            stops: Stop[];
          }
      ));
export type Shadow = {
  id: string;
  enabled?: boolean;
  kind: "inner" | "outer";
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: RGBA;
};
export type FramePaint = { kind: string; fills?: Paint[]; shadows?: Shadow[] };

function fail(path: string): never {
  throw new CoreError("INVALID_SCENE", path, path);
}
function record(value: unknown, fields: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path);
  const result = value as Record<string, unknown>;
  const extra = Object.keys(result).find((key) => !fields.includes(key));
  if (extra !== undefined) fail(`${path}.${extra}`);
  return result;
}
function number(
  value: unknown,
  path: string,
  min = -Infinity,
  max = Infinity,
  integer = false
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    fail(path);
  return value;
}
function color(value: unknown, path: string): void {
  const rgba = record(value, ["r", "g", "b", "a"], path);
  for (const channel of ["r", "g", "b"]) number(rgba[channel], `${path}.${channel}`, 0, 255, true);
  number(rgba.a, `${path}.a`, 0, 1);
}
function enabled(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean") fail(path);
}
function stops(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length < 2 || value.length > 64) fail(path);
  let previous = 0;
  value.forEach((value, index) => {
    const at = `${path}[${index}]`,
      stop = record(value, ["offset", "color"], at);
    previous = number(stop.offset, `${at}.offset`, previous, 1);
    color(stop.color, `${at}.color`);
  });
}
function list(
  value: unknown,
  path: string,
  max: number,
  validate: (value: unknown, path: string) => void
): void {
  if (!Array.isArray(value) || value.length > max) fail(path);
  const ids = new Set<string>();
  value.forEach((value, index) => {
    const at = `${path}[${index}]`;
    validate(value, at);
    const id = (value as { id: unknown }).id;
    if (typeof id !== "string" || !id.length || ids.has(id)) fail(`${at}.id`);
    ids.add(id);
  });
}
/** Validate the paint extension of an otherwise validated scene, without mutation. */
export function validateFramePaint(
  scene: { kind?: unknown; fills?: unknown; shadows?: unknown },
  path: string
): void {
  if (scene.fills === undefined && scene.shadows === undefined) return;
  if (scene.kind !== "frame") fail(`${path}.${scene.fills !== undefined ? "fills" : "shadows"}`);
  if (scene.fills !== undefined)
    list(scene.fills, `${path}.fills`, 16, (value, at) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail(at);
      const kind = (value as { kind: unknown }).kind;
      const fields = [
        "id",
        "kind",
        "enabled",
        "opacity",
        "blendMode",
        ...(kind === "solid"
          ? ["color"]
          : kind === "linear"
            ? ["angle", "stops"]
            : kind === "radial"
              ? ["center", "radius", "stops"]
              : kind === "image"
                ? ["asset", "mapping"]
                : []),
      ];
      const paint = record(value, fields, at);
      enabled(paint.enabled, `${at}.enabled`);
      if (paint.opacity !== undefined) number(paint.opacity, `${at}.opacity`, 0, 1);
      if (paint.blendMode !== undefined && !BLEND_MODES.includes(paint.blendMode as BlendMode))
        fail(`${at}.blendMode`);
      if (kind === "solid") color(paint.color, `${at}.color`);
      else if (kind === "linear") {
        number(paint.angle, `${at}.angle`);
        stops(paint.stops, `${at}.stops`);
      } else if (kind === "radial") {
        const center = record(paint.center, ["x", "y"], `${at}.center`);
        const radius = record(paint.radius, ["x", "y"], `${at}.radius`);
        for (const axis of ["x", "y"]) {
          number(center[axis], `${at}.center.${axis}`, 0, 1);
          if (number(radius[axis], `${at}.radius.${axis}`, 0, 4) === 0)
            fail(`${at}.radius.${axis}`);
        }
        stops(paint.stops, `${at}.stops`);
      } else if (kind === "image") {
        if (typeof paint.asset !== "string" || !IMAGE_ASSET_PATTERN.test(paint.asset))
          fail(`${at}.asset`);
        validateImageMapping(paint.mapping, `${at}.mapping`);
      } else fail(`${at}.kind`);
    });
  if (scene.shadows !== undefined)
    list(scene.shadows, `${path}.shadows`, 8, (value, at) => {
      const shadow = record(
        value,
        ["id", "enabled", "kind", "x", "y", "blur", "spread", "color"],
        at
      );
      if (shadow.kind !== "inner" && shadow.kind !== "outer") fail(`${at}.kind`);
      enabled(shadow.enabled, `${at}.enabled`);
      for (const key of ["x", "y", "spread"]) number(shadow[key], `${at}.${key}`, -4096, 4096);
      number(shadow.blur, `${at}.blur`, 0, 4096);
      color(shadow.color, `${at}.color`);
    });
}
function rgba(color: RGBA, opacity = 1): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a * opacity})`;
}
export function compilePaintGradient(paint: Exclude<Paint, ImagePaint>): string {
  const opacity = paint.opacity ?? 1;
  if (paint.kind === "solid") {
    const color = rgba(paint.color, opacity);
    return `linear-gradient(${color}, ${color})`;
  }
  const stops = paint.stops
    .map((stop) => `${rgba(stop.color, opacity)} ${stop.offset * 100}%`)
    .join(", ");
  if (paint.kind === "linear") {
    // Reduce before CSS parsing: browsers clamp huge angles before painting.
    const remainder = paint.angle % 360;
    const normalized = remainder < 0 ? remainder + 360 : remainder;
    const angle = normalized === 360 || normalized === 0 ? 0 : normalized;
    return `linear-gradient(${angle}deg, ${stops})`;
  }
  return `radial-gradient(ellipse ${paint.radius.x * 100}% ${paint.radius.y * 100}% at ${paint.center.x * 100}% ${paint.center.y * 100}%, ${stops})`;
}
/** Layer zero is the top CSS background; no document strings are interpreted as CSS. */
export function compileFramePaint(scene: FramePaint): Record<string, string> {
  validateFramePaint(scene, "scene");
  const style: Record<string, string> = {};
  if (scene.fills !== undefined) {
    const fills = scene.fills.filter(
      (paint): paint is Exclude<Paint, ImagePaint> =>
        paint.enabled !== false && paint.kind !== "image"
    );
    style.backgroundColor = "transparent";
    style.backgroundImage =
      !hasLayeredFramePaint(scene) && fills.length
        ? fills.map(compilePaintGradient).join(", ")
        : "none";
    style.backgroundBlendMode =
      !hasLayeredFramePaint(scene) && fills.length
        ? fills.map((paint) => paint.blendMode ?? "normal").join(", ")
        : "normal";
  }
  const shadows =
    scene.shadows?.filter(
      (shadow) =>
        shadow.enabled !== false && (!hasLayeredFramePaint(scene) || shadow.kind === "outer")
    ) ?? [];
  if (shadows.length)
    style.boxShadow = shadows
      .map(
        (shadow) =>
          `${shadow.kind === "inner" ? "inset " : ""}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${rgba(shadow.color)}`
      )
      .join(", ");
  return style;
}

export function hasLayeredFramePaint(scene: FramePaint): boolean {
  return (
    scene.kind === "frame" && !!scene.fills?.some((p) => p.kind === "image" && p.enabled !== false)
  );
}
export function compileFrameInsetEffects(
  scene: FramePaint & { stroke?: string; strokeWidth?: number }
): Record<string, string> {
  const effects: string[] = [];
  if (scene.stroke)
    effects.push(`inset 0 0 0 ${scene.strokeWidth ?? 1}px ${scene.stroke}`);
  for (const shadow of scene.shadows ?? [])
    if (shadow.enabled !== false && shadow.kind === "inner")
      effects.push(
        `inset ${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${rgba(shadow.color)}`
      );
  return effects.length ? { boxShadow: effects.join(", ") } : {};
}
