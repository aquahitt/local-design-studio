import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { rm, mkdir, cp, copyFile, chmod } from "node:fs/promises";
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
    external: [
      "electron",
      "tailwindcss/index.css",
      "vite",
      "@vitejs/plugin-react",
      "@tailwindcss/vite",
      "@playwright/test",
    ],
    plugins: [
      {
        name: "desktop-esbuild-runtime",
        setup(builder) {
          builder.onResolve({ filter: /^esbuild$/ }, () => ({
            path: "./vendor/esbuild/lib/main.js",
            external: true,
          }));
        },
      },
    ],
    outfile: `desktop-dist/${entry}.cjs`,
    jsx: "automatic",
  });
const mcp = spawnSync(process.execPath, ["scripts/mcp-build.mjs"], {
  stdio: "inherit",
});
if (mcp.status !== 0) process.exit(mcp.status ?? 1);
await mkdir("desktop-dist/mcp", { recursive: true });
await copyFile("mcp-dist/studio-mcp.mjs", "desktop-dist/mcp/studio-mcp.mjs");
// The packaged compiler uses its own native binary; users need no Node/npm setup.
const require = createRequire(import.meta.url);
await mkdir("desktop-dist/vendor/esbuild/lib", { recursive: true });
await copyFile(
  require.resolve("esbuild"),
  "desktop-dist/vendor/esbuild/lib/main.js",
);
await copyFile(
  require.resolve("esbuild/package.json"),
  "desktop-dist/vendor/esbuild/package.json",
);
await mkdir("desktop-dist/vendor/esbuild/bin", { recursive: true });
const nativePackage = `@esbuild/${process.platform}-${process.arch}`;
const nativeRoot = dirname(require.resolve(`${nativePackage}/package.json`));
const nativeName = process.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
const binaryName = process.platform === "win32" ? "esbuild.exe" : "esbuild";
await copyFile(
  join(nativeRoot, nativeName),
  `desktop-dist/vendor/esbuild/bin/${binaryName}`,
);
if (process.platform !== "win32")
  await chmod(`desktop-dist/vendor/esbuild/bin/${binaryName}`, 0o755);
await cp(
  dirname(require.resolve("tailwindcss/package.json")),
  "desktop-dist/vendor/tailwindcss",
  { recursive: true },
);
await mkdir("desktop-dist/library-sources", { recursive: true });
for (const source of ["sdk.ts", "localBrowser.tsx", "localCatalog.ts"])
  await copyFile(
    `src/library/${source}`,
    `desktop-dist/library-sources/${source}`,
  );
const notices = spawnSync(
  process.execPath,
  ["scripts/demo-notices.mjs", "desktop-dist/renderer"],
  { stdio: "inherit" },
);
if (notices.status !== 0) process.exit(notices.status ?? 1);
