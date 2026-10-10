import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
const root = resolve(
  "out",
  `LocalDesignStudio-${process.platform}-${process.arch}`,
);
const executable =
  process.platform === "darwin"
    ? join(
        root,
        "LocalDesignStudio.app",
        "Contents",
        "MacOS",
        "LocalDesignStudio",
      )
    : join(
        root,
        process.platform === "win32"
          ? "LocalDesignStudio.exe"
          : "LocalDesignStudio",
      );
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "playwright.desktop.config.ts",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, STUDIO_PACKAGED_EXECUTABLE: executable },
  },
);
process.exit(result.status ?? 1);
