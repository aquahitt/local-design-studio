import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
if (process.platform !== "darwin") throw new Error("DMG test requires macOS");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const mount = await mkdtemp(join(tmpdir(), "studio-dmg-check-"));
function run(bin, args, env = process.env) {
  const r = spawnSync(bin, args, { stdio: "inherit", env });
  if (r.status !== 0) throw new Error(`${bin} failed (${r.status})`);
}
let mounted = false;
try {
  run("hdiutil", [
    "attach",
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mount,
    join("out", "make", `LocalDesignStudio-${version}-${process.arch}.dmg`),
  ]);
  mounted = true;
  const app = join(mount, "LocalDesignStudio.app");
  run(process.execPath, ["scripts/desktop/verify-mac.mjs", app]);
  run(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config",
      "playwright.desktop.config.ts",
    ],
    {
      ...process.env,
      STUDIO_PACKAGED_EXECUTABLE: join(
        app,
        "Contents",
        "MacOS",
        "LocalDesignStudio",
      ),
    },
  );
} finally {
  if (mounted) run("hdiutil", ["detach", mount]);
  await rm(mount, { recursive: true, force: true });
}
