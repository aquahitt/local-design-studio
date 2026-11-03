import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createStudioServer } from "./server";
import { parseProject } from "../core/project";
import { sceneProject } from "../core/scene-fixtures";
import { wrapMaskGroup } from "../core/mask-groups";
import type { Operation } from "../core/operations";

it("real MCP proposes one valid mask transaction, preserves approval boundary and persists explicit source roles", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mask-contract-"));
  const initial = parseProject(sceneProject());
  const owner = await createStudioServer({
    root,
    port: 0,
    initialProject: initial,
  });
  const client = new Client({ name: "mask-contract", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/service/mcp.ts", "--project", root],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const reply = await client.callTool({ name, arguments: args });
    expect(reply.isError).not.toBe(true);
    return JSON.parse(
      (reply.content as { type: string; text: string }[]).find(
        (item) => item.type === "text",
      )!.text,
    );
  };
  const propose = async (
    requestId: string,
    baseRevision: number,
    operations: Operation[],
  ) =>
    call("proposal_create", {
      description: "Explicit mask group",
      batch: { requestId, baseRevision, operations },
    });
  const approve = async (id: string) => {
    expect(
      (
        await fetch(owner.url + `/api/proposals/${id}/approve`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${owner.token}`,
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            "x-studio-ui-token": owner.uiToken,
          },
          body: "{}",
        })
      ).status,
    ).toBe(200);
  };
  try {
    await client.connect(transport);
    expect((await call("capabilities_read")).masks).toMatchObject({
      kind: "mask",
      slot: "children",
      sourceRole: "maskSource",
      maxSources: 1,
      modes: ["alpha", "luminance"],
      sources: {
        kinds: ["frame", "vector"],
        images: false,
        text: false,
        libraryComponents: false,
      },
      operations: ["setMaskSource", "removeMask", "unwrapMask"],
    });
    const pending = await propose(
      "mask-wrap",
      0,
      wrapMaskGroup(initial, ["label", "shape"], "label", "mask"),
    );
    expect(pending.status).toBe("pending");
    expect(
      (
        await client.callTool({
          name: "proposal_apply",
          arguments: { id: pending.id },
        })
      ).isError,
    ).toBe(true);
    expect(
      parseProject(
        JSON.parse(await readFile(join(root, "project.json"), "utf8")),
      ),
    ).toEqual(initial);
    await approve(pending.id);
    expect((await call("proposal_apply", { id: pending.id })).revision).toBe(1);
    let saved = parseProject(
      JSON.parse(await readFile(join(root, "project.json"), "utf8")),
    );
    const group = saved.pages[0].nodes[0].slots.content[0];
    expect(group).toMatchObject({
      id: "mask",
      scene: { kind: "mask", maskMode: "alpha" },
    });
    expect(
      group.slots.children.map((node) => [node.id, !!node.maskSource]),
    ).toEqual([
      ["label", true],
      ["shape", false],
    ]);
    const invalid = await client.callTool({
      name: "proposal_create",
      arguments: {
        description: "Invalid final source",
        batch: {
          requestId: "mask-invalid",
          baseRevision: 1,
          operations: [
            { type: "setMaskSource", nodeId: "mask", sourceNodeId: "shape" },
            { type: "removeNode", nodeId: "shape" },
          ],
        },
      },
    });
    expect(invalid.isError).toBe(true);
    expect(
      parseProject(
        JSON.parse(await readFile(join(root, "project.json"), "utf8")),
      ),
    ).toEqual(saved);
    const removing = await propose("mask-remove", 1, [
      { type: "removeMask", nodeId: "mask" },
    ]);
    await approve(removing.id);
    expect((await call("proposal_apply", { id: removing.id })).revision).toBe(
      2,
    );
    expect(
      (await call("undo", { requestId: "mask-undo", baseRevision: 2 }))
        .revision,
    ).toBe(3);
    saved = parseProject(
      JSON.parse(await readFile(join(root, "project.json"), "utf8")),
    );
    expect(saved.pages[0].nodes[0].slots.content[0]).toEqual(group);
  } finally {
    await client.close();
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
