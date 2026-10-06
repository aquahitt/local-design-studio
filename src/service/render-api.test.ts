import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "./server";
it("renders a frozen requested revision and rejects stale renders without mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-render-api-"));
  let calls = 0;
  const service = await createStudioServer({ root, port: 0, renderSnapshot: async (project, options) => {
    calls++; project.name = "mutated local copy";
    return { mimeType: "image/png", data: "aGVsbG8=", revision: options.revision, pageId: options.pageId, viewport: { width: 1200, height: 850 }, theme: project.theme, bounds: [], warnings: [], text: "" };
  } });
  const call = (revision: number) => fetch(service.url + "/api/render", { method: "POST", headers: { Authorization: `Bearer ${service.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ pageId: "home", revision }) });
  try {
    expect((await call(1)).status).toBe(409); expect(calls).toBe(0);
    expect((await call(0)).status).toBe(200); expect(calls).toBe(1);
    const saved = await fetch(service.url + "/api/project", { headers: { Authorization: `Bearer ${service.token}` } }).then((r) => r.json());
    expect(saved.name).toBe("Untitled"); expect(saved.revision).toBe(0);
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});
