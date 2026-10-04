import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
async function walk(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (
      !entry.name.startsWith("SHA256") &&
      !entry.name.endsWith(".nupkg") &&
      entry.name !== "RELEASES"
    )
      files.push(path);
  }
  return files;
}
const files = await walk("out/make");
const lines = [];
for (const file of files.sort())
  lines.push(
    `${createHash("sha256")
      .update(await readFile(file))
      .digest("hex")}  ${file.slice("out/make/".length)}`,
  );
await writeFile(
  `out/make/SHA256SUMS-${process.platform}-${process.arch}.txt`,
  lines.join("\n") + "\n",
);
