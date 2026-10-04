import { readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const notices = [];
const output = process.argv[2] ?? "dist";
for (const path of Object.keys(lock.packages).sort()) {
  if (!path) continue;
  let files;
  try {
    files = await readdir(path);
  } catch {
    continue;
  }
  for (const file of files
    .filter((name) => /^(license|licence|copying|notice)([.-]|$)/i.test(name))
    .sort()) {
    try {
      notices.push(
        `Package: ${path.replace(/^.*node_modules\//, "")}\nFile: ${file}\n\n${await readFile(join(path, file), "utf8")}`,
      );
    } catch {
      /* package license subdirectories are not plain text */
    }
  }
}
await writeFile(
  join(output, "THIRD_PARTY_LICENSES.txt"),
  notices.join("\n\n" + "=".repeat(80) + "\n\n"),
);
await copyFile("LICENSE", join(output, "LICENSE.txt"));
await copyFile(
  "THIRD_PARTY_NOTICES.md",
  join(output, "THIRD_PARTY_NOTICES.md"),
);
await writeFile(join(output, ".nojekyll"), "");
