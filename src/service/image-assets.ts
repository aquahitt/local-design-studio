import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { syncDirectory } from "../core/durability";
import { validateSVG, writeSVGAsset, readSVGAsset } from "./assets";

export const IMAGE_LIMITS = { bytes: 8 * 1024 * 1024, dimension: 8192, pixels: 16_000_000, files: 1000 };
export interface ImageAsset {
  path: string; name: string; mediaType: string; bytes: number;
  width?: number; height?: number; used?: boolean; missing?: boolean;
  archived?: boolean;
}
const fileName = /^[a-f0-9]{64}\.(png|svg)$/;
async function guard(path: string, optional = false) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error("UNSAFE_SYMLINK");
    return info;
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
function crc(bytes: Buffer) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
/** Only passive, non-interlaced 8-bit PNG is accepted after browser normalization. */
export function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length > IMAGE_LIMITS.bytes) throw new Error("ASSET_TOO_LARGE");
  if (bytes.length < 45 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("INVALID_PNG");
  let offset = 8, width = 0, height = 0, channels = 0, ended = false, seenData = false, dataEnded = false;
  const data: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size > IMAGE_LIMITS.bytes || offset + size + 12 > bytes.length) throw new Error("INVALID_PNG");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const value = bytes.subarray(offset + 8, offset + 8 + size);
    if (crc(bytes.subarray(offset + 4, offset + 8 + size)) !== bytes.readUInt32BE(offset + 8 + size)) throw new Error("INVALID_PNG");
    if (offset === 8 && type !== "IHDR") throw new Error("INVALID_PNG");
    if (type === "IHDR") {
      if (offset !== 8 || size !== 13) throw new Error("INVALID_PNG");
      width = value.readUInt32BE(0); height = value.readUInt32BE(4);
      if (!width || !height || width > IMAGE_LIMITS.dimension || height > IMAGE_LIMITS.dimension || width * height > IMAGE_LIMITS.pixels) throw new Error("IMAGE_DIMENSIONS_EXCEEDED");
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[value[9]] ?? 0;
      if (value[8] !== 8 || !channels || value[10] !== 0 || value[11] !== 0 || value[12] !== 0) throw new Error("UNSUPPORTED_PNG");
    } else if (type === "IDAT") {
      if (!width || dataEnded) throw new Error("INVALID_PNG");
      data.push(value); seenData = true;
    } else if (type === "IEND") {
      if (size !== 0 || !seenData) throw new Error("INVALID_PNG");
      offset += size + 12; ended = true; break;
    } else {
      if (seenData) dataEnded = true;
      // Reject animation and unknown critical chunks. Inert metadata stays bounded.
      if (["acTL", "fcTL", "fdAT"].includes(type) || (type[0] === type[0].toUpperCase() && type !== "PLTE")) throw new Error("UNSUPPORTED_PNG");
    }
    offset += size + 12;
  }
  if (!ended || offset !== bytes.length) throw new Error("INVALID_PNG");
  const rowSize = width * channels + 1, expected = height * rowSize;
  let decoded: Buffer;
  try { decoded = inflateSync(Buffer.concat(data), { maxOutputLength: expected }); }
  catch { throw new Error("INVALID_PNG"); }
  if (decoded.length !== expected) throw new Error("INVALID_PNG");
  for (let y = 0; y < height; y++) if (decoded[y * rowSize] > 4) throw new Error("INVALID_PNG");
  return { width, height };
}
async function atomic(path: string, bytes: string | Buffer) {
  await guard(path, true);
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await guard(path, true); await rename(temp, path);
    await syncDirectory(join(path, ".."));
  } finally { await unlink(temp).catch(() => {}); }
}
async function directory(root: string) {
  await guard(root);
  const path = join(root, "assets");
  await guard(path, true); await mkdir(path, { recursive: true });
  return path;
}
async function index(root: string): Promise<Record<string, ImageAsset>> {
  const dir = await directory(root), path = join(dir, "index.json");
  if (!(await guard(path, true))) return {};
  const info = await lstat(path);
  if (info.size > 1024 * 1024) throw new Error("ASSET_INDEX_TOO_LARGE");
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_ASSET_INDEX");
  for (const [key, value] of Object.entries(parsed)) {
    const row = value as ImageAsset;
    if (!/^assets\/[a-f0-9]{64}\.(png|svg)$/.test(key) || !row || typeof row !== "object" || row.path !== key || typeof row.name !== "string" || row.name.length > 160 || !Number.isFinite(row.bytes) || row.bytes < 0 || (row.archived !== undefined && typeof row.archived !== "boolean")) throw new Error("INVALID_ASSET_INDEX");
  }
  return parsed;
}
export function referencedAssets(project: unknown): Set<string> {
  const paths = new Set<string>();
  function visit(value: unknown) {
    if (typeof value === "string" && /^assets\/[a-f0-9]{64}\.(png|svg)$/.test(value)) paths.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  visit(project); return paths;
}
export async function writeImageAsset(root: string, input: { data: string; name: string; mediaType: string }): Promise<ImageAsset> {
  if (typeof input.data !== "string" || input.data.length > Math.ceil(IMAGE_LIMITS.bytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) throw new Error("INVALID_IMAGE_DATA");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 160) throw new Error("INVALID_ASSET_NAME");
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.length > IMAGE_LIMITS.bytes) throw new Error("ASSET_TOO_LARGE");
  let path: string, dimensions: { width: number; height: number } | undefined;
  const dir = await directory(root);
  if (input.mediaType === "image/svg+xml") {
    validateSVG(bytes.toString("utf8"));
    const hash = createHash("sha256").update(bytes.toString("utf8")).digest("hex");
    if (!(await guard(join(dir, hash + ".svg"), true)) && (await readdir(dir)).filter((name) => fileName.test(name)).length >= IMAGE_LIMITS.files) throw new Error("ASSET_COUNT_EXCEEDED");
    path = (await writeSVGAsset(root, bytes.toString("utf8"))).path;
  } else if (input.mediaType === "image/png") {
    dimensions = pngDimensions(bytes);
    path = "assets/" + createHash("sha256").update(bytes).digest("hex") + ".png";
    if (!(await guard(join(root, path), true))) {
      if ((await readdir(dir)).filter((name) => fileName.test(name)).length >= IMAGE_LIMITS.files) throw new Error("ASSET_COUNT_EXCEEDED");
      await atomic(join(root, path), bytes);
    }
  } else throw new Error("UNSUPPORTED_IMAGE_FORMAT");
  const entry: ImageAsset = { path, name: input.name.trim(), mediaType: input.mediaType, bytes: bytes.length, ...dimensions };
  const rows = await index(root);
  if (!Object.hasOwn(rows, path) || rows[path].archived) { rows[path] = entry; await atomic(join(dir, "index.json"), JSON.stringify(rows, null, 2) + "\n"); }
  return Object.hasOwn(rows, path) ? rows[path] : entry;
}
export async function readImageAsset(root: string, name: string): Promise<Buffer> {
  if (!fileName.test(name)) throw new Error("INVALID_ASSET_NAME");
  if (name.endsWith(".svg")) return readSVGAsset(root, name);
  await guard(root); await guard(join(root, "assets"));
  const path = join(root, "assets", name), info = await guard(path);
  if (!info?.isFile()) throw new Error("INVALID_ASSET");
  if (info.size > IMAGE_LIMITS.bytes) throw new Error("ASSET_TOO_LARGE");
  const bytes = await readFile(path); pngDimensions(bytes);
  if (createHash("sha256").update(bytes).digest("hex") + ".png" !== name) throw new Error("ASSET_HASH_MISMATCH");
  return bytes;
}
export async function listImageAssets(root: string, project: unknown): Promise<ImageAsset[]> {
  const dir = await directory(root), rows = await index(root), used = referencedAssets(project);
  const paths = new Set([...Object.keys(rows), ...(await readdir(dir)).filter((n) => fileName.test(n)).map((n) => "assets/" + n), ...used]);
  const output: ImageAsset[] = [];
  for (const path of [...paths].sort()) {
    if (rows[path]?.archived && !used.has(path)) continue;
    if (!/^assets\/[a-f0-9]{64}\.(png|svg)$/.test(path)) throw new Error("INVALID_ASSET_INDEX");
    const info = await guard(join(root, path), true);
    let dimensions: { width: number; height: number } | undefined;
    if (info && path.endsWith(".png")) dimensions = pngDimensions(await readImageAsset(root, path.slice(7)));
    output.push({ ...rows[path], path, name: rows[path]?.name ?? path.slice(7), mediaType: path.endsWith(".png") ? "image/png" : "image/svg+xml", bytes: info?.size ?? 0, ...dimensions, used: used.has(path), missing: !info });
  }
  return output;
}
export async function deleteImageAsset(root: string, path: string, project: unknown): Promise<void> {
  if (!/^assets\/[a-f0-9]{64}\.(png|svg)$/.test(path)) throw new Error("INVALID_ASSET_NAME");
  if (referencedAssets(project).has(path)) throw new Error("ASSET_IN_USE");
  const rows = await index(root), info = await guard(join(root, path));
  // Historical revisions can still refer to this immutable file after undo.
  rows[path] = { ...(rows[path] ?? { path, name: path.slice(7), mediaType: path.endsWith(".png") ? "image/png" : "image/svg+xml", bytes: info?.size ?? 0 }), archived: true };
  await atomic(join(root, "assets/index.json"), JSON.stringify(rows, null, 2) + "\n");
}
