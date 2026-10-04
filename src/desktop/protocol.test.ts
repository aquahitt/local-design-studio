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
