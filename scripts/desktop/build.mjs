import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
await rm("desktop-dist", { recursive: true, force: true });
await mkdir("desktop-dist", { recursive: true });
const vite = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--mode", "desktop"],
  { stdio: "inherit" },
);
if (vite.status !== 0) process.exit(vite.status ?? 1);
for (const entry of ["main", "preload", "worker"])
  await build({
    entryPoints: [`desktop/${entry}.ts`],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
    outfile: `desktop-dist/${entry}.cjs`,
    jsx: "automatic",
  });
const notices = spawnSync(
  process.execPath,
  ["scripts/demo-notices.mjs", "desktop-dist/renderer"],
  { stdio: "inherit" },
);
if (notices.status !== 0) process.exit(notices.status ?? 1);
