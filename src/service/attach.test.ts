import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStudioServer } from "./server";
import { connectStudioOwner } from "./attach";
it("attaches UI to existing sole owner, approves and applies, and attached close preserves owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-attach-"));
  const metadata = [{ id: "builtin", version: "1", components: {} }];
  const owner = await createStudioServer({
    root,
    port: 0,
    libraryMetadata: metadata,
  });
  try {
    const attached = await connectStudioOwner({
      root,
      port: 0,
      libraryMetadata: metadata,
    });
    expect(attached.url).toBe(owner.url);
    expect(attached.uiToken).toBe(owner.uiToken);
    const headers = {
      Authorization: `Bearer ${attached.token}`,
      "Content-Type": "application/json",
    };
    const batch = {
      requestId: "attached-edit",
      baseRevision: 0,
      operations: [{ type: "renamePage", pageId: "home", name: "Approved" }],
    };
    const p = await (
      await fetch(attached.url + "/api/proposals", {
        method: "POST",
        headers,
        body: JSON.stringify({ batch }),
      })
    ).json();
    expect(
      (
        await fetch(attached.url + `/api/proposals/${p.id}/approve`, {
          method: "POST",
          headers: {
            ...headers,
            Origin: "http://localhost:5178",
            "x-studio-ui-token": attached.uiToken,
          },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(attached.url + `/api/proposals/${p.id}/apply`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(200);
    await attached.close();
    expect((await fetch(owner.url + "/api/project", { headers })).status).toBe(
      200,
    );
    await expect(
      connectStudioOwner({ root, libraryMetadata: [] }),
    ).rejects.toThrow("OWNER_CONFIGURATION_MISMATCH");
  } finally {
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
