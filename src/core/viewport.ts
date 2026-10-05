import { CoreError } from "./tokens";
export type SafeArea = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export type DeviceViewport = {
  preset: string;
  orientation: "portrait" | "landscape";
  cutout: "none" | "pill" | "notch";
  safeArea: SafeArea;
};
export type Viewport = {
  width: number;
  height?: number;
  device?: DeviceViewport;
};
export const VIEWPORT_LIMITS = {
  width: { min: 320, max: 3840 },
  height: { min: 240, max: 3840 },
  inset: { min: 0, max: 240 },
};
function record(input: unknown, fields: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CoreError("INVALID_VIEWPORT");
  if (Object.keys(input).some((k) => !fields.includes(k)))
    throw new CoreError("UNKNOWN_FIELD");
  return input as Record<string, unknown>;
}
function integer(input: unknown, min: number, max: number): number {
  if (
    !Number.isInteger(input) ||
    (input as number) < min ||
    (input as number) > max
  )
    throw new CoreError("INVALID_VIEWPORT");
  return input as number;
}
export function parseViewport(input: unknown): Viewport {
  const value = record(input, ["width", "height", "device"]);
  const result: Viewport = { width: integer(value.width, 320, 3840) };
  if ("height" in value) result.height = integer(value.height, 240, 3840);
  if ("device" in value) {
    const device = record(value.device, [
      "preset",
      "orientation",
      "cutout",
      "safeArea",
    ]);
    if (
      !result.height ||
      typeof device.preset !== "string" ||
      !device.preset ||
      device.preset.length > 100 ||
      typeof device.orientation !== "string" ||
      !["portrait", "landscape"].includes(device.orientation) ||
      typeof device.cutout !== "string" ||
      !["none", "pill", "notch"].includes(device.cutout)
    )
      throw new CoreError("INVALID_VIEWPORT");
    const raw = record(device.safeArea, ["top", "right", "bottom", "left"]);
    const safeArea = Object.fromEntries(
      ["top", "right", "bottom", "left"].map((k) => [
        k,
        integer(raw[k], 0, 240),
      ]),
    ) as SafeArea;
    if (
      result.width - safeArea.left - safeArea.right < 120 ||
      result.height - safeArea.top - safeArea.bottom < 120
    )
      throw new CoreError("INVALID_VIEWPORT");
    result.device = {
      preset: device.preset,
      orientation: device.orientation as DeviceViewport["orientation"],
      cutout: device.cutout as DeviceViewport["cutout"],
      safeArea,
    };
  }
  return result;
}
export function contentViewport(viewport: Viewport, fallbackHeight = 850) {
  const area = viewport.device?.safeArea ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  return {
    width: viewport.width - area.left - area.right,
    height: (viewport.height ?? fallbackHeight) - area.top - area.bottom,
  };
}
