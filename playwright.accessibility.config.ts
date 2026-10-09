import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export default defineConfig({
  testDir: "./tests/accessibility",
  outputDir: "./test-results/accessibility",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:5229" },
  webServer: {
    command: "npm run dev -- --port 5229 --strictPort",
    url: "http://127.0.0.1:5229",
    reuseExistingServer: false,
    env: { STUDIO_PROJECT: mkdtempSync(join(tmpdir(), "studio-a11y-")) },
  },
});
