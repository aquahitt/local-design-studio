import { expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { projectSchema, batchSchema } from "./schema";
import { createStudioServer } from "./server";
import { parseProject } from "../core/project";
import { sceneProject } from "../core/scene-fixtures";
const guide = { id: "constructor", axis: "x", position: -20.5 };
it("schema and canonical parser agree on page guides and all four operations", async () => {
  const p = parseProject(sceneProject());
  p.pages[0].guides = [guide as never];
  const validator = new AjvJsonSchemaValidator();
  for (const schema of [
    projectSchema,
    JSON.parse(
      await readFile(
        new URL("../../docs/adr/scene-v2.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  ])
    expect(validator.getValidator(schema as never)(p).valid).toBe(true);
  const validate = validator.getValidator(batchSchema as never);
  for (const operation of [
    { type: "addGuide", pageId: "home", guide },
    { type: "moveGuide", pageId: "home", guideId: guide.id, position: 1 },
    { type: "removeGuide", pageId: "home", guideId: guide.id },
    { type: "setGuideLocked", pageId: "home", guideId: guide.id, locked: true },
  ]) {
    expect(
      validate({ requestId: "test", baseRevision: 0, operations: [operation] })
        .valid,
    ).toBe(true);
    expect(
      validate({
        requestId: "test",
        baseRevision: 0,
        operations: [{ ...operation, unexpected: true }],
      }).valid,
    ).toBe(false);
  }
  for (const invalid of [
    { ...guide, axis: "z" },
    { ...guide, id: " " },
    { ...guide, position: 1e6 + 1 },
    { ...guide, css: "red" },
  ]) {
    const source = structuredClone(p);
    source.pages[0].guides = [invalid as never];
    expect(validator.getValidator(projectSchema as never)(source).valid).toBe(
      false,
    );
    expect(() => parseProject(source)).toThrow("INVALID_GUIDE");
  }
});
it("real MCP reads guides in paged metadata and proposes one durable approval/Undo batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-guide-contract-"));
  const owner = await createStudioServer({
    root,
    port: 0,
    initialProject: parseProject(sceneProject()),
  });
  const client = new Client({ name: "guide-contract", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/service/mcp.ts", "--project", root],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      return JSON.parse(
        (result.content as { type: string; text: string }[]).find(
          (item) => item.type === "text",
        )!.text,
      );
    };
    const capabilities = await call("capabilities_read");
    expect(capabilities.guides).toMatchObject({
      scope: "page",
      coordinates: "world-css-pixels",
      exported: false,
      limits: { count: 1000, position: 1e6 },
    });
    const proposal = await call("proposal_create", {
      description: "Create guide",
      batch: {
        requestId: "guide-proposal",
        baseRevision: 0,
        operations: [
          { type: "addGuide", pageId: "home", guide },
          {
            type: "moveGuide",
            pageId: "home",
            guideId: guide.id,
            position: 40,
          },
        ],
      },
    });
    expect(proposal.status).toBe("pending");
    expect(
      (
        await client.callTool({
          name: "proposal_apply",
          arguments: { id: proposal.id },
        })
      ).isError,
    ).toBe(true);
    expect((await call("project_read")).revision).toBe(0);
    const headers = {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
      Origin: "http://localhost:5173",
    };
    expect(
      (
        await fetch(owner.url + `/api/proposals/${proposal.id}/approve`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(owner.url + `/api/proposals/${proposal.id}/approve`, {
          method: "POST",
          headers: { ...headers, "x-studio-ui-token": owner.uiToken },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    expect((await call("proposal_apply", { id: proposal.id })).revision).toBe(
      1,
    );
    for (const offset of [0, 1]) {
      const page = await call("project_read", {
        pageId: "home",
        offset,
        limit: 1,
      });
      expect(page.pages[0].guides).toEqual([{ ...guide, position: 40 }]);
    }
    expect((await call("pages_list")).pages[0].guides).toEqual([
      { ...guide, position: 40 },
    ]);
    expect(
      (await call("undo", { requestId: "guide-undo", baseRevision: 1 }))
        .revision,
    ).toBe(2);
    expect((await call("project_read")).pages[0]).not.toHaveProperty("guides");
  } finally {
    await client.close();
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
