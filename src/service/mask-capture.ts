import { CoreError } from "../core/project";
export const MASK_CAPTURE_CODES = [
  "MASK_SOURCE_UNSUPPORTED",
  "MASK_SOURCE_LIMIT",
  "MASK_IMAGE_UNAVAILABLE",
  "MASK_RENDER_UNAVAILABLE",
] as const;
export type MaskCaptureCode = (typeof MASK_CAPTURE_CODES)[number];
export const maskResourceWarningsExpression = `(()=>{try{return JSON.parse(document.documentElement.dataset.studioPreviewMaskWarnings??'[]')}catch{return null}})()`;
export function assertMaskResourcesReady(
  warnings: unknown,
  maskIds: readonly string[],
  nodeIds: readonly string[],
): void {
  if (!Array.isArray(warnings) || warnings.length > 1000)
    throw new CoreError("MASK_RENDER_UNAVAILABLE");
  const masks = new Set(maskIds),
    nodes = new Set(nodeIds);
  for (const warning of warnings) {
    if (
      !warning ||
      typeof warning !== "object" ||
      Object.keys(warning).some(
        (key) => !["maskId", "code", "nodeId", "feature"].includes(key),
      ) ||
      typeof warning.maskId !== "string" ||
      !masks.has(warning.maskId) ||
      !MASK_CAPTURE_CODES.includes(warning.code) ||
      typeof warning.feature !== "string" ||
      !/^[a-z-]{1,80}$/.test(warning.feature) ||
      (warning.nodeId !== undefined &&
        (typeof warning.nodeId !== "string" || !nodes.has(warning.nodeId)))
    )
      throw new CoreError("MASK_RENDER_UNAVAILABLE");
  }
  if (warnings.length) throw new CoreError(warnings[0].code);
}
