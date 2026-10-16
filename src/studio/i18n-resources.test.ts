import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { english } from "./locales/en";
import { russian } from "./locales/ru";
it("every localized editor string has Russian and English resources", () => {
  const files = [
    "App",
    "Assets",
    "Annotations",
    "LayerActions",
    "GeometryActions",
    "NodeLayoutInspector",
    "Inspector",
    "Catalog",
    "StudioSelect",
    "ViewportControls",
    "Groups",
    "DesignSystem",
  ];
  for (const file of [
    ...files.map((name) => `src/studio/${name}.tsx`),
    "src/desktop/App.tsx",
    "src/demo/Banner.tsx",
    "desktop/main.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*("(?:\\.|[^"\\])*")/g)) {
      const key = (JSON.parse(match[1]) as string).trim();
      expect(english[key], `${file}: ${key}`).toBeDefined();
      expect(russian[key], `${file}: ${key}`).toBe(key);
    }
  }
});
it("English resource values contain no untranslated Russian UI copy", () => {
  for (const [key, value] of Object.entries(english))
    expect(value, key).not.toMatch(/[А-Яа-яЁё]/);
});
