import { validateProjectFont, type ProjectFont } from "../core/fonts";
import { readImageAsset } from "./image-assets";
import { readFontAsset } from "./font-assets";

const mediaTypes: Record<string, string> = {
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};
/** Only canonical immutable project filenames, never arbitrary document paths. */
export function projectAssetMediaType(name: string): string | undefined {
  const match = /^[a-f0-9]{64}\.(png|svg|ttf|otf|woff|woff2)$/.exec(name);
  return match ? mediaTypes[match[1]] : undefined;
}
export function isProjectAssetPath(path: string): boolean {
  return (
    path.startsWith("/assets/") &&
    projectAssetMediaType(path.slice(8)) !== undefined
  );
}
/** Query metadata chooses a face validation contract, never a filesystem path.
 * Proposal previews can request a face not present in the canonical document yet.
 */
export function requestedFontFace(
  name: string,
  search: string,
): ProjectFont | undefined {
  if (!search || !projectAssetMediaType(name)?.startsWith("font/")) return;
  const invalid = (): never => {
    throw new Error("INVALID_FONT_FACE");
  };
  if (search.length > 4096) invalid();
  const params = new URLSearchParams(search);
  if (
    [...params.keys()].some((key) => key !== "face") ||
    params.getAll("face").length !== 1
  )
    invalid();
  const value = params.get("face");
  if (
    !value ||
    value.length > 512 ||
    !projectAssetMediaType(name)?.startsWith("font/")
  )
    invalid();
  try {
    const parts: unknown = JSON.parse(value!);
    if (!Array.isArray(parts) || parts.length !== 5) return invalid();
    const font = validateProjectFont({
      id: "requested",
      name: "Requested font",
      assetHash: parts[0],
      format: parts[1],
      family: parts[2],
      weight: parts[3],
      style: parts[4],
    });
    if (`${font.assetHash}.${font.format}` !== name) return invalid();
    return font;
  } catch {
    return invalid();
  }
}
export async function readProjectAsset(
  root: string,
  name: string,
  fonts?: readonly ProjectFont[],
  requested?: ProjectFont,
): Promise<Buffer> {
  const mediaType = projectAssetMediaType(name);
  if (!mediaType) throw new Error("INVALID_ASSET_NAME");
  return mediaType.startsWith("font/")
    ? readFontAsset(root, name, requested ? [requested] : fonts)
    : readImageAsset(root, name);
}
