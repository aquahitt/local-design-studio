// Exercise the distributable helper from an unrelated, dependency-free directory.
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const directory = await mkdtemp(join(tmpdir(), "studio-clean-release-"));
const projectRoot = join(directory, "project"),
  helper = join(directory, "studio-mcp.mjs");
await copyFile(resolve(process.argv[2] ?? "mcp-dist/studio-mcp.mjs"), helper);
let client;
async function connect() {
  client = new Client({ name: "release-clean-smoke", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [helper, "--project", projectRoot],
    cwd: directory,
    env: { STUDIO_AUTO_APPLY: "1" },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (data) => process.stderr.write(data));
  await client.connect(transport);
}
async function call(name, arguments_ = {}) {
  const result = await client.callTool({ name, arguments: arguments_ });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return JSON.parse(result.content[0].text);
}
try {
  await connect();
  const initial = await call("project_read");
  assert.equal(initial.revision, 0);
  const pageId = initial.pages[0].screenId;
  const proposal = await call("proposal_create", {
    batch: {
      requestId: "release-offline-edit",
      baseRevision: 0,
      operations: [
        {
          type: "insertNode",
          pageId,
          index: 0,
          node: {
            id: "release-text",
            type: "SceneText",
            props: { text: "Offline release smoke" },
            slots: {},
            scene: { kind: "text", x: 10, y: 20, width: 240, height: 40 },
          },
        },
      ],
    },
  });
  assert.equal(proposal.status, "approved");
  assert.equal((await call("proposal_apply", { id: proposal.id })).revision, 1);
  await client.close();
  client = undefined;
  const saved = JSON.parse(
    await readFile(join(projectRoot, "project.json"), "utf8"),
  );
  assert.equal(saved.pages[0].nodes[0].props.text, "Offline release smoke");
  await connect();
  const reopened = await call("project_read");
  assert.equal(reopened.revision, 1);
  assert.equal(reopened.pages[0].nodes[0].id, "release-text");
  const output = await call("react_export", { pageId, revision: 1 });
  assert.match(output.files["Screen.tsx"], /Offline release smoke/);
  assert.ok(output.files["Runtime.tsx"]);
  await writeFile(join(directory, "export.json"), JSON.stringify(output));
  console.log(
    JSON.stringify(
      {
        status: "passed",
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        revision: reopened.revision,
        exportFiles: Object.keys(output.files),
        network: "local stdio and loopback only; no render/browser download",
      },
      null,
      2,
    ),
  );
} finally {
  await client?.close();
  await rm(directory, { recursive: true, force: true });
}
