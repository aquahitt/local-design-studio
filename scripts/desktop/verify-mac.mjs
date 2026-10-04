import { spawnSync } from "node:child_process";
import { join } from "node:path";
if (process.platform !== "darwin")
  throw new Error("macOS verification requires macOS");
const app =
  process.argv[2] ??
  join(
    "out",
    `LocalDesignStudio-darwin-${process.arch}`,
    "LocalDesignStudio.app",
  );
const result = spawnSync(
  "codesign",
  ["--verify", "--deep", "--strict", "--verbose=2", app],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
