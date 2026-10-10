import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rename } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const isManifest = (name) => /^SHA256SUMS(?:-[A-Za-z0-9_-]+)?\.txt$/.test(name);
async function files(root, prefix = "") {
  if ((await lstat(root)).isSymbolicLink())
    throw new Error("SYMLINK_FORBIDDEN");
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`SYMLINK_FORBIDDEN: ${name}`);
    if (entry.isDirectory())
      result.push(...(await files(join(root, entry.name), name + "/")));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`UNSUPPORTED_RELEASE_FILE: ${name}`);
  }
  return result.sort();
}
function safePath(name) {
  if (
    !name ||
    /[\\\r\n\x00:]/.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`INVALID_CHECKSUM_PATH: ${name}`);
}
async function digest(root, name) {
  safePath(name);
  let current = root;
  for (const part of name.split("/")) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error(`SYMLINK_FORBIDDEN: ${name}`);
  }
  const file = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile())
      throw new Error(`UNSUPPORTED_RELEASE_FILE: ${name}`);
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false }))
      hash.update(chunk);
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}
// GitHub release attachment names are basenames, unlike workflow artifacts.
export async function flattenArtifacts(root) {
  const entries = await files(root),
    names = new Set();
  for (const name of entries) {
    const leaf = basename(name);
    if (names.has(leaf)) throw new Error(`RELEASE_FILENAME_COLLISION: ${leaf}`);
    names.add(leaf);
  }
  for (const name of entries) {
    if (name.includes("/"))
      await rename(join(root, name), join(root, basename(name)));
  }
}
export async function createManifest(root) {
  const entries = (await files(root)).filter((name) => !isManifest(name));
  if (!entries.length) throw new Error("EMPTY_RELEASE");
  const lines = [];
  for (const name of entries)
    lines.push(`${await digest(root, name)}  ${name}`);
  return lines.join("\n") + "\n";
}
export async function verifyManifest(root, text) {
  const names = new Set();
  for (const line of text.split("\n").filter(Boolean)) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error("INVALID_CHECKSUM_MANIFEST");
    const [, expected, name] = match;
    safePath(name);
    if (names.has(name)) throw new Error(`DUPLICATE_CHECKSUM_PATH: ${name}`);
    names.add(name);
    if ((await digest(root, name)) !== expected)
      throw new Error(`CHECKSUM_MISMATCH: ${name}`);
  }
  if (!names.size) throw new Error("EMPTY_CHECKSUM_MANIFEST");
  return [...names];
}
export async function verifyRelease(root) {
  const entries = await files(root),
    manifests = entries.filter(isManifest);
  if (!manifests.length) throw new Error("CHECKSUM_MANIFEST_MISSING");
  const covered = new Set();
  for (const manifest of manifests) {
    const file = await open(
      join(root, manifest),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let text;
    try {
      text = await file.readFile("utf8");
    } finally {
      await file.close();
    }
    for (const name of await verifyManifest(root, text)) covered.add(name);
  }
  for (const name of entries.filter((name) => !isManifest(name)))
    if (!covered.has(name))
      throw new Error(`UNCHECKED_RELEASE_ARTIFACT: ${name}`);
  return manifests;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = process.argv[2] ?? "release-assets";
  const manifests = await verifyRelease(root);
  console.log(`Verified ${manifests.length} checksum manifest(s) in ${root}`);
}
