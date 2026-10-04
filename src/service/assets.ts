import { syncDirectory } from "../core/durability";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
const elements = new Set([
  "svg",
  "g",
  "rect",
  "path",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "title",
  "desc",
]);
const attributes = new Set([
  "xmlns",
  "id",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "rx",
  "ry",
  "cx",
  "cy",
  "r",
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "transform",
  "font-size",
  "font-family",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "x1",
  "x2",
  "y1",
  "y2",
  "fx",
  "fy",
  "preserveAspectRatio",
  "role",
  "aria-label",
]);
export function validateSVG(svg: string): void {
  if (typeof svg !== "string") throw new Error("UNSAFE_SVG");
  if (Buffer.byteLength(svg) > 262144) throw new Error("ASSET_TOO_LARGE");
  if (/[&\u0000]|<!|<\?/.test(svg)) throw new Error("UNSAFE_SVG");
  const stack: string[] = [];
  let cursor = 0,
    roots = 0;
  for (const match of svg.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)\b([^<>]*)>/g)) {
    const text = svg.slice(cursor, match.index);
    if (/[<>]/.test(text) || (!stack.length && text.trim()))
      throw new Error("UNSAFE_SVG");
    cursor = match.index! + match[0].length;
    const tag = match[1];
    if (!elements.has(tag)) throw new Error("UNSAFE_SVG");
    if (match[0].startsWith("</")) {
      if (match[2].trim() || stack.pop() !== tag) throw new Error("UNSAFE_SVG");
      continue;
    }
    if (!stack.length) {
      if (tag !== "svg" || roots++) throw new Error("UNSAFE_SVG");
    }
    const selfClosing = /\/\s*$/.test(match[2]);
    let rest = match[2].replace(/\/\s*$/, "");
    const seen = new Set<string>();
    while (rest.trim()) {
      const attribute = rest.match(
        /^\s+([A-Za-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/,
      );
      if (!attribute) throw new Error("UNSAFE_SVG");
      const name = attribute[1],
        value = attribute[2] ?? attribute[3];
      if (!attributes.has(name) || seen.has(name) || /[<>]/.test(value))
        throw new Error("UNSAFE_SVG");
      seen.add(name);
      rest = rest.slice(attribute[0].length);
      if (name === "xmlns" && value !== "http://www.w3.org/2000/svg")
        throw new Error("UNSAFE_SVG");
      if (
        /(?:javascript|data:|https?:|file:|expression|@import)/i.test(value) &&
        name !== "xmlns"
      )
        throw new Error("UNSAFE_SVG");
      if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z][\w-]*\)$/.test(value))
        throw new Error("UNSAFE_SVG");
    }
    if (!selfClosing) stack.push(tag);
  }
  if (!roots || stack.length || svg.slice(cursor).trim())
    throw new Error("UNSAFE_SVG");
}
async function regular(path: string, allowMissing = false) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error("UNSAFE_SYMLINK");
    return stat;
  } catch (e) {
    if (allowMissing && (e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
export async function writeSVGAsset(
  root: string,
  svg: string,
): Promise<{ path: string }> {
  validateSVG(svg);
  await regular(root);
  const directory = join(root, "assets");
  await regular(directory, true);
  await mkdir(directory, { recursive: true });
  const name = createHash("sha256").update(svg).digest("hex") + ".svg",
    path = join(directory, name);
  await regular(path, true);
  const temp = join(directory, "." + randomUUID() + ".tmp");
  let renamed = false;
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(svg);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
    renamed = true;
    await syncDirectory(directory);
  } finally {
    if (!renamed) await unlink(temp).catch(() => {});
  }
  return { path: "assets/" + name };
}
export async function readSVGAsset(
  root: string,
  name: string,
): Promise<Buffer> {
  if (!/^[a-f0-9]{64}\.svg$/.test(name)) throw new Error("INVALID_ASSET_NAME");
  await regular(root);
  await regular(join(root, "assets"));
  const path = join(root, "assets", name);
  const stat = await regular(path);
  if (!stat?.isFile()) throw new Error("INVALID_ASSET");
  if (stat.size > 262144) throw new Error("ASSET_TOO_LARGE");
  const bytes = await readFile(path);
  validateSVG(bytes.toString());
  if (createHash("sha256").update(bytes).digest("hex") + ".svg" !== name)
    throw new Error("ASSET_HASH_MISMATCH");
  return bytes;
}
