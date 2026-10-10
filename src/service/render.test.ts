import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { renderSnapshot, prepareRenderSnapshot } from "./render";
import { applyBatch } from "../core/operations";
import type { Project } from "../core/project";
const project: Project = {
  schemaVersion: 2,
  projectId: "render-test",
  name: "Render test",
  revision: 7,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 1280, height: 600 },
      nodes: [
        {
          id: "text",
          type: "Text",
          props: { text: "Screenshot text at the selected revision" },
          slots: {},
        },
      ],
    },
  ],
};
it("rendering rejects stale revisions, missing pages, unsafe widths and unknown selection before browser work", () => {
  expect(() =>
    prepareRenderSnapshot(project, { revision: 6, pageId: "home" }),
  ).toThrow("REVISION_CONFLICT");
  expect(() =>
    prepareRenderSnapshot(project, { revision: 7, pageId: "missing" }),
  ).toThrow("PAGE_NOT_FOUND");
  expect(() =>
    prepareRenderSnapshot(project, {
      revision: 7,
      pageId: "home",
      nodeId: "missing",
    }),
  ).toThrow("NODE_NOT_FOUND");
  expect(() =>
    prepareRenderSnapshot(project, {
      revision: 7,
      pageId: "home",
      viewport: { width: 1 },
    }),
  ).toThrow("INVALID_VIEWPORT");
});
it("actual browser screenshots use the preview renderer at 390 and 1280 widths with revision and bounds", async () => {
  const before = JSON.stringify(project);
  const edited = applyBatch(project, {
    requestId: "agent-text-screenshot",
    baseRevision: 7,
    operations: [
      {
        type: "updateProps",
        nodeId: "text",
        props: {
          text: "Screenshot text at the selected revision. The agent replaced a short label with a longer explanation to verify real text wrapping on narrow mobile screens and wide desktop screens before approving a visual change.",
        },
      },
    ],
  });
  const heights: number[] = [];
  for (const width of [390, 1280]) {
    const rendered = await renderSnapshot(edited, {
      revision: 8,
      pageId: "home",
      viewport: { width, height: 600 },
    });
    expect(rendered.revision).toBe(8);
    expect(rendered.viewport.width).toBe(width);
    expect(rendered.mimeType).toBe("image/png");
    const bytes = Buffer.from(rendered.data, "base64");
    await writeFile(join(tmpdir(), `studio-alpha3-render-${width}.png`), bytes);
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(width);
    expect(bytes.readUInt32BE(20)).toBe(600);
    expect(rendered.bounds).toMatchObject([{ id: "text" }]);
    expect(rendered.bounds[0].width).toBeLessThanOrEqual(width);
    expect(rendered.bounds[0].height).toBeGreaterThan(10);
    heights.push(rendered.bounds[0].height);
    expect(rendered.warnings).toEqual([]);
    // The real preview wraps the real component; actual rendered text is recorded for accessibility and QA.
    expect(rendered.text).toContain("Screenshot text at the selected revision");
  }
  expect(heights[0]).toBeGreaterThan(heights[1]);
  expect(JSON.stringify(project)).toBe(before);
  expect(edited.revision).toBe(8);
}, 60000);

it("captures an operator-enabled external component and node crop using its real theme", async () => {
  const external = {
    ...project,
    library: { id: "external-example", version: "1.0.0" },
    theme: "dark",
    pages: [
      {
        ...project.pages[0],
        nodes: [
          {
            id: "notice",
            type: "Notice",
            props: { message: "Operator library screenshot", tone: "warning" },
            slots: {},
          },
        ],
      },
    ],
  };
  const result = await renderSnapshot(
    external,
    {
      revision: 7,
      pageId: "home",
      nodeId: "notice",
      viewport: { width: 390, height: 600 },
    },
    {
      externalRoot: join(process.cwd(), "examples/library/external"),
    },
  );
  expect(result.nodeId).toBe("notice");
  expect(result.theme).toBe("dark");
  expect(result.text).toContain("Operator library screenshot");
  expect(result.text).toContain("Warning");
  const bytes = Buffer.from(result.data, "base64");
  expect(bytes.readUInt32BE(16)).toBe(Math.ceil(result.bounds[0].width));
  expect(bytes.readUInt32BE(20)).toBe(Math.ceil(result.bounds[0].height));
  expect(result.warnings).toEqual([]);
  await writeFile(
    join(tmpdir(), "studio-alpha3-render-external-node.png"),
    bytes,
  );
}, 60000);
