import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Project } from "../core/project";
import { prepareRenderSnapshot, type RenderOptions } from "./render";
import { createStudioServer } from "./server";

const project: Project = {
  schemaVersion: 2,
  projectId: "capture-options",
  name: "Capture options",
  revision: 7,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 390 },
      nodes: [
        {
          id: "parent",
          type: "Stack",
          props: { gap: 16 },
          slots: {
            content: [
              { id: "child", type: "Text", props: { text: "Hi" }, slots: {} },
            ],
          },
        },
      ],
    },
  ],
};
const legacy: RenderOptions = { pageId: "home", revision: 7 };

describe("capture option preparation", () => {
  it.each([undefined, "child"])(
    "preserves legacy defaults with nodeId=%s",
    (nodeId) => {
      const input = prepareRenderSnapshot(project, { ...legacy, nodeId });
      expect(input).toMatchObject({
        boundsMode: "layout",
        captureMode: "scene",
        exposeCaptureMetadata: false,
        nodeId,
        viewport: { width: 390, height: 850 },
        theme: "light",
      });
    },
  );

  it.each([
    ["layout", "scene"],
    ["visual", "scene"],
    ["layout", "isolated"],
    ["visual", "isolated"],
  ] as const)(
    "accepts orthogonal %s bounds and %s capture",
    (boundsMode, captureMode) => {
      expect(
        prepareRenderSnapshot(project, {
          ...legacy,
          nodeId: "child",
          boundsMode,
          captureMode,
        }),
      ).toMatchObject({ boundsMode, captureMode, exposeCaptureMetadata: true });
    },
  );

  it("defaults each omitted mode independently and retains viewport capture without a node", () => {
    expect(
      prepareRenderSnapshot(project, { ...legacy, boundsMode: "visual" }),
    ).toMatchObject({
      boundsMode: "visual",
      captureMode: "scene",
      nodeId: undefined,
      viewport: { width: 390, height: 850 },
      exposeCaptureMetadata: true,
    });
    expect(
      prepareRenderSnapshot(project, {
        ...legacy,
        nodeId: "child",
        captureMode: "isolated",
      }),
    ).toMatchObject({
      boundsMode: "layout",
      captureMode: "isolated",
      exposeCaptureMetadata: true,
    });
    expect(
      prepareRenderSnapshot(project, { ...legacy, boundsMode: "layout" }),
    ).toMatchObject({
      boundsMode: "layout",
      captureMode: "scene",
      exposeCaptureMetadata: true,
    });
    expect(
      prepareRenderSnapshot(project, { ...legacy, captureMode: "scene" }),
    ).toMatchObject({
      boundsMode: "layout",
      captureMode: "scene",
      exposeCaptureMetadata: true,
    });
  });

  it("treats explicit undefined modes as omitted", () => {
    expect(
      prepareRenderSnapshot(project, {
        ...legacy,
        boundsMode: undefined,
        captureMode: undefined,
      }),
    ).toMatchObject({
      boundsMode: "layout",
      captureMode: "scene",
      exposeCaptureMetadata: false,
    });
  });

  it.each([
    null,
    [],
    { ...legacy, unknown: true },
    { ...legacy, boundsMode: null },
    { ...legacy, boundsMode: "tight" },
    { ...legacy, boundsMode: 1 },
    { ...legacy, captureMode: null },
    { ...legacy, captureMode: "node" },
    { ...legacy, captureMode: false },
    { ...legacy, captureMode: "isolated" },
  ])("rejects invalid capture options before browser work: %j", (options) => {
    expect(() =>
      prepareRenderSnapshot(project, options as RenderOptions),
    ).toThrow("INVALID_RENDER_OPTIONS");
  });

  it("preserves revision, page and node errors for valid capture modes", () => {
    expect(() =>
      prepareRenderSnapshot(project, {
        ...legacy,
        revision: 6,
        boundsMode: "visual",
      }),
    ).toThrow("REVISION_CONFLICT");
    expect(() =>
      prepareRenderSnapshot(project, {
        ...legacy,
        pageId: "absent",
        boundsMode: "visual",
      }),
    ).toThrow("PAGE_NOT_FOUND");
    expect(() =>
      prepareRenderSnapshot(project, {
        ...legacy,
        nodeId: "absent",
        captureMode: "isolated",
      }),
    ).toThrow("NODE_NOT_FOUND");
    expect(() =>
      prepareRenderSnapshot(project, {
        ...legacy,
        nodeId: null,
        captureMode: "isolated",
      } as unknown as RenderOptions),
    ).toThrow("NODE_NOT_FOUND");
  });

  it("clones the document and viewport without modifying options", () => {
    const source = structuredClone(project);
    const options = {
      ...legacy,
      nodeId: "child",
      boundsMode: "visual" as const,
      captureMode: "isolated" as const,
      viewport: { width: 600, height: 400 },
    };
    const before = structuredClone({ source, options });
    const input = prepareRenderSnapshot(source, options);
    expect({ source, options }).toEqual(before);
    input.page.nodes[0].slots.content[0].props.text = "Changed snapshot";
    input.viewport.width = 900;
    expect({ source, options }).toEqual(before);
  });
});

it("real stdio MCP advertises capture modes and forwards explicit values without adding legacy options", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-capture-options-"));
  const captured: RenderOptions[] = [];
  const owner = await createStudioServer({
    root,
    port: 0,
    initialProject: project,
    renderSnapshot: async (snapshot, options) => {
      captured.push(structuredClone(options));
      return {
        mimeType: "image/png",
        data: "aGVsbG8=",
        revision: snapshot.revision,
        pageId: options.pageId,
        viewport: { width: 390, height: 850 },
        theme: snapshot.theme,
        bounds: [],
        warnings: [],
        text: "",
      };
    },
  });
  const client = new Client({ name: "capture-options-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/service/mcp.ts", "--project", root],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const tool = (await client.listTools()).tools.find(
      (entry) => entry.name === "document_render",
    )!;
    expect(tool.inputSchema.properties).toMatchObject({
      boundsMode: { type: "string", enum: ["layout", "visual"] },
      captureMode: { type: "string", enum: ["scene", "isolated"] },
    });
    const explicit = {
      ...legacy,
      nodeId: "child",
      boundsMode: "visual",
      captureMode: "isolated",
    };
    expect(
      (await client.callTool({ name: "document_render", arguments: explicit }))
        .isError,
    ).not.toBe(true);
    expect(captured).toEqual([explicit]);
    expect(
      (
        await client.callTool({
          name: "document_render",
          arguments: { ...legacy },
        })
      ).isError,
    ).not.toBe(true);
    expect(captured[1]).toEqual(legacy);
    expect(captured[1]).not.toHaveProperty("boundsMode");
    expect(captured[1]).not.toHaveProperty("captureMode");
  } finally {
    await client.close();
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
