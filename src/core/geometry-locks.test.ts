import { expect, it } from "vitest";
import { applyBatch } from "./operations";
import { parseProject } from "./project";
import { sceneProject } from "./scene-fixtures";

it("rejects indirect geometry edits of a locked descendant atomically", () => {
  const project = parseProject(sceneProject());
  const frame = project.pages[0].nodes[0];
  frame.slots.content[0].locked = true;
  const before = structuredClone(project);
  expect(() =>
    applyBatch(project, {
      requestId: "locked-geometry",
      baseRevision: project.revision,
      operations: [
        { type: "setNodeMetadata", nodeId: frame.id, name: "Must not persist" },
        {
          type: "setNodeMetadata",
          nodeId: frame.id,
          scene: { x: frame.scene!.x + 10 },
        },
      ],
    }),
  ).toThrow("NODE_LOCKED");
  expect(project).toEqual(before);
});

it("permits non-geometric parent metadata and unchanged geometry above a locked child", () => {
  const project = parseProject(sceneProject());
  const frame = project.pages[0].nodes[0];
  frame.slots.content[0].locked = true;
  const next = applyBatch(project, {
    requestId: "parent-style",
    baseRevision: project.revision,
    operations: [
      {
        type: "setNodeMetadata",
        nodeId: frame.id,
        name: "Renamed",
        scene: { ...frame.scene, fill: "#123456" },
      },
    ],
  });
  expect(next.pages[0].nodes[0].name).toBe("Renamed");
  expect(next.pages[0].nodes[0].slots.content).toEqual(frame.slots.content);
});
