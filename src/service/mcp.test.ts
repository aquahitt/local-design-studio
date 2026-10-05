import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "./server";
it("real stdio SDK handshake reads, proposes, denies unapproved apply, applies UI approval and undoes", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-"));
  const owner = await createStudioServer({
    root,
    port: 0,
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
      JSON.parse(components.content[0].text).map(
        (library: { id: string }) => library.id,
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
    const metadata = JSON.parse(response.content[0].text).find(
      (l: any) => l.id === "external-example",
    );
    expect(metadata.sdkVersion).toBe(1);
    expect(metadata.components.Notice.fields.tone.options).toEqual([
      "info",
      "warning",
    ]);
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
