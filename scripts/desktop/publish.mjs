import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyRelease } from "../release/integrity.mjs";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const tag = process.env.RELEASE_TAG;
if (tag !== `desktop-v${version}` || !version.includes("-alpha."))
  throw new Error(
    "Only matching alpha desktop tags are supported by unsigned release workflow",
  );
async function walk(root) {
  const files = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}
await verifyRelease("release-assets");
const files = await walk("release-assets");
const existing =
  spawnSync("gh", ["release", "view", tag], { stdio: "ignore" }).status === 0;
const args = existing
  ? ["release", "upload", tag, ...files, "--clobber"]
  : [
      "release",
      "create",
      tag,
      ...files,
      "--verify-tag",
      "--prerelease",
      "--title",
      `Desktop ${version} — unsigned alpha`,
      "--notes-file",
      "docs/desktop-release-notes.md",
    ];
const result = spawnSync("gh", args, { stdio: "inherit" });
process.exit(result.status ?? 1);
