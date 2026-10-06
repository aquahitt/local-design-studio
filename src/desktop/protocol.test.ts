import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesktopHandler } from "../../desktop/protocol";
it("serves packaged UI, preview route and rejects paths outside bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-protocol-"));
  try {
    await writeFile(join(root, "index.html"), "<h1>Studio</h1>");
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets/app.js"), "console.log(1)");
    const handle = createDesktopHandler(root, () => undefined);
    expect(
      await (await handle(new Request("studio://app/preview"))).text(),
    ).toContain("Studio");
    expect(
      (await handle(new Request("studio://app/assets/app.js"))).status,
    ).toBe(200);
    expect((await handle(new Request("studio://evil/"))).status).toBe(403);
    expect((await handle(new Request("studio://preview/preview"))).status).toBe(
      200,
    );
    expect(
      (await handle(new Request("studio://preview/api/session"))).status,
    ).toBe(403);
    expect(
      (await handle(new Request("studio://app/%2e%2e%2fsecret"))).status,
    ).toBe(403);
    expect((await handle(new Request("studio://app/api/session"))).status).toBe(
      503,
    );
    expect((await handle(new Request("studio://app/missing.js"))).status).toBe(
      404,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("bootstraps only active credentials and proxies with restricted origin", async () => {
  const session = {
    url: "http://127.0.0.1:54321",
    token: "agent-secret",
    uiToken: "ui-secret",
  };
  let sent: any;
  const handle = createDesktopHandler(
    "/unused",
    () => session,
    async (url, init) => {
      sent = { url, init };
      return new Response('{"revision":1}', {
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  expect(
    await (await handle(new Request("studio://app/api/session"))).json(),
  ).toEqual({ token: "agent-secret", uiToken: "ui-secret" });
  const response = await handle(
    new Request("studio://app/api/operations", {
      method: "POST",
      headers: {
        authorization: "Bearer agent-secret",
        "x-studio-ui-token": "ui-secret",
      },
      body: "{}",
    }),
  );
  expect(response.status).toBe(200);
  expect(sent.url).toBe(session.url + "/api/operations");
  expect(sent.init.headers.Origin).toBe("studio://app");
  expect((await handle(new Request("studio://app/api/arbitrary"))).status).toBe(
    404,
  );
});
it("desktop UI rejects proposals through protocol while preview and agents cannot reject", async () => {
  const { createStudioServer } = await import("../service/server");
  const root = await mkdtemp(join(tmpdir(), "studio-protocol-reject-"));
  const owner = await createStudioServer({
    root,
    port: 0,
    allowedOrigins: ["studio://app"],
  });
  try {
    const project = await fetch(owner.url + "/api/project", {
      headers: { Authorization: `Bearer ${owner.token}` },
    }).then((r) => r.json());
    const proposal = await fetch(owner.url + "/api/proposals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch: {
          requestId: "desktop-reject",
          baseRevision: project.revision,
          operations: [
            {
              type: "renamePage",
              pageId: project.pages[0].screenId,
              name: "Proposed name",
            },
          ],
        },
      }),
    }).then((r) => r.json());
    const handle = createDesktopHandler("/unused", () => ({
      url: owner.url,
      token: owner.token,
      uiToken: owner.uiToken,
    }));
    const path = "/api/proposals/" + proposal.id + "/reject";
    const req = (host: string, ui = false) =>
      new Request("studio://" + host + path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${owner.token}`,
          ...(ui ? { "x-studio-ui-token": owner.uiToken } : {}),
        },
        body: "{}",
      });
    expect((await handle(req("preview", true))).status).toBe(403);
    expect((await handle(req("app"))).status).toBe(403);
    const response = await handle(req("app", true));
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("rejected");
  } finally {
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("serves only the active library bundle on the isolated preview origin", async () => {
  const { mkdtemp, writeFile, rm, symlink, realpath } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "studio-bundle-protocol-")),
  );
  try {
    await writeFile(join(root, "library.js"), "export default {};");
    const bundle = { id: "active", root, files: ["library.js", "linked.js"] };
    const handler = createDesktopHandler(
      root,
      () => undefined,
      fetch,
      () => bundle,
    );
    expect(
      (await handler(new Request("studio://preview/library/active/library.js")))
        .status,
    ).toBe(200);
    expect(
      (await handler(new Request("studio://app/library/active/library.js")))
        .status,
    ).toBe(403);
    expect(
      (await handler(new Request("studio://preview/library/old/library.js")))
        .status,
    ).toBe(404);
    expect(
      (
        await handler(
          new Request("studio://preview/library/active/secrets.json"),
        )
      ).status,
    ).toBe(404);
    await symlink(join(root, "library.js"), join(root, "linked.js"));
    expect(
      (await handler(new Request("studio://preview/library/active/linked.js")))
        .status,
    ).toBe(403);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
