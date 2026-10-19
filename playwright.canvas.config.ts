import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["canvas.spec.ts", "canvas-extra.spec.ts"],
  workers: 1,
  timeout: 20000,
  use: { baseURL: "http://127.0.0.1:5199" },
  webServer: {
    env: { STUDIO_PROJECT: mkdtempSync(join(tmpdir(), "studio-canvas-")) },
    command: "npm run dev -- --port 5199 --strictPort",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: false,
  },
});
