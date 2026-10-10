import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseProject } from "./project";
import { projectSchema, batchSchema } from "../service/schema";

it("publishes the actual versioned schema and a lossless nested scene example", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../../docs/adr/scene-v2.schema.json", import.meta.url),
      "utf8",
    ),
  );
  expect(schema).toEqual(projectSchema);
  const sample = JSON.parse(
    await readFile(
      new URL("../../docs/adr/scene-v2-example.json", import.meta.url),
      "utf8",
    ),
  );
  expect(parseProject(sample)).toEqual(sample);
  expect(
    sample.pages[0].nodes[0].slots.content.map((node: any) => node.scene.kind),
  ).toEqual(["text", "vector", "component"]);
  expect(batchSchema.$defs.node.properties).toHaveProperty("scene");
});
