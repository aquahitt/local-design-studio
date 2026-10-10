import { expect, it } from "vitest";
import { demoProject } from "./project";
import { studioLibrary } from "../library/studio";
import { getConfiguredLibraryMetadata } from "../../scripts/library/plugin";
import { validateComponentProps } from "../service/schema";
it("demo uses registered studio components and tokens, excluding illustrative libraries", () => {
  const project = demoProject();
  const metadata = getConfiguredLibraryMetadata({ studioOnly: true });
  expect(metadata.map((l) => l.id)).toEqual(["studio-ui"]);
  expect(project.library.id).toBe(studioLibrary.id);
  for (const page of project.pages)
    for (const node of page.nodes)
      expect(studioLibrary.components[node.type]).toBeDefined();
  expect(() => validateComponentProps(project, metadata)).not.toThrow();
  expect(project.tokens["studio-bg"].themes?.dark).toBe("#151922");
});
