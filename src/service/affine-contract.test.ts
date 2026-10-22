import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { batchSchema, projectSchema } from "./schema";
import { createStudioServer } from "./server";

it("publishes affine geometry and replacement semantics in the shared agent schema", () => {
  const scene = projectSchema.$defs.node.properties.scene as any;
  expect(scene.properties.linearTransform).toMatchObject({
    type: "array",
    minItems: 4,
    maxItems: 4,
  });
  expect(scene.allOf).toContainEqual({
    not: { required: ["rotation", "linearTransform"] },
  });
  const operations = (batchSchema as any).properties.operations.items
    .oneOf as any[];
  const geometry = operations.find(
    (op) => op.properties.type.const === "setNodeGeometry",
  );
  expect(geometry?.required).toEqual(["type", "nodeId", "geometry"]);
  expect(geometry.properties.geometry.required).toEqual([
    "x",
    "y",
    "width",
    "height",
  ]);
  expect(geometry.properties.geometry.additionalProperties).toBe(false);
  expect(geometry.properties.geometry.properties).not.toHaveProperty("fill");
});

it("HTTP exposes affine capabilities and preserves atomic geometry, proposal approval and Undo", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-affine-contract-"));
  const owner = await createStudioServer({
    root,
    port: 0,
    allowedOrigins: ["http://127.0.0.1:5198"],
  });
  const headers = {
    Authorization: `Bearer ${owner.token}`,
    Origin: "http://127.0.0.1:5198",
    "x-studio-ui-token": owner.uiToken,
    "Content-Type": "application/json",
  };
  const get = async (path: string) =>
    fetch(owner.url + path, { headers }).then((r) => r.json());
  const post = async (path: string, body: unknown) => {
    const response = await fetch(owner.url + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    // Drain even error/approval responses before closing the owned fixture.
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: response.headers,
    });
  };
  try {
    const capabilities = await get("/api/capabilities");
    expect(capabilities.geometry).toMatchObject({
      affine: true,
      resize: "layout",
      scale: "content",
      operation: "setNodeGeometry",
    });
    const before = await get("/api/project");
    const added = await post("/api/operations", {
      requestId: "affine-page",
      baseRevision: before.revision,
      operations: [
        {
          type: "addPage",
          page: {
            screenId: "affine",
            name: "Affine",
            viewport: { width: 390 },
            nodes: [
              {
                id: "affine-node",
                type: "SceneFrame",
                props: {},
                slots: {},
                scene: {
                  kind: "frame",
                  x: 10,
                  y: 20,
                  width: 100,
                  height: 80,
                  rotation: 30,
                  fill: "red",
                },
              },
            ],
          },
        },
      ],
    });
    expect(added.status).toBe(200);
    const baseline = await added.json();
    const batch = {
      requestId: "affine-replace",
      baseRevision: baseline.revision,
      operations: [
        {
          type: "setNodeGeometry",
          nodeId: "affine-node",
          geometry: {
            x: -10,
            y: 15,
            width: 100,
            height: 80,
            linearTransform: [2, 0.5, 0.25, -1],
          },
        },
      ],
    };
    const proposal = await post("/api/proposals", {
      description: "Affine preview",
      batch,
    });
    expect(proposal.status).toBe(200);
    expect(await get("/api/project")).toEqual(baseline);
    const proposalId = (await proposal.json()).id;
    expect((await post(`/api/proposals/${proposalId}/apply`, {})).status).toBe(
      403,
    );
    expect(
      (await post(`/api/proposals/${proposalId}/approve`, {})).status,
    ).toBe(200);
    const applied = await post(`/api/proposals/${proposalId}/apply`, {});
    expect(applied.status).toBe(200);
    const next = await applied.json();
    const scene = next.pages.find((p: any) => p.screenId === "affine").nodes[0]
      .scene;
    expect(scene).toEqual({
      kind: "frame",
      x: -10,
      y: 15,
      width: 100,
      height: 80,
      linearTransform: [2, 0.5, 0.25, -1],
      fill: "red",
    });
    const persisted = await readFile(join(root, "project.json"), "utf8");
    const invalid = await post("/api/operations", {
      requestId: "affine-invalid",
      baseRevision: next.revision,
      operations: [
        {
          type: "setNodeGeometry",
          nodeId: "affine-node",
          geometry: {
            x: 0,
            y: 0,
            width: 100,
            height: 80,
            linearTransform: [1, 1, 1, 1],
          },
        },
      ],
    });
    expect(invalid.status).toBe(400);
    expect(await readFile(join(root, "project.json"), "utf8")).toBe(persisted);
    expect(
      (
        await post("/api/undo", {
          requestId: "affine-undo",
          baseRevision: next.revision,
        })
      ).status,
    ).toBe(200);
    const undone = await get("/api/project");
    expect(undone.pages).toEqual(baseline.pages);
  } finally {
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
