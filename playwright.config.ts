import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testIgnore: ["demo.spec.ts", "desktop.spec.ts"],
  workers: 1,
  timeout: 15000,
  use: { baseURL: "http://127.0.0.1:5198" },
  webServer: {
    env: { STUDIO_PROJECT: mkdtempSync(join(tmpdir(), "studio-browser-")) },
    command: "npm run dev -- --port 5198 --strictPort",
    url: "http://127.0.0.1:5198",
    reuseExistingServer: false,
  },
});
