import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL("src/service/mcp.ts", root))],
  outfile: fileURLToPath(new URL("mcp-dist/studio-mcp.mjs", root)),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  jsx: "automatic",
  external: ["vite", "@vitejs/plugin-react", "@tailwindcss/vite", "@playwright/test"],
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as studioCreateRequire } from "node:module"; const require = studioCreateRequire(import.meta.url);',
  },
});
