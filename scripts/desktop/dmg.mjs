import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

function runHdiutil(command, args) {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "inherit", "pipe"],
    encoding: "utf8",
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  return result;
}

// hdiutil can briefly retain the packaged source on hosted macOS runners.
// Retry only its explicit create/EBUSY diagnostic; preserve every other failure.
export async function createDmg(
  args,
  { run = runHdiutil, pause = setTimeout, warn = console.warn } = {},
) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = run("hdiutil", args);
    const busy =
      result.status !== null &&
      result.status !== 0 &&
      !result.error &&
      !result.signal &&
      /hdiutil: create failed - Resource busy(?:\r?\n|$)/.test(
        result.stderr ?? "",
      );
    if (!busy || attempt === 3) return result.status ?? 1;
    warn(`hdiutil create: Resource busy; retry after attempt ${attempt}/3`);
    await pause(attempt * 1000);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.platform !== "darwin") throw new Error("DMG requires macOS");
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  process.exitCode = await createDmg([
    "create",
    "-volname",
    "Local Design Studio",
    "-srcfolder",
    join("out", `LocalDesignStudio-darwin-${process.arch}`),
    "-ov",
    "-format",
    "UDZO",
    join("out", "make", `LocalDesignStudio-${version}-${process.arch}.dmg`),
  ]);
}
