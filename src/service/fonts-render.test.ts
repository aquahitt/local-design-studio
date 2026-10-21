import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Project } from "../core/project";
import type { ProjectFont } from "../core/fonts";
import { projectFontFamily } from "../core/fonts";
import { renderSnapshot } from "./render";
it("capture revision readiness waits for project font bytes and reports failed font loading", async () => {
  const bytes = await readFile(
    new URL("../../tests/fixtures/fonts/studio-fixture.woff2", import.meta.url),
  );
  const font: ProjectFont = {
    id: "face",
    name: "Fixture",
    family: "Fixture",
    assetHash: createHash("sha256").update(bytes).digest("hex"),
    format: "woff2",
    weight: 400,
    style: "normal",
  };
  const project: Project = {
    schemaVersion: 2,
    projectId: "font-ready",
    name: "Font",
    revision: 1,
    library: { id: "builtin", version: "1" },
    theme: "light",
    tokens: {},
    fonts: [font],
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 390, height: 600 },
        nodes: [
          {
            id: "text",
            type: "Text",
            props: { text: "Привет World" },
            slots: {},
            scene: {
              kind: "text",
              x: 0,
              y: 0,
              width: 200,
              height: 50,
              fontSize: 20,
              textStyle: { fontId: font.id },
            },
          },
        ],
      },
    ],
  };
  const before = JSON.stringify(project);
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>((ok) => (release = ok)),
    request = new Promise<void>((ok) => (requested = ok));
  let settled = false;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  const capture = renderSnapshot(
    project,
    { pageId: "home", revision: 1 },
    {
      readAsset: async () => {
        requested();
        await gate;
        return bytes;
      },
    },
  ).then((result) => {
    settled = true;
    return result;
  });
  void capture.catch(() => {});
  try {
    await Promise.race([
      request,
      new Promise<never>((_, no) => {
        requestTimer = setTimeout(
          () => no(new Error("font was never requested")),
          10000,
        );
      }),
      capture.then(() => {
        throw new Error("Capture completed before loading the requested font");
      }),
    ]);
    clearTimeout(requestTimer);
    expect(settled).toBe(false);
    release();
    const loaded = await capture;
    expect(loaded.warnings).toEqual([]);
    expect(
      loaded.computedStyles?.find((s) => s.id === "text")?.content?.[
        "font-family"
      ],
    ).toBe(projectFontFamily(font));
  } finally {
    clearTimeout(requestTimer);
    release();
    await capture;
  }
  const failed = await renderSnapshot(
    project,
    { pageId: "home", revision: 1 },
    {
      readAsset: async () => {
        throw new Error("Unavailable");
      },
    },
  );
  expect(failed.warnings).toContain("PROJECT_FONT_UNAVAILABLE:face");
  expect(JSON.stringify(project)).toBe(before);
}, 30000);
