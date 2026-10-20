import { it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "./server";

it("imports immutable font bytes with UI permission before a separate revision-checked document operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-font-service-"));
  const owner = await createStudioServer({
    root,
    port: 0,
    allowedOrigins: ["http://127.0.0.1:5198"],
  });
  const base = {
    Authorization: `Bearer ${owner.token}`,
    "Content-Type": "application/json",
  };
  const ui = {
    ...base,
    Origin: "http://127.0.0.1:5198",
    "x-studio-ui-token": owner.uiToken,
  };
  const bytes = await readFile(
    new URL("../../tests/fixtures/fonts/studio-fixture.ttf", import.meta.url),
  );
  const input = { data: bytes.toString("base64"), name: "Portable face" };
  const post = (path: string, body: unknown, headers = ui) =>
    fetch(owner.url + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  try {
    const before = await readFile(join(root, "project.json"), "utf8"),
      project = JSON.parse(before);
    expect((await post("/api/fonts", input, base as typeof ui)).status).toBe(
      403,
    );
    expect(
      (await post("/api/fonts", { ...input, path: "../secret" })).status,
    ).toBe(400);
    const uploaded = await post("/api/fonts", input);
    expect(uploaded.status).toBe(200);
    const asset = await uploaded.json();
    expect(asset).toMatchObject({
      family: "Studio Fixture Mono",
      weight: 400,
      style: "normal",
      format: "ttf",
    });
    expect(await readFile(join(root, "project.json"), "utf8")).toBe(before);
    const response = await fetch(owner.url + "/api/" + asset.path, {
      headers: base,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("font/ttf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect((await fetch(owner.url + "/api/" + asset.path)).status).toBe(401);
    const { path, bytes: byteCount, ...descriptor } = asset;
    const font = { ...descriptor, id: "imported-face" };
    const added = await post("/api/operations", {
      requestId: "font-register",
      baseRevision: project.revision,
      operations: [{ type: "addProjectFont", font }],
    });
    expect(added.status).toBe(200);
    const next = await added.json();
    expect(next.fonts).toEqual([font]);
    expect(next.revision).toBe(project.revision + 1);
    const repeat = await post("/api/fonts", input);
    expect(await repeat.json()).toEqual(asset);
    expect(
      JSON.parse(await readFile(join(root, "project.json"), "utf8")),
    ).toEqual(next);
  } finally {
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
