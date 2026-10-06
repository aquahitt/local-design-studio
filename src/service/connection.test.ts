import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  createOwnerRequest,
  readOwnerConnection,
  OwnerRequestError,
} from "./connection";
import { createStudioServer } from "./server";

it("refreshes credentials after 401 without altering the proposal request ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-auth-"));
  const owner = await createStudioServer({ root, port: 0 });
  try {
    const current = await readOwnerConnection(root);
    const project = await createOwnerRequest(root, current)("project");
    const request = createOwnerRequest(root, {
      ...current,
      token: "stale-token",
    });
    const batch = {
      requestId: "auth-retry",
      baseRevision: project.revision,
      operations: [
        {
          type: "renamePage",
          pageId: project.pages[0].screenId,
          name: "Retried",
        },
      ],
    };
    const proposal = await request("proposals", { batch });
    expect(proposal.batch.requestId).toBe("auth-retry");
    expect((await request("proposals")).length).toBe(1);
  } finally {
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("retries ambiguous mutation delivery once with byte-identical body and preserves structured errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-delivery-"));
  await mkdir(join(root, ".studio"));
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      bodies.push(body);
      if (bodies.length === 1) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.flushHeaders();
        res.write('{"delivered":');
        setTimeout(() => req.socket.destroy(), 25);
        return;
      }
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "INVALID_OPERATION",
          path: "operations[0].props.url",
          message: "Unsafe URL",
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const connection = {
    pid: process.pid,
    token: "local-token",
    url: `http://127.0.0.1:${address.port}`,
  };
  await writeFile(
    join(root, ".studio/connection.json"),
    JSON.stringify(connection),
  );
  try {
    const request = createOwnerRequest(root, connection);
    await expect(
      request("proposals", { batch: { requestId: "same-id", operations: [] } }),
    ).rejects.toMatchObject({
      details: {
        error: "INVALID_OPERATION",
        path: "operations[0].props.url",
        message: "Unsafe URL",
      },
    } satisfies Partial<OwnerRequestError>);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(bodies[1]).batch.requestId).toBe("same-id");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects unsafe refresh files, missing owners, remote URLs, empty tokens and dead PIDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-mcp-unsafe-"));
  await mkdir(join(root, ".studio"));
  const path = join(root, ".studio/connection.json");
  const good = {
    pid: process.pid,
    token: "local-token",
    url: "http://127.0.0.1:5190",
  };
  try {
    await expect(readOwnerConnection(root)).rejects.toThrow(
      "OWNER_NOT_RUNNING",
    );
    for (const patch of [
      { url: "https://example.org:5190" },
      { token: "" },
      { pid: 0 },
      { url: "http://127.0.0.1:5190/path" },
    ]) {
      await writeFile(path, JSON.stringify({ ...good, ...patch }));
      await expect(readOwnerConnection(root)).rejects.toThrow(
        "INVALID_CONNECTION",
      );
    }
    await writeFile(path, JSON.stringify({ ...good, pid: 2147483647 }));
    await expect(readOwnerConnection(root)).rejects.toThrow(
      "OWNER_NOT_RUNNING",
    );
    await rm(path);
    const other = join(root, "credentials.json");
    await writeFile(other, JSON.stringify(good));
    await symlink(other, path);
    await expect(readOwnerConnection(root)).rejects.toThrow("UNSAFE_SYMLINK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
