import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";
import { demoProject } from "../demo/project";

it.skipIf(!process.env.STUDIO_DESKTOP_MCP_EXECUTABLE)(
  "installed Electron MCP entry reads a project through embedded Node stdio",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-installed-mcp-"));
    const project = demoProject();
    await writeFile(join(root, "project.json"), JSON.stringify(project));
    const client = new Client({ name: "installed-desktop-test", version: "1" });
    const args = process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [resolve(".")];
    const transport = new StdioClientTransport({
      command: process.env.STUDIO_DESKTOP_MCP_EXECUTABLE!,
      args: [...args, "--studio-mcp", "--project", root],
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      expect(
        (await client.listTools()).tools.some(
          (tool) => tool.name === "project_read",
        ),
      ).toBe(true);
      const result = await client.callTool({
        name: "project_read",
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain(project.projectId);
    } finally {
      await client.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
