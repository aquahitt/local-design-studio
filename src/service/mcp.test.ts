import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm, copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "./server";
import { renderSnapshot } from "./render";
import { builtinLibrary } from "../library/builtin";
import { libraryMetadata } from "../library/sdk";
it("real stdio SDK handshake reads, proposes, denies unapproved apply, applies UI approval and undoes", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-"));
  const owner = await createStudioServer({
    root,
    port: 0,
    renderSnapshot,
    libraryMetadata: [libraryMetadata(builtinLibrary)],
    initialProject: {
      schemaVersion: 2,
      projectId: "p",
      name: "Test",
      revision: 0,
      pages: [
        {
          screenId: "home",
          name: "Home",
          viewport: { width: 1200 },
          nodes: [
            { id: "text", type: "Text", props: { text: "Hi" }, slots: {} },
          ],
        },
      ],
      library: { id: "builtin", version: "1" },
      theme: "light",
      tokens: {},
      groups: [
        {
          id: "buyer",
          name: "PWA Buyer",
          pages: ["home"],
          components: ["Text"],
          tokens: [],
        },
      ],
    },
  });
  const client = new Client({ name: "test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/service/mcp.ts", "--project", root],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain(
      "project_read",
    );
    const call = async (name: string, args = {}) =>
      client.callTool({ name, arguments: args });
    const decode = (r: any) => JSON.parse(r.content[0].text);
    expect(decode(await call("project_read")).revision).toBe(0);
    expect(decode(await call("project_read")).groups[0].name).toBe("PWA Buyer");
    const screenshot: any = await call("document_render", {
      pageId: "home",
      revision: 0,
      viewport: { width: 390, height: 600 },
    });
    expect(screenshot.content[0].type).toBe("image");
    expect(screenshot.content[0].mimeType).toBe("image/png");
    expect(
      Buffer.from(screenshot.content[0].data, "base64").readUInt32BE(16),
    ).toBe(390);
    const metadata = JSON.parse(screenshot.content[1].text);
    expect(metadata).toMatchObject({ revision: 0, pageId: "home", text: "Hi" });
    expect(metadata).not.toHaveProperty("data");
    const inspected = decode(
      await call("inspect_read", {
        pageId: "home",
        revision: 0,
        nodeId: "text",
      }),
    );
    expect(inspected.component).toMatchObject({
      libraryId: "builtin",
      type: "Text",
    });
    expect(inspected.computedStyles.content["font-size"]).toBe("13px");
    const exported = decode(
      await call("react_export", { pageId: "home", revision: 0 }),
    );
    expect(exported.supported).toBe(true);
    expect(exported.files["Screen.tsx"]).toContain("Hi");

    const p = decode(
      await call("proposal_create", {
        batch: {
          requestId: "mcp-edit",
          baseRevision: 0,
          operations: [
            { type: "updateProps", nodeId: "text", props: { text: "MCP" } },
          ],
        },
        description: "MCP edit",
      }),
    );
    expect((await call("proposal_apply", { id: p.id })).isError).toBe(true);
    const approval = await fetch(owner.url + `/api/proposals/${p.id}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        "x-studio-ui-token": owner.uiToken,
      },
      body: "{}",
    });
    expect(approval.status).toBe(200);
    expect(decode(await call("proposal_apply", { id: p.id })).revision).toBe(1);
    expect(
      decode(await call("undo", { requestId: "mcp-undo", baseRevision: 1 }))
        .revision,
    ).toBe(2);
    expect(
      decode(await call("document_render", { pageId: "home", revision: 0 }))
        .error,
    ).toBe("REVISION_CONFLICT");
  } finally {
    await client.close();
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("explicit MCP project starts a headless sole owner when no connection exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-headless-"));
  const client = new Client({ name: "headless-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/service/mcp.ts", "--project", root],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const response: any = await client.callTool({
      name: "project_read",
      arguments: {},
    });
    expect(JSON.parse(response.content[0].text).schemaVersion).toBe(2);
    expect(JSON.parse(response.content[0].text).pages).toHaveLength(1);
    const components: any = await client.callTool({
      name: "components_list",
      arguments: {},
    });
    expect(
      JSON.parse(components.content[0].text).components.map(
        (component: { libraryId: string }) => component.libraryId,
      ),
    ).toContain("studio-example");
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("real MCP pages past500 nodes and publishes schema/capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-page-"));
  const owner = await createStudioServer({
    root,
    port: 0,
    initialProject: {
      schemaVersion: 2,
      projectId: "many",
      name: "Many",
      revision: 0,
      pages: [
        {
          screenId: "home",
          name: "Home",
          viewport: { width: 1200 },
          nodes: Array.from({ length: 501 }, (_, i) => ({
            id: "n" + i,
            type: "Text",
            props: { text: "" + i },
            slots: {},
          })),
        },
      ],
      library: { id: "builtin", version: "1" },
      theme: "light",
      tokens: {},
    },
  });
  const client = new Client({ name: "page-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/service/mcp.ts", "--project", root],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const call = async (name: string, args = {}) => {
    const response: any = await client.callTool({ name, arguments: args });
    return JSON.parse(response.content[0].text);
  };
  try {
    await client.connect(transport);
    const first = await call("document_read", { pageId: "home", limit: 500 });
    expect(first.pagination.nextOffset).toBe(500);
    const last = await call("document_read", {
      pageId: "home",
      offset: 500,
      limit: 500,
    });
    expect(last.nodes[0].id).toBe("n500");
    expect(last.pagination.nextOffset).toBe(null);
    expect(
      (await call("schema_read")).project.properties.schemaVersion.const,
    ).toBe(2);
    expect((await call("capabilities_read")).proposalApproval).toBe("ui");
  } finally {
    await client.close();
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("real MCP reclaims a crashed owner without deleting live-owner credentials", async () => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { readFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-crash-"));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/service/cli.ts", "--project", root, "--port", "0"],
    { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await readFile(join(root, ".studio/connection.json"));
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  expect(ready).toBe(true);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  const client = new Client({ name: "recover-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/service/mcp.ts", "--project", root],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const response: any = await client.callTool({
      name: "project_read",
      arguments: {},
    });
    expect(JSON.parse(response.content[0].text).schemaVersion).toBe(2);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("headless MCP honors only the explicit operator auto-apply environment policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-auto-"));
  const client = new Client({ name: "auto-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/service/mcp.ts", "--project", root],
    cwd: process.cwd(),
    env: { STUDIO_AUTO_APPLY: "1" },
    stderr: "pipe",
  });
  const call = async (name: string, args = {}) => {
    const response: any = await client.callTool({ name, arguments: args });
    return JSON.parse(response.content[0].text);
  };
  try {
    await client.connect(transport);
    expect((await call("capabilities_read")).autoApply).toBe(true);
    const project = await call("project_read");
    const proposal = await call("proposal_create", {
      batch: {
        requestId: "operator-auto",
        baseRevision: 0,
        operations: [
          {
            type: "renamePage",
            pageId: project.pages[0].screenId,
            name: "Auto approved",
          },
        ],
      },
    });
    expect(proposal.status).toBe("approved");
    expect((await call("proposal_apply", { id: proposal.id })).revision).toBe(
      1,
    );
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("standalone external manifest is available through a real headless MCP client", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-external-"));
  const client = new Client({ name: "external-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/service/mcp.ts", "--project", root],
    cwd: process.cwd(),
    env: {
      ...process.env,
      STUDIO_LIBRARY_ROOT: join(process.cwd(), "examples/library/external"),
      STUDIO_AUTO_APPLY: "0",
    } as Record<string, string>,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const response: any = await client.callTool({
      name: "components_list",
      arguments: {},
    });
    expect(
      JSON.parse(response.content[0].text).components.some(
        (c: any) => c.libraryId === "external-example" && c.id === "Notice",
      ),
    ).toBe(true);
    const detail: any = await client.callTool({
      name: "component_read",
      arguments: { libraryId: "external-example", id: "Notice" },
    });
    const metadata = JSON.parse(detail.content[0].text);
    expect(metadata.fields.tone.options).toEqual(["info", "warning"]);
    const result: any = await client.callTool({
      name: "project_read",
      arguments: {},
    });
    expect(JSON.parse(result.content[0].text).schemaVersion).toBe(2);
    expect(JSON.parse(result.content[0].text).library.id).toBe(
      "external-example",
    );
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("a connected MCP follows owner replacement and reports missing owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-swap-"));
  let owner = await createStudioServer({ root, port: 0 });
  const client = new Client({ name: "swap-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/service/mcp.ts", "--project", root],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const call = async () => {
    const response: any = await client.callTool({
      name: "project_read",
      arguments: {},
    });
    return JSON.parse(response.content[0].text);
  };
  try {
    await client.connect(transport);
    expect((await call()).schemaVersion).toBe(2);
    await owner.close();
    owner = await createStudioServer({ root, port: 0 });
    expect((await call()).schemaVersion).toBe(2);
    await owner.close();
    expect((await call()).error).toBe("OWNER_NOT_RUNNING");
  } finally {
    await client.close();
    await owner.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("launcher connects from an unrelated cwd and compact tools separate full schemas and tokens", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-launcher-"));
  const owner = await createStudioServer({
    root,
    port: 0,
    libraryMetadata: [libraryMetadata(builtinLibrary)],
  });
  const client = new Client({ name: "launcher-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "scripts/mcp.mjs"), "--project", root],
    cwd: tmpdir(),
    stderr: "pipe",
  });
  const call = async (name: string, arguments_ = {}) => {
    const response: any = await client.callTool({
      name,
      arguments: arguments_,
    });
    return JSON.parse(response.content[0].text);
  };
  try {
    await client.connect(transport);
    const list = await call("components_list", {
      libraryId: "builtin",
      limit: 1,
    });
    expect(list.components).toHaveLength(1);
    expect(list.pagination.nextOffset).toBe(1);
    expect(list.components[0].fields).toBeInstanceOf(Array);
    expect(list.components[0].defaultProps).toBeUndefined();
    const full = await call("component_read", {
      libraryId: list.components[0].libraryId,
      id: list.components[0].id,
    });
    expect(full.fields).not.toBeInstanceOf(Array);
    expect(full.defaultProps).toBeDefined();
    expect((await call("pages_list")).tokens).toBeUndefined();
    const project = await call("project_read");
    expect(project.tokens).toBeDefined();
    expect(
      (await call("document_read", { pageId: project.pages[0].screenId }))
        .tokens,
    ).toBeUndefined();
  } finally {
    await client.close();
    await owner.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("bundled standalone helper runs without checkout dependencies from another cwd", async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    process.execPath,
    [join(process.cwd(), "scripts/mcp-build.mjs")],
    { cwd: tmpdir() },
  );
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-bundle-"));
  const helper = join(root, "studio-mcp.mjs");
  await copyFile(join(process.cwd(), "mcp-dist/studio-mcp.mjs"), helper);
  const client = new Client({ name: "bundle-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [helper, "--project", join(root, "project")],
    cwd: tmpdir(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const response: any = await client.callTool({
      name: "components_list",
      arguments: {},
    });
    expect(
      JSON.parse(response.content[0].text).components.length,
    ).toBeGreaterThan(0);
    const projectResult: any = await client.callTool({
      name: "project_read",
      arguments: {},
    });
    const currentProject = JSON.parse(projectResult.content[0].text);
    const renderResult: any = await client.callTool({
      name: "document_render",
      arguments: {
        pageId: currentProject.pages[0].screenId,
        revision: currentProject.revision,
      },
    });
    expect(renderResult.isError).toBe(true);
    expect(JSON.parse(renderResult.content[0].text).error).toBe(
      "RENDER_UNAVAILABLE",
    );
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("MCP reads portable decisions and orphaned anchors after owner restart and project.json clone", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-discussions-"));
  const cloneRoot = join(root, "clone");
  let owner = await createStudioServer({
    root,
    port: 0,
    autoApply: true,
    initialProject: {
      schemaVersion: 2,
      projectId: "discussions",
      name: "Discussions",
      revision: 0,
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
              id: "text",
              type: "Text",
              props: { text: "Original" },
              slots: {},
            },
          ],
        },
      ],
    },
  });
  const connect = async (directory: string) => {
    const client = new Client({ name: "annotations-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(process.cwd(), "scripts/mcp.mjs"), "--project", directory],
        cwd: tmpdir(),
        stderr: "pipe",
      }),
    );
    return client;
  };
  let client: Client | undefined, clonedClient: Client | undefined;
  const call = async (name: string, args = {}) => {
    const result: any = await client!.callTool({ name, arguments: args });
    return JSON.parse(result.content[0].text);
  };
  try {
    client = await connect(root);
    const proposal = await call("proposal_create", {
      batch: {
        requestId: "mcp-discussion",
        baseRevision: 0,
        operations: [
          {
            type: "setAnnotations",
            annotations: [
              {
                id: "a",
                pageId: "home",
                nodeId: "text",
                text: "Discussion survives deletion",
                status: "resolved",
                decision: "Use option",
                proposalId: "linked-review",
                createdAt: "2026-10-06T00:00:00.000Z",
              },
            ],
          },
          {
            type: "duplicatePage",
            pageId: "home",
            newPageId: "variant",
            name: "Variant",
          },
          { type: "removeNode", nodeId: "text" },
        ],
      },
    });
    expect(proposal.status).toBe("approved");
    expect((await call("proposal_apply", { id: proposal.id })).revision).toBe(
      1,
    );
    const expected = await call("annotations_read", { orphaned: true });
    expect(expected.annotations[0]).toMatchObject({
      orphaned: true,
      decision: "Use option",
      proposalId: "linked-review",
    });
    await owner.close();
    owner = await createStudioServer({ root, port: 0 });
    expect(await call("annotations_read", { orphaned: true })).toEqual(
      expected,
    );
    await mkdir(cloneRoot);
    await copyFile(join(root, "project.json"), join(cloneRoot, "project.json"));
    clonedClient = await connect(cloneRoot);
    const copied: any = await clonedClient.callTool({
      name: "annotations_read",
      arguments: { orphaned: true },
    });
    expect(JSON.parse(copied.content[0].text)).toEqual(expected);
    const clonedProject: any = await clonedClient.callTool({
      name: "pages_list",
      arguments: {},
    });
    expect(
      JSON.parse(clonedProject.content[0].text).pages[1].provenance,
    ).toEqual({ sourcePageId: "home", sourceRevision: 0 });
  } finally {
    await clonedClient?.close();
    await client?.close();
    await owner.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
