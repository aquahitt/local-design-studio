import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "demo.spec.ts",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:5199/local-design-studio/" },
  webServer: {
    command:
      "npm run build:demo && npm run preview:demo -- --port 5199 --strictPort",
    url: "http://127.0.0.1:5199/local-design-studio/",
    reuseExistingServer: false,
  },
});
