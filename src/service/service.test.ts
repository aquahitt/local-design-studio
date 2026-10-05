import { it, expect } from "vitest";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createStudioServer } from "./server";
const initialProject: any = {
  schemaVersion: 2,
  projectId: "p",
  name: "Test",
  revision: 0,
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 1200 },
      nodes: [{ id: "text", type: "Text", props: { text: "Hi" }, slots: {} }],
    },
  ],
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
};
it("authenticates fixed-root API and requires separate UI authorization for durable proposals", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-service-"));
  const service = await createStudioServer({ root, initialProject, port: 0 });
  const headers = {
    Authorization: `Bearer ${service.token}`,
    "Content-Type": "application/json",
  };
  const call = (path: string, body?: unknown, extra = {}) =>
    fetch(service.url + path, {
      method: body ? "POST" : "GET",
      headers: { ...headers, ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    expect((await fetch(service.url + "/api/project")).status).toBe(401);
    expect(
      (await call("/api/project", undefined, { Origin: "https://evil.test" }))
        .status,
    ).toBe(403);
    expect(
      await new Promise<number | undefined>((resolve, reject) => {
        const req = request(
          service.url + "/api/project",
          { headers: { ...headers, Host: "evil.test" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      }),
    ).toBe(403);
    expect((await call("/api/assets/secret")).status).toBe(400);
    expect(
      (
        await call("/api/operations", {
          requestId: "big",
          baseRevision: 0,
          operations: [],
          padding: "x".repeat(1048577),
        })
      ).status,
    ).toBe(413);
    expect((await call("/api/project")).status).toBe(200);
    expect(
      (
        await call("/api/operations", {
          requestId: "bypass",
          baseRevision: 0,
          operations: [],
        })
      ).status,
    ).toBe(403);
    const batch = {
      requestId: "change",
      baseRevision: 0,
      operations: [
        { type: "updateProps", nodeId: "text", props: { text: "Changed" } },
      ],
    };
    const proposal = await (
      await call("/api/proposals", { batch, description: "Change heading" })
    ).json();
    expect((await call(`/api/proposals/${proposal.id}/apply`, {})).status).toBe(
      403,
    );
    expect(
      (await call(`/api/proposals/${proposal.id}/approve`, { ui: true }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          `/api/proposals/${proposal.id}/approve`,
          {},
          {
            Origin: "http://localhost:5173",
            "x-studio-ui-token": service.uiToken,
          },
        )
      ).status,
    ).toBe(200);
    const applied = await (
      await call(`/api/proposals/${proposal.id}/apply`, {})
    ).json();
    expect(applied.revision).toBe(1);
    expect(
      (
        await call(
          "/api/operations",
          { ...batch, requestId: "conflict" },
          {
            Origin: "http://localhost:5173",
            "x-studio-ui-token": service.uiToken,
          },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await (
          await call("/api/undo", { requestId: "undo", baseRevision: 1 })
        ).json()
      ).pages[0].nodes[0].props.text,
    ).toBe("Hi");
    const credential = JSON.parse(
      await readFile(join(root, ".studio/connection.json"), "utf8"),
    );
    expect(credential.token).toBe(service.token);
    expect(credential.uiToken).toBeUndefined();
    const uiCredential = JSON.parse(
      await readFile(join(root, ".studio/ui-connection.json"), "utf8"),
    );
    expect(uiCredential.uiToken).toBe(service.uiToken);
    expect(uiCredential.token).toBeUndefined();
    if (process.platform !== "win32") {
      expect(
        (await stat(join(root, ".studio/ui-connection.json"))).mode & 0o777,
      ).toBe(0o600);
      expect(
        (await stat(join(root, ".studio/connection.json"))).mode & 0o777,
      ).toBe(0o600);
    }
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("restores approved proposals across owner restart and retries creates and applies idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-restart-"));
  let service = await createStudioServer({ root, initialProject, port: 0 });
  const batch = {
    requestId: "retry",
    baseRevision: 0,
    operations: [
      { type: "updateProps", nodeId: "text", props: { text: "Durable" } },
    ],
  };
  const call = (path: string, body?: unknown, extra = {}) =>
    fetch(service.url + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${service.token}`,
        "Content-Type": "application/json",
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const p = await (await call("/api/proposals", { batch })).json();
    expect((await (await call("/api/proposals", { batch })).json()).id).toBe(
      p.id,
    );
    await call(
      `/api/proposals/${p.id}/approve`,
      {},
      { Origin: "http://localhost:5173", "x-studio-ui-token": service.uiToken },
    );
    await service.close();
    service = await createStudioServer({ root, port: 0 });
    expect((await (await call(`/api/proposals/${p.id}`)).json()).status).toBe(
      "approved",
    );
    expect(
      (await (await call(`/api/proposals/${p.id}/apply`, {})).json()).revision,
    ).toBe(1);
    expect(
      (await (await call(`/api/proposals/${p.id}/apply`, {})).json()).revision,
    ).toBe(1);
    expect((await (await call("/api/project")).json()).revision).toBe(1);
    await call("/api/context", {
      clientId: "tab",
      pageId: "home",
      selectedIds: ["text"],
      viewport: { width: 1200 },
    });
    expect((await (await call("/api/context")).json()).connected).toBe(true);
    await call("/api/context", {
      clientId: "tab",
      pageId: "home",
      selectedIds: [],
      connected: false,
    });
    expect((await (await call("/api/context")).json()).connected).toBe(false);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("accepts safe SVG only from UI and serves authenticated immutable assets across reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-http-asset-"));
  let owner = await createStudioServer({ root, port: 0 });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#fff"/></svg>';
  const upload = (body: unknown, ui = false) =>
    fetch(owner.url + "/api/assets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
        ...(ui
          ? {
              Origin: "http://localhost:5178",
              "x-studio-ui-token": owner.uiToken,
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    expect((await upload({ svg })).status).toBe(403);
    expect((await upload({ svg: '<svg onload="bad"/>' }, true)).status).toBe(
      400,
    );
    const response = await upload({ svg }, true);
    expect(response.status).toBe(200);
    const asset = await response.json();
    await owner.close();
    owner = await createStudioServer({ root, port: 0 });
    expect((await fetch(owner.url + "/api/" + asset.path)).status).toBe(401);
    const image = await fetch(owner.url + "/api/" + asset.path, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(image.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(image.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(await image.text()).toBe(svg);
  } finally {
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("only UI can reject; rejection survives restart and cannot be approved or applied", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-reject-"));
  let service = await createStudioServer({ root, initialProject, port: 0 });
  const call = (path: string, body: unknown, ui = false) =>
    fetch(service.url + path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${service.token}`,
        "Content-Type": "application/json",
        ...(ui
          ? {
              Origin: "http://localhost:5173",
              "x-studio-ui-token": service.uiToken,
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    const p = await (
      await call("/api/proposals", {
        batch: {
          requestId: "reject-me",
          baseRevision: 0,
          operations: [
            {
              type: "updateProps",
              nodeId: "text",
              props: { text: "Never applied" },
            },
          ],
        },
      })
    ).json();
    const path = "/api/proposals/" + p.id;
    expect((await call(path + "/reject", {})).status).toBe(403);
    expect((await call(path + "/reject", {}, true)).status).toBe(200);
    expect((await call(path + "/reject", {}, true)).status).toBe(200);
    expect((await call(path + "/approve", {}, true)).status).toBe(409);
    expect((await call(path + "/apply", {})).status).toBe(403);
    await service.close();
    service = await createStudioServer({ root, initialProject, port: 0 });
    const list = await fetch(service.url + "/api/proposals", {
      headers: { Authorization: `Bearer ${service.token}` },
    }).then((r) => r.json());
    expect(list[0].status).toBe("rejected");
    const project = await fetch(service.url + "/api/project", {
      headers: { Authorization: `Bearer ${service.token}` },
    }).then((r) => r.json());
    expect(project.revision).toBe(0);
    expect(project.pages[0].nodes[0].props.text).toBe("Hi");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
