import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { writeImageAsset, listImageAssets, readImageAsset, deleteImageAsset, pngDimensions } from "./image-assets";

function crc(bytes: Buffer) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Buffer) {
  const name = Buffer.from(type), length = Buffer.alloc(4), sum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); sum.writeUInt32BE(crc(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, sum]);
}
function png(width = 2, height = 1) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 255]))), chunk("IEND", Buffer.alloc(0))]);
}
it("imports bounded PNG, deduplicates, verifies hashes and prevents deletion of used assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-images-"));
  try {
    const bytes = png();
    expect(pngDimensions(bytes)).toEqual({ width: 2, height: 1 });
    const first = await writeImageAsset(root, { data: bytes.toString("base64"), name: "Картинка.png", mediaType: "image/png" });
    expect(first.path).toMatch(/^assets\/[a-f0-9]{64}\.png$/);
    expect((await writeImageAsset(root, { data: bytes.toString("base64"), name: "Second.png", mediaType: "image/png" })).path).toBe(first.path);
    expect(await readImageAsset(root, first.path.slice(7))).toEqual(bytes);
    expect(await listImageAssets(root, { pages: [{ nodes: [{ props: { src: first.path }, slots: {} }] }] })).toEqual([
      expect.objectContaining({ path: first.path, width: 2, height: 1, used: true, missing: false }),
    ]);
    await expect(deleteImageAsset(root, first.path, { pages: [{ nodes: [{ props: { src: first.path }, slots: {} }] }] })).rejects.toThrow("ASSET_IN_USE");
    await deleteImageAsset(root, first.path, { pages: [] });
    expect(await listImageAssets(root, { pages: [] })).toEqual([]);
    expect(await readImageAsset(root, first.path.slice(7))).toEqual(bytes);
    expect(await listImageAssets(root, { pages: [{ nodes: [{ props: { src: first.path }, slots: {} }] }] })).toContainEqual(expect.objectContaining({ path: first.path, used: true, missing: false }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("rejects truncated, malformed, decompression bombs, unsafe SVG, symlinks and invalid names", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-image-limits-"));
  try {
    expect(() => pngDimensions(png().subarray(0, 25))).toThrow("INVALID_PNG");
    expect(() => pngDimensions(png(100000, 1))).toThrow("IMAGE_DIMENSIONS_EXCEEDED");
    await expect(writeImageAsset(root, { mediaType: "image/png", data: "bad", name: "bad" })).rejects.toThrow();
    await expect(writeImageAsset(root, { mediaType: "image/svg+xml", data: Buffer.from('<svg onload="evil"/>').toString("base64"), name: "bad" })).rejects.toThrow("UNSAFE_SVG");
    await rm(join(root, "assets"), { recursive: true, force: true });
    await mkdir(join(root, "outside")); await symlink(join(root, "outside"), join(root, "assets"));
    await expect(writeImageAsset(root, { mediaType: "image/png", data: png().toString("base64"), name: "safe" })).rejects.toThrow("UNSAFE_SYMLINK");
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("reports used missing assets after clone without silently deleting references", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-missing-image-"));
  try {
    const path = "assets/" + "a".repeat(64) + ".png";
    const rows = await listImageAssets(root, { pages: [{ nodes: [{ props: { src: path }, slots: {} }] }] });
    expect(rows).toContainEqual(expect.objectContaining({ path, missing: true, used: true }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
