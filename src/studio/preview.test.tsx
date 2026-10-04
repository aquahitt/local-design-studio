import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Nodes } from "./Preview";
import type { ComponentLibrary } from "../library/sdk";
import { parseProject } from "../core/project";
it("preserves leaf children props while rendering nested slots", () => {
  const library: ComponentLibrary = {
    id: "leaf",
    version: "1",
    name: "Leaf",
    themes: [],
    tokens: [],
    components: {
      Label: {
        name: "Label",
        fields: {},
        defaultProps: { children: "Default label" },
        fixtures: [],
        render: (props) => <div>{props.children as string}</div>,
      },
    },
  };
  const project = parseProject({
    schemaVersion: 2,
    projectId: "p",
    name: "P",
    revision: 0,
    library: { id: "leaf", version: "1" },
    theme: "light",
    tokens: {},
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 390 },
        nodes: [
          {
            id: "leaf",
            type: "Label",
            props: { children: "Actual label" },
            slots: {},
          },
        ],
      },
    ],
  });
  expect(
    renderToStaticMarkup(
      <Nodes
        nodes={project.pages[0].nodes}
        library={library}
        project={project}
        selected={null}
        onSelect={() => {}}
      />,
    ),
  ).toContain("Actual label");
});
