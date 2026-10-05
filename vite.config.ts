import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { resolve } from "node:path";
import {
  studioLibraryPlugin,
  getConfiguredLibraryMetadata,
} from "./scripts/library/plugin";
import { studioServicePlugin } from "./scripts/studio/plugin";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "STUDIO_"), ...process.env };
  const demo = mode === "demo";
  const desktop = mode === "desktop";
  const library = {
    studioOnly: demo,
    externalRoot: demo || desktop ? undefined : env.STUDIO_LIBRARY_ROOT,
  };
  return {
    base: demo ? "/local-design-studio/" : "/",
    define: {
      __STUDIO_DEMO__: JSON.stringify(demo),
      __STUDIO_DESKTOP__: JSON.stringify(desktop),
    },
    build: desktop ? { outDir: "desktop-dist/renderer" } : {},
    plugins: [
      studioLibraryPlugin(library),
      tailwind(),
      react(),
      ...(!demo && !desktop
        ? [
            studioServicePlugin({
              projectRoot:
                env.STUDIO_PROJECT ?? resolve(process.cwd(), ".studio-project"),
              metadata: getConfiguredLibraryMetadata(library),
            }),
          ]
        : []),
    ],
    server: { host: "127.0.0.1", port: 5178, strictPort: true },
    test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
  };
});
