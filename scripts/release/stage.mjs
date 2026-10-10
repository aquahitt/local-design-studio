import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flattenArtifacts } from "./integrity.mjs";
const output = process.argv[2] ?? "out/make";
const suffix = `${process.platform}-${process.arch}`;
await mkdir(output, { recursive: true });
await flattenArtifacts(output);
for (const name of [
  "LICENSE.txt",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_LICENSES.txt",
]) {
  const source = join("desktop-dist/renderer", name);
  if (!(await readFile(source, "utf8")).trim())
    throw new Error(`EMPTY_RELEASE_NOTICE: ${name}`);
  await copyFile(source, join(output, `${suffix}-${name}`));
}
await copyFile(
  "mcp-dist/studio-mcp.mjs",
  join(output, `studio-mcp-${suffix}.mjs`),
);
const { version, name, license } = JSON.parse(
  await readFile("package.json", "utf8"),
);
await writeFile(
  join(output, `release-${suffix}.json`),
  JSON.stringify(
    {
      name,
      version,
      license,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      commit: process.env.GITHUB_SHA ?? null,
      lockfileSha256: createHash("sha256")
        .update(await readFile("package-lock.json"))
        .digest("hex"),
      schema: { read: [1, 2], write: 2 },
      signed: false,
      verification:
        "CI test results and provenance belong to the producing workflow run; this manifest is build metadata, not a signature.",
    },
    null,
    2,
  ) + "\n",
);
