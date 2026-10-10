import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
if (process.platform !== "darwin") throw new Error("DMG requires macOS");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const result = spawnSync(
  "hdiutil",
  [
    "create",
    "-volname",
    "Local Design Studio",
    "-srcfolder",
    join("out", `LocalDesignStudio-darwin-${process.arch}`),
    "-ov",
    "-format",
    "UDZO",
    join("out", "make", `LocalDesignStudio-${version}-${process.arch}.dmg`),
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
