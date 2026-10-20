/** Container/metadata guards, not a glyph interpreter. Chromium OTS validates outlines on load.
 * Specs: https://www.w3.org/TR/WOFF2/ and OpenType name/OS2/head specifications.
 * No filename metadata guesses, executable modules, network access or image-index writes.
 */
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  link,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { inflate, brotliDecompress } from "node:zlib";
import { syncDirectory } from "../core/durability";
import type { ProjectFont } from "../core/fonts";
export const FONT_ASSET_LIMITS = {
  bytes: 8 * 1024 * 1024,
  decodedBytes: 32 * 1024 * 1024,
  files: 256,
  tables: 128,
  names: 4096,
} as const;
export interface FontAsset {
  assetHash: string;
  format: ProjectFont["format"];
  family: string;
  weight: number;
  style: ProjectFont["style"];
  bytes: number;
  path: string;
  name: string;
}
export const FONT_ASSET_FILENAME = /^[a-f0-9]{64}\.(ttf|otf|woff|woff2)$/;
export function fontAssetMediaType(name: string): string | undefined {
  const match = FONT_ASSET_FILENAME.exec(name);
  return match ? `font/${match[1]}` : undefined;
}
type Metadata = Pick<FontAsset, "format" | "family" | "weight" | "style">;
type Table = { tag: string; bytes: Buffer };
const invalid = (): never => {
  throw new Error("INVALID_FONT");
};
function range(data: Buffer, offset: number, size: number): Buffer {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(size) ||
    offset < 0 ||
    size < 0 ||
    offset + size > data.length
  )
    invalid();
  return data.subarray(offset, offset + size);
}
const aligned = (n: number) => Math.ceil(n / 4) * 4;
function decodedSize(n: number) {
  if (n > FONT_ASSET_LIMITS.decodedBytes)
    throw new Error("FONT_DECODED_SIZE_EXCEEDED");
}
function checkTags(tags: string[]) {
  if (
    new Set(tags).size !== tags.length ||
    tags.some((t) => !/^[\x20-\x7e]{4}$/.test(t))
  )
    invalid();
  if (tags.includes("fvar")) throw new Error("VARIABLE_FONT_UNSUPPORTED");
  if (tags.includes("SVG ")) throw new Error("FONT_SVG_UNSUPPORTED");
}
function count(n: number) {
  if (!n || n > FONT_ASSET_LIMITS.tables) invalid();
}
function flavor(value: number) {
  if (value === 0x74746366) throw new Error("FONT_COLLECTION_UNSUPPORTED");
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(value)) invalid();
}
function checksum(data: Buffer, tag: string): number {
  let result = 0;
  for (let at = 0; at < data.length; at += 4) {
    let word = 0;
    for (let i = 0; i < 4; i++)
      word =
        (word * 256 +
          (tag === "head" && at === 8 ? 0 : (data[at + i] ?? 0))) >>>
        0;
    result = (result + word) >>> 0;
  }
  return result;
}
function distinctRanges(
  rows: { offset: number; length: number }[],
  start: number,
  length: number,
) {
  let end = start;
  for (const row of [...rows].sort((a, b) => a.offset - b.offset)) {
    if (row.offset < end || row.offset % 4 || row.offset + row.length > length)
      invalid();
    end = row.offset + row.length;
  }
}
async function decompress(
  bytes: Buffer,
  expected: number,
  brotli: boolean,
): Promise<Buffer> {
  decodedSize(expected);
  if (!expected) invalid();
  return new Promise((resolveResult, reject) => {
    // Input and native output allocations are capped even after this readiness deadline.
    const timer = setTimeout(
      () => reject(new Error("FONT_DECODE_TIMEOUT")),
      10_000,
    );
    const callback = (error: Error | null, result: Buffer) => {
      clearTimeout(timer);
      if (error || result.length !== expected)
        reject(new Error("INVALID_FONT"));
      else resolveResult(result);
    };
    if (brotli)
      brotliDecompress(bytes, { maxOutputLength: expected }, callback);
    else inflate(bytes, { maxOutputLength: expected }, callback);
  });
}
function sfnt(data: Buffer): Table[] {
  range(data, 0, 12);
  flavor(data.readUInt32BE(0));
  const n = data.readUInt16BE(4);
  count(n);
  range(data, 12, n * 16);
  const rows = Array.from({ length: n }, (_, i) => {
    const at = 12 + 16 * i;
    return {
      tag: data.toString("latin1", at, at + 4),
      check: data.readUInt32BE(at + 4),
      offset: data.readUInt32BE(at + 8),
      length: data.readUInt32BE(at + 12),
    };
  });
  checkTags(rows.map((r) => r.tag));
  decodedSize(
    12 + n * 16 + rows.reduce((sum, r) => sum + aligned(r.length), 0),
  );
  distinctRanges(rows, 12 + n * 16, data.length);
  return rows.map((r) => {
    const bytes = range(data, r.offset, r.length);
    if (checksum(bytes, r.tag) !== r.check) invalid();
    return { tag: r.tag, bytes };
  });
}
function optionalBlocks(
  data: Buffer,
  metadataAt: number,
  privateAt: number,
  start: number,
) {
  // XML/private payloads are inert and never decompressed or interpreted.
  const metaOffset = data.readUInt32BE(metadataAt),
    metaLength = data.readUInt32BE(metadataAt + 4),
    metaOriginal = data.readUInt32BE(metadataAt + 8);
  const privOffset = data.readUInt32BE(privateAt),
    privLength = data.readUInt32BE(privateAt + 4);
  decodedSize(metaOriginal);
  let end = start;
  for (const [offset, length] of [
    [metaOffset, metaLength],
    [privOffset, privLength],
  ]) {
    if (!offset && !length) continue;
    if (!offset || !length || offset !== aligned(end)) invalid();
    for (let i = end; i < offset; i++) if (data[i] !== 0) invalid();
    range(data, offset, length);
    end = offset + length;
  }
  if (
    (!metaOffset && metaOriginal) ||
    (metaOffset && !metaOriginal) ||
    (data.length !== end &&
      (data.length !== aligned(end) || data.subarray(end).some((v) => v !== 0)))
  )
    invalid();
}
async function woff(data: Buffer): Promise<Table[]> {
  range(data, 0, 44);
  flavor(data.readUInt32BE(4));
  if (data.readUInt32BE(8) !== data.length || data.readUInt16BE(14)) invalid();
  const n = data.readUInt16BE(12),
    total = data.readUInt32BE(16);
  count(n);
  decodedSize(total);
  range(data, 44, n * 20);
  const rows = Array.from({ length: n }, (_, i) => {
    const at = 44 + 20 * i;
    return {
      tag: data.toString("latin1", at, at + 4),
      offset: data.readUInt32BE(at + 4),
      length: data.readUInt32BE(at + 8),
      original: data.readUInt32BE(at + 12),
      check: data.readUInt32BE(at + 16),
    };
  });
  checkTags(rows.map((r) => r.tag));
  if (
    total !==
    12 + n * 16 + rows.reduce((sum, r) => sum + aligned(r.original), 0)
  )
    invalid();
  distinctRanges(rows, 44 + n * 20, data.length);
  optionalBlocks(
    data,
    24,
    36,
    Math.max(44 + n * 20, ...rows.map((r) => r.offset + r.length)),
  );
  const output: Table[] = [];
  for (const r of rows) {
    if (!r.original || r.length > r.original) invalid();
    const compressed = range(data, r.offset, r.length);
    const bytes =
      r.length === r.original
        ? compressed
        : await decompress(compressed, r.original, false);
    if (checksum(bytes, r.tag) !== r.check) invalid();
    output.push({ tag: r.tag, bytes });
  }
  return output;
}
// Spaces inside four-byte tags require an explicit list, per WOFF2 Table 2.
const tags2 = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
];
async function woff2(data: Buffer): Promise<Table[]> {
  range(data, 0, 48);
  flavor(data.readUInt32BE(4));
  if (data.readUInt32BE(8) !== data.length) invalid();
  const n = data.readUInt16BE(12),
    total = data.readUInt32BE(16),
    compressedSize = data.readUInt32BE(20);
  count(n);
  decodedSize(total);
  let at = 48;
  const uint128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = range(data, at++, 1)[0];
      if ((i === 0 && byte === 0x80) || value > 0x1ffffff) invalid();
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    return invalid();
  };
  const rows = [];
  let decoded = 0,
    sfntSize = 12 + n * 16;
  for (let i = 0; i < n; i++) {
    const flags = range(data, at++, 1)[0],
      index = flags & 63,
      version = flags >> 6;
    const tag =
      index === 63 ? range(data, at, 4).toString("latin1") : tags2[index];
    if (index === 63) at += 4;
    const original = uint128();
    const glyf = tag === "glyf" || tag === "loca";
    if (
      (glyf && version !== 0 && version !== 3) ||
      (!glyf && version && !(tag === "hmtx" && version === 1))
    )
      invalid();
    const transformed = glyf ? version === 0 : version !== 0;
    const length = transformed ? uint128() : original;
    if (tag === "loca" && transformed && length !== 0) invalid();
    rows.push({ tag, length, original, transformed, offset: decoded });
    decoded += length;
    sfntSize += aligned(original);
    decodedSize(decoded);
    decodedSize(sfntSize);
  }
  checkTags(rows.map((r) => r.tag));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (
      row.tag === "glyf" &&
      row.transformed &&
      !rows.some((r) => r.tag === "loca" && r.transformed)
    )
      invalid();
    if (
      row.tag === "loca" &&
      row.transformed &&
      !rows.some((r) => r.tag === "glyf" && r.transformed)
    )
      invalid();
    if (
      row.tag === "hmtx" &&
      row.transformed &&
      !rows.some((r) => r.tag === "glyf")
    )
      invalid();
  }

  // Transformed glyf reconstruction may legitimately produce different padding size.
  if (total < 12 + n * 16 || total > FONT_ASSET_LIMITS.decodedBytes) invalid();
  const compressed = range(data, at, compressedSize);
  optionalBlocks(data, 28, 40, at + compressedSize);
  const bytes = await decompress(compressed, decoded, true);
  return rows.map((r) => ({
    tag: r.tag,
    bytes: r.transformed ? Buffer.alloc(0) : range(bytes, r.offset, r.length),
  }));
}
function metadata(tables: Table[]): Omit<Metadata, "format"> {
  const table = (tag: string, size: number) => {
    const row = tables.find((t) => t.tag === tag);
    if (!row) return invalid();
    if (row.bytes.length < size) invalid();
    return row.bytes;
  };
  if (!tables.some((t) => ["glyf", "CFF ", "CFF2"].includes(t.tag))) invalid();
  const name = table("name", 6),
    head = table("head", 54),
    os2 = table("OS/2", 64);
  if (
    head.readUInt32BE(12) !== 0x5f0f3cf5 ||
    head.readUInt16BE(18) < 16 ||
    head.readUInt16BE(18) > 16384
  )
    invalid();
  table("cmap", 4);
  table("maxp", 6);
  table("hhea", 36);
  const records = name.readUInt16BE(2),
    strings = name.readUInt16BE(4),
    version = name.readUInt16BE(0);
  if (
    version > 1 ||
    records > FONT_ASSET_LIMITS.names ||
    strings < 6 + records * 12
  )
    invalid();
  range(name, 6, records * 12);
  range(name, strings, 0);
  const families: { text: string; score: number }[] = [];
  for (let i = 0; i < records; i++) {
    const at = 6 + i * 12,
      platform = name.readUInt16BE(at),
      encoding = name.readUInt16BE(at + 2),
      language = name.readUInt16BE(at + 4),
      id = name.readUInt16BE(at + 6);
    const length = name.readUInt16BE(at + 8),
      offset = name.readUInt16BE(at + 10);
    const data = range(name, strings + offset, length);
    if (
      ![1, 16].includes(id) ||
      !(platform === 0 || (platform === 3 && [0, 1, 10].includes(encoding)))
    )
      continue;
    if (length % 2) invalid();
    const text = new TextDecoder("utf-16be", { fatal: true })
      .decode(data)
      .trim();
    if (
      !text ||
      text.length > 160 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(text)
    )
      invalid();
    families.push({
      text,
      score:
        (id === 16 ? 4 : 0) +
        (language === 0x409 ? 2 : 0) +
        (platform === 3 ? 1 : 0),
    });
  }
  families.sort((a, b) => b.score - a.score);
  if (!families.length) throw new Error("FONT_METADATA_MISSING");
  const weight = os2.readUInt16BE(4),
    selection = os2.readUInt16BE(62);
  if (weight < 1 || weight > 1000) invalid();
  return {
    family: families[0].text,
    weight,
    style:
      selection & (1 << 9) ? "oblique" : selection & 1 ? "italic" : "normal",
  };
}
export async function inspectFont(data: Buffer): Promise<Metadata> {
  if (data.length > FONT_ASSET_LIMITS.bytes)
    throw new Error("FONT_ASSET_TOO_LARGE");
  try {
    range(data, 0, 4);
    const signature = data.readUInt32BE(0);
    if (signature === 0x774f4646)
      return { format: "woff", ...metadata(await woff(data)) };
    if (signature === 0x774f4632)
      return { format: "woff2", ...metadata(await woff2(data)) };
    const tables = sfnt(data);
    return {
      format: signature === 0x4f54544f ? "otf" : "ttf",
      ...metadata(tables),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      /^(INVALID_FONT|FONT_|VARIABLE_FONT_)/.test(error.message)
    )
      throw error;
    throw new Error("INVALID_FONT");
  }
}
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
async function directory(root: string, create = false) {
  // The operator-selected root is trusted, but cannot itself be a symlink.
  // Canonicalize OS ancestors (/var -> /private/var on macOS); only assets below
  // this fixed boundary are document-controlled.
  const rootInfo = await guard(root);
  if (!rootInfo?.isDirectory()) throw new Error("INVALID_FONT_DIRECTORY");
  const resolved = await realpath(root);
  const dir = join(resolved, "assets");
  let info = await guard(dir, true);
  if (!info && create) {
    await mkdir(dir).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    info = await guard(dir);
    await syncDirectory(resolved);
  }
  if (!info?.isDirectory()) throw new Error("INVALID_FONT_DIRECTORY");
  return dir;
}
function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
async function readVerified(
  dir: string,
  name: string,
  expected?: readonly ProjectFont[],
): Promise<Buffer> {
  const path = join(dir, name);
  await guard(path);
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("INVALID_FONT_ASSET");
    if (info.size > FONT_ASSET_LIMITS.bytes)
      throw new Error("FONT_ASSET_TOO_LARGE");
    // Read no more than the cap even if another local process grows the file.
    const bytes = Buffer.alloc(info.size + 1);
    let received = 0;
    while (received < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        received,
        bytes.length - received,
        received,
      );
      if (!bytesRead) break;
      received += bytesRead;
    }
    if (received !== info.size) throw new Error("FONT_HASH_MISMATCH");
    const data = bytes.subarray(0, info.size);
    if (`${hash(data)}.${name.split(".")[1]}` !== name)
      throw new Error("FONT_HASH_MISMATCH");
    const metadata = await inspectFont(data);
    if (!name.endsWith(`.${metadata.format}`))
      throw new Error("INVALID_FONT_ASSET");
    for (const face of expected ?? []) {
      if (
        face.assetHash !== name.slice(0, 64) ||
        face.format !== metadata.format
      )
        continue;
      if (
        face.family !== metadata.family ||
        face.weight !== metadata.weight ||
        face.style !== metadata.style
      )
        throw new Error("FONT_METADATA_MISMATCH");
    }
    return data;
  } finally {
    await file.close();
  }
}
export async function readFontAsset(
  root: string,
  name: string,
  expected?: readonly ProjectFont[],
): Promise<Buffer> {
  if (!FONT_ASSET_FILENAME.test(name))
    throw new Error("INVALID_FONT_ASSET_NAME");
  return readVerified(await directory(root), name, expected);
}
const writers = new Map<string, Promise<unknown>>();
async function serialized<T>(root: string, run: () => Promise<T>): Promise<T> {
  const key = resolve(root),
    previous = writers.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(run);
  writers.set(key, current);
  try {
    return await current;
  } finally {
    if (writers.get(key) === current) writers.delete(key);
  }
}
export async function writeFontAsset(
  root: string,
  input: { data: string; name: string },
): Promise<FontAsset> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.keys(input).some((key) => !["data", "name"].includes(key)) ||
    !Object.hasOwn(input, "data") ||
    !Object.hasOwn(input, "name")
  )
    throw new Error("INVALID_FONT_INPUT");
  if (
    typeof input?.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 160 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(input.name)
  )
    throw new Error("INVALID_FONT_NAME");
  if (
    typeof input.data !== "string" ||
    input.data.length > Math.ceil(FONT_ASSET_LIMITS.bytes / 3) * 4 ||
    input.data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)
  )
    throw new Error("INVALID_FONT_DATA");
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.toString("base64") !== input.data)
    throw new Error("INVALID_FONT_DATA");
  const metadata = await inspectFont(bytes),
    assetHash = hash(bytes),
    filename = `${assetHash}.${metadata.format}`;
  await serialized(root, async () => {
    const dir = await directory(root, true),
      target = join(dir, filename);
    if (await guard(target, true)) {
      await readVerified(dir, filename);
      return;
    }
    if (
      (await readdir(dir)).filter((n) => FONT_ASSET_FILENAME.test(n)).length >=
      FONT_ASSET_LIMITS.files
    )
      throw new Error("FONT_ASSET_COUNT_EXCEEDED");
    const temp = join(dir, `.${randomUUID()}.font-tmp`);
    try {
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await directory(root); // Recheck after asynchronous writes; never replace immutable destinations.
      try {
        await link(temp, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await readVerified(dir, filename);
      }
      await syncDirectory(dir);
    } finally {
      await unlink(temp).catch(() => {});
    }
  });
  return {
    ...metadata,
    assetHash,
    bytes: bytes.length,
    path: `assets/${filename}`,
    name: input.name.trim(),
  };
}
