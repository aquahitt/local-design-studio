import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { brotliCompressSync } from "node:zlib";
import {
  FONT_ASSET_LIMITS,
  fontAssetMediaType,
  inspectFont,
  readFontAsset,
  writeFontAsset,
} from "./font-assets";
const roots: string[] = [];
async function root() {
  const p = await mkdtemp(join(tmpdir(), "studio-font-"));
  roots.push(p);
  return p;
}
const fixture = (ext = "ttf") =>
  readFile(
    new URL(
      `../../tests/fixtures/fonts/studio-fixture.${ext}`,
      import.meta.url,
    ),
  );
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
describe("portable immutable project font assets", () => {
  for (const ext of ["ttf", "otf", "woff", "woff2"])
    it(`imports real ${ext} metadata and reopens identical bytes independently of filename`, async () => {
      const dir = await root(),
        bytes = await fixture(ext);
      const result = await writeFontAsset(dir, {
        data: bytes.toString("base64"),
        name: "Unrelated upload",
      });
      expect(result).toMatchObject({
        family: ext === "otf" ? "Studio Fixture Sans" : "Studio Fixture Mono",
        weight: 400,
        style: "normal",
        format: ext,
        bytes: bytes.length,
        name: "Unrelated upload",
      });
      expect(result.assetHash).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      expect(await readFontAsset(dir, result.path.slice(7))).toEqual(bytes);
      expect(
        await writeFontAsset(dir, {
          data: bytes.toString("base64"),
          name: "Again",
        }),
      ).toMatchObject({ assetHash: result.assetHash });
      expect(await readdir(join(dir, "assets"))).toEqual([
        result.path.slice(7),
      ]);
    });
  it("rejects corrupt/truncated tables, collections, variable faces and SVG tables", async () => {
    const bytes = await fixture();
    await expect(
      inspectFont(bytes.subarray(0, bytes.length - 20)),
    ).rejects.toThrow("INVALID_FONT");
    const corrupt = Buffer.from(bytes);
    corrupt[corrupt.length - 8] ^= 0xff;
    await expect(inspectFont(corrupt)).rejects.toThrow("INVALID_FONT");
    const collection = Buffer.from(bytes);
    collection.write("ttcf");
    await expect(inspectFont(collection)).rejects.toThrow(
      "FONT_COLLECTION_UNSUPPORTED",
    );
    for (const [tag, code] of [
      ["fvar", "VARIABLE_FONT_UNSUPPORTED"],
      ["SVG ", "FONT_SVG_UNSUPPORTED"],
    ]) {
      const changed = Buffer.from(bytes);
      changed.write(tag, 12);
      await expect(inspectFont(changed)).rejects.toThrow(code);
    }
  });
  it("rejects claimed decoded bombs before decoding, including WOFF2 UIntBase128 overflow", async () => {
    for (const ext of ["woff", "woff2"]) {
      const bytes = Buffer.from(await fixture(ext));
      bytes.writeUInt32BE(FONT_ASSET_LIMITS.decodedBytes + 1, 16);
      await expect(inspectFont(bytes)).rejects.toThrow(
        "FONT_DECODED_SIZE_EXCEEDED",
      );
    }
    const malformed = Buffer.from(await fixture("woff2"));
    malformed.fill(0xff, 49, 55);
    await expect(inspectFont(malformed)).rejects.toThrow("INVALID_FONT");
  });
  it("bounds actual decompression output even when the directory lies", async () => {
    const payload = brotliCompressSync(Buffer.alloc(128 * 1024));
    const header = Buffer.alloc(48);
    header.write("wOF2");
    header.writeUInt32BE(0x10000, 4);
    header.writeUInt32BE(48 + 2 + payload.length, 8);
    header.writeUInt16BE(1, 12);
    header.writeUInt32BE(32, 16);
    header.writeUInt32BE(payload.length, 20);
    // The name table claims one byte; the actual native decompression would be 128KiB.
    await expect(
      inspectFont(Buffer.concat([header, Buffer.from([5, 1]), payload])),
    ).rejects.toThrow("INVALID_FONT");
    const woffBytes = Buffer.from(await fixture("woff"));
    const n = woffBytes.readUInt16BE(12);
    for (let i = 0; i < n; i++) {
      const at = 44 + i * 20,
        packed = woffBytes.readUInt32BE(at + 8),
        original = woffBytes.readUInt32BE(at + 12);
      if (packed + 8 < original) {
        const smaller = packed + 1;
        woffBytes.writeUInt32BE(smaller, at + 12);
        woffBytes.writeUInt32BE(
          woffBytes.readUInt32BE(16) -
            Math.ceil(original / 4) * 4 +
            Math.ceil(smaller / 4) * 4,
          16,
        );
        break;
      }
    }
    await expect(inspectFont(woffBytes)).rejects.toThrow("INVALID_FONT");
  });
  it("rejects table overlap, duplicate/non-ASCII tags and compressed corruption", async () => {
    const bytes = await fixture();
    const overlap = Buffer.from(bytes);
    overlap.writeUInt32BE(12, 20);
    await expect(inspectFont(overlap)).rejects.toThrow("INVALID_FONT");
    const nonAscii = Buffer.from(bytes);
    nonAscii[12] |= 0x80;
    await expect(inspectFont(nonAscii)).rejects.toThrow("INVALID_FONT");
    const duplicate = Buffer.from(bytes);
    duplicate.copy(duplicate, 28, 12, 16);
    await expect(inspectFont(duplicate)).rejects.toThrow("INVALID_FONT");
    for (const ext of ["woff", "woff2"]) {
      const compressed = Buffer.from(await fixture(ext));
      compressed.fill(0xff, compressed.length - 10);
      await expect(inspectFont(compressed)).rejects.toThrow("INVALID_FONT");
    }
  });
  it("derives weight/style from OS2 data rather than an upload label", async () => {
    const bytes = Buffer.from(await fixture());
    const n = bytes.readUInt16BE(4);
    for (let i = 0; i < n; i++) {
      const at = 12 + 16 * i;
      if (bytes.toString("ascii", at, at + 4) !== "OS/2") continue;
      const offset = bytes.readUInt32BE(at + 8),
        length = bytes.readUInt32BE(at + 12);
      bytes.writeUInt16BE(725, offset + 4);
      bytes.writeUInt16BE(1 << 9, offset + 62);
      let sum = 0;
      for (let p = 0; p < length; p += 4) {
        let word = 0;
        for (let j = 0; j < 4; j++)
          word =
            (word * 256 + (p + j < length ? bytes[offset + p + j] : 0)) >>> 0;
        sum = (sum + word) >>> 0;
      }
      bytes.writeUInt32BE(sum, at + 4);
    }
    await expect(inspectFont(bytes)).resolves.toMatchObject({
      weight: 725,
      style: "oblique",
    });
  });
  it("serializes concurrent imports without overwriting or leaving temporary files", async () => {
    const dir = await root(),
      input = { data: (await fixture()).toString("base64"), name: "Font" };
    const saved = await Promise.all(
      Array.from({ length: 8 }, () => writeFontAsset(dir, input)),
    );
    expect(new Set(saved.map((r) => r.path)).size).toBe(1);
    expect(await readdir(join(dir, "assets"))).toEqual([
      saved[0].path.slice(7),
    ]);
  });
  it("rejects unknown upload fields/prototypes instead of accepting caller paths", async () => {
    const dir = await root(),
      input = { data: (await fixture()).toString("base64"), name: "Font" };
    for (const value of [
      { ...input, path: "outside.ttf" },
      { ...input, family: "Injected" },
      Object.assign(Object.create({ data: input.data }), { name: "Font" }),
      [input],
    ]) {
      await expect(writeFontAsset(dir, value as typeof input)).rejects.toThrow(
        "INVALID_FONT_INPUT",
      );
    }
    expect(await readdir(dir)).toEqual([]);
  });
  it("checks WOFF2 canonical UIntBase128 and per-table sizes before compressed data", async () => {
    for (const encoded of [
      Buffer.from([0x80, 1]),
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0x7f]),
      Buffer.from([0x81, 0x80, 0x80, 0x80, 0x80, 0]),
    ]) {
      const header = Buffer.alloc(48);
      header.write("wOF2");
      header.writeUInt32BE(0x10000, 4);
      header.writeUInt32BE(49 + encoded.length, 8);
      header.writeUInt16BE(1, 12);
      header.writeUInt32BE(32, 16);
      await expect(
        inspectFont(Buffer.concat([header, Buffer.from([5]), encoded])),
      ).rejects.toThrow("INVALID_FONT");
    }
    const header = Buffer.alloc(48);
    header.write("wOF2");
    header.writeUInt32BE(0x10000, 4);
    header.writeUInt32BE(53, 8);
    header.writeUInt16BE(1, 12);
    header.writeUInt32BE(32, 16);
    await expect(
      inspectFont(
        Buffer.concat([header, Buffer.from([5, 0x90, 0x80, 0x80, 1])]),
      ),
    ).rejects.toThrow("FONT_DECODED_SIZE_EXCEEDED");
    // W3C requires readers to tolerate WOFF2 reserved bits, unlike WOFF1.
    const real = Buffer.from(await fixture("woff2"));
    real.writeUInt16BE(1, 14);
    await expect(inspectFont(real)).resolves.toMatchObject({ format: "woff2" });
  });
  it("checks hash and never silently repairs preexisting immutable content", async () => {
    const dir = await root(),
      bytes = await fixture(),
      input = { data: bytes.toString("base64"), name: "Fixture" };
    const saved = await writeFontAsset(dir, input),
      path = join(dir, saved.path);
    await writeFile(path, Buffer.from("corrupt"));
    await expect(readFontAsset(dir, saved.path.slice(7))).rejects.toThrow(
      "FONT_HASH_MISMATCH",
    );
    await expect(writeFontAsset(dir, input)).rejects.toThrow(
      "FONT_HASH_MISMATCH",
    );
    expect(await readFile(path, "utf8")).toBe("corrupt");
  });
  it("rejects document metadata that mislabels genuine font bytes without changing files", async () => {
    const dir = await root(),
      bytes = await fixture();
    const saved = await writeFontAsset(dir, {
      data: bytes.toString("base64"),
      name: "Upload",
    });
    const face = {
      id: "fixture",
      name: "User-owned label",
      assetHash: saved.assetHash,
      format: saved.format,
      family: saved.family,
      weight: saved.weight,
      style: saved.style,
    };
    await expect(
      readFontAsset(dir, saved.path.slice(7), [face]),
    ).resolves.toEqual(bytes);
    for (const patch of [
      { weight: 700 },
      { style: "italic" as const },
      { family: "Injected face" },
    ]) {
      await expect(
        readFontAsset(dir, saved.path.slice(7), [{ ...face, ...patch }]),
      ).rejects.toThrow("FONT_METADATA_MISMATCH");
    }
    // Multiple descriptors referring to these bytes must all identify the genuine face.
    await expect(
      readFontAsset(dir, saved.path.slice(7), [
        face,
        { ...face, id: "fake", weight: 900 },
      ]),
    ).rejects.toThrow("FONT_METADATA_MISMATCH");
    expect(await readFile(join(dir, saved.path))).toEqual(bytes);
  });
  it("rejects base64, byte limits and unsafe labels without creating assets", async () => {
    const dir = await root();
    for (const data of [
      "notbase64",
      "====",
      "AA=A",
      "A".repeat(Math.ceil(FONT_ASSET_LIMITS.bytes / 3) * 4 + 4),
    ])
      await expect(
        writeFontAsset(dir, { data, name: "Font" }),
      ).rejects.toThrow();
    await expect(
      writeFontAsset(dir, {
        data: (await fixture()).toString("base64"),
        name: "bad\u0000name",
      }),
    ).rejects.toThrow("INVALID_FONT_NAME");
    expect(await readdir(dir)).toEqual([]);
  });
  it("handles the entire advertised byte limit without a regexp stack overflow", async () => {
    const dir = await root();
    await expect(
      writeFontAsset(dir, {
        data: Buffer.alloc(FONT_ASSET_LIMITS.bytes).toString("base64"),
        name: "Big invalid font",
      }),
    ).rejects.toThrow("INVALID_FONT");
    await expect(
      writeFontAsset(dir, { data: "AB==", name: "Noncanonical" }),
    ).rejects.toThrow("INVALID_FONT_DATA");
  });
  it("rejects font symlinks and a symlinked assets directory", async () => {
    const dir = await root(),
      outside = await root(),
      bytes = await fixture();
    await mkdir(join(dir, "assets"));
    const hash = createHash("sha256").update(bytes).digest("hex"),
      filename = `${hash}.ttf`;
    await writeFile(join(outside, "original"), bytes);
    await symlink(join(outside, "original"), join(dir, "assets", filename));
    await expect(readFontAsset(dir, filename)).rejects.toThrow(
      "UNSAFE_SYMLINK",
    );
    await expect(
      writeFontAsset(dir, { data: bytes.toString("base64"), name: "Font" }),
    ).rejects.toThrow("UNSAFE_SYMLINK");
    const other = await root();
    await symlink(outside, join(other, "assets"));
    await expect(
      writeFontAsset(other, { data: bytes.toString("base64"), name: "Font" }),
    ).rejects.toThrow("UNSAFE_SYMLINK");
  });
  it("enforces retained file quota while allowing idempotent reimport at quota", async () => {
    const dir = await root(),
      bytes = await fixture(),
      input = { data: bytes.toString("base64"), name: "Font" };
    const saved = await writeFontAsset(dir, input);
    for (let i = 0; i < FONT_ASSET_LIMITS.files - 1; i++)
      await writeFile(
        join(dir, "assets", i.toString(16).padStart(64, "0") + ".otf"),
        "retained",
      );
    await expect(writeFontAsset(dir, input)).resolves.toMatchObject({
      assetHash: saved.assetHash,
    });
    await expect(
      writeFontAsset(dir, {
        data: (await fixture("otf")).toString("base64"),
        name: "Other",
      }),
    ).rejects.toThrow("FONT_ASSET_COUNT_EXCEEDED");
    expect((await readdir(join(dir, "assets"))).length).toBe(
      FONT_ASSET_LIMITS.files,
    );
  });
  it("exports strict font MIME mapping only for hash filenames", () => {
    for (const ext of ["ttf", "otf", "woff", "woff2"])
      expect(fontAssetMediaType("a".repeat(64) + "." + ext)).toBe(
        "font/" + ext,
      );
    for (const name of [
      "font.ttf",
      "../" + "a".repeat(64) + ".ttf",
      "A".repeat(64) + ".woff",
      "a".repeat(64) + ".svg",
    ])
      expect(fontAssetMediaType(name)).toBeUndefined();
  });
});
