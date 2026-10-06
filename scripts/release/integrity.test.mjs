import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, verifyManifest, verifyRelease } from "./integrity.mjs";

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "studio-release-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "installer.zip"), "package bytes");
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("checksums are deterministic, include updater artifacts, and detect tampering", async () =>
  fixture(async (root) => {
    await writeFile(join(root, "RELEASES"), "updater");
    await writeFile(join(root, "app.nupkg"), "updater package");
    const text = await createManifest(root);
    assert.equal(text, await createManifest(root));
    assert.match(text, /  RELEASES\n/);
    assert.match(text, /  app.nupkg\n/);
    assert.equal((await verifyManifest(root, text)).length, 3);
    await writeFile(join(root, "nested", "installer.zip"), "tampered");
    await assert.rejects(verifyManifest(root, text), /CHECKSUM_MISMATCH/);
  }));
test("verification rejects traversal, absolute paths, duplicate entries and symlinks", async () =>
  fixture(async (root) => {
    const digest = "a".repeat(64);
    for (const name of [
      "../outside",
      "/outside",
      "C:/outside",
      "nested/../installer.zip",
      "nested\\installer.zip",
    ])
      await assert.rejects(
        verifyManifest(root, `${digest}  ${name}\n`),
        /INVALID_CHECKSUM_PATH/,
      );
    const text = await createManifest(root);
    await assert.rejects(
      verifyManifest(root, text + text),
      /DUPLICATE_CHECKSUM_PATH/,
    );
    await symlink(join(root, "RELEASES"), join(root, "link"), "file");
    await assert.rejects(createManifest(root), /SYMLINK_FORBIDDEN/);
  }));
test("release directory requires nonempty manifests covering every artifact", async () =>
  fixture(async (root) => {
    await assert.rejects(verifyRelease(root), /CHECKSUM_MANIFEST_MISSING/);
    await writeFile(
      join(root, "SHA256SUMS-test.txt"),
      await createManifest(root),
    );
    assert.equal((await verifyRelease(root)).length, 1);
    await writeFile(join(root, "unsigned-extra.zip"), "unlisted");
    await assert.rejects(verifyRelease(root), /UNCHECKED_RELEASE_ARTIFACT/);
    await writeFile(join(root, "SHA256SUMS-test.txt"), "");
    await assert.rejects(verifyRelease(root), /EMPTY_CHECKSUM_MANIFEST/);
  }));

test("public release staging flattens installer paths before checksums and rejects basename collisions", async () =>
  fixture(async (root) => {
    const { flattenArtifacts } = await import("./integrity.mjs");
    await flattenArtifacts(root);
    assert.equal(
      await readFile(join(root, "installer.zip"), "utf8"),
      "package bytes",
    );
    assert.match(await createManifest(root), /  installer.zip\n/);
    await writeFile(
      join(root, "nested", "installer.zip"),
      "conflicting package",
    );
    await assert.rejects(flattenArtifacts(root), /RELEASE_FILENAME_COLLISION/);
    assert.equal(
      await readFile(join(root, "installer.zip"), "utf8"),
      "package bytes",
    );
    assert.equal(
      await readFile(join(root, "nested", "installer.zip"), "utf8"),
      "conflicting package",
    );
  }));
