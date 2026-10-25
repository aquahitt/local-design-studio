import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Nodes } from "./Preview";
import { builtinLibrary } from "../library/builtin";
import type { Project, ProjectNode } from "../core/project";
import {
  geometryResult,
  withTransientGeometry,
  type SceneGeometryMap,
} from "./transientGeometry";
const text: ProjectNode = {
  id: "text",
  type: "Text",
  props: { text: "Alpha Beta Gamma" },
  slots: {},
  scene: {
    kind: "text",
    x: 5,
    y: 6,
    width: 120,
    height: 80,
    fontSize: 20,
    textStyle: { lineHeight: 24 },
  },
};
const vector: ProjectNode = {
  id: "vector",
  type: "SceneVector",
  props: {},
  slots: {},
  scene: {
    kind: "vector",
    x: 10,
    y: 100,
    width: 100,
    height: 50,
    path: "M0 0H100V50H0Z",
    fill: "blue",
    rotation: 20,
  },
};
const frame: ProjectNode = {
  id: "frame",
  type: "SceneFrame",
  props: {},
  slots: { content: [text, vector] },
  scene: {
    kind: "frame",
    x: 20,
    y: 30,
    width: 200,
    height: 240,
    linearTransform: [1, 0.2, 0, 1],
    clip: true,
  },
};
const project: Project = {
  schemaVersion: 2,
  projectId: "p",
  name: "P",
  revision: 1,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  pages: [
    {
      screenId: "page",
      name: "Page",
      viewport: { width: 390, height: 600 },
      nodes: [frame],
    },
  ],
};
const render = (p: Project, geometry?: SceneGeometryMap) =>
  renderToStaticMarkup(
    <Nodes
      nodes={p.pages[0].nodes}
      project={p}
      library={builtinLibrary}
      selected={null}
      onSelect={() => {}}
      geometry={geometry}
    />,
  );
it("text and SVG transient Resize use the same effective layout as a committed scene, including recursive slots", () => {
  const source = JSON.stringify(project);
  const { geometry } = geometryResult(
    [
      {
        type: "setNodeGeometry",
        nodeId: "text",
        geometry: { x: 5, y: 6, width: 60, height: 120 },
      },
      {
        type: "setNodeGeometry",
        nodeId: "vector",
        geometry: {
          x: 10,
          y: 100,
          width: 200,
          height: 100,
          linearTransform: [1, 0.5, 0, 1],
        },
      },
    ],
    project,
    "page",
    ["text", "vector"],
  );
  const committed = structuredClone(project);
  committed.pages[0].nodes[0].slots.content =
    committed.pages[0].nodes[0].slots.content.map((node) =>
      withTransientGeometry(node, geometry),
    );
  const html = render(project, geometry);
  expect(html).toBe(render(committed));
  expect(html).toContain('viewBox="0 0 200 100"');
  expect(html).toContain("font-size:20px");
  expect(html).toContain("width:60px;height:120px");
  expect(html).not.toContain("rotate(20deg)");
  expect(JSON.stringify(project)).toBe(source);
});
it("transient Scale changes only the wrapper and preserves text/vector layout and path", () => {
  const geometry = geometryResult(
    [
      {
        type: "setNodeGeometry",
        nodeId: "frame",
        geometry: {
          x: 20,
          y: 30,
          width: 200,
          height: 240,
          linearTransform: [2, 0.4, 0, 3],
        },
      },
    ],
    project,
    "page",
    ["frame"],
  ).geometry;
  const html = render(project, geometry);
  expect(html).toContain("matrix(2, 0.4, 0, 3, 0, 0)");
  expect(html).toContain('viewBox="0 0 100 50"');
  expect(html).toContain('d="M0 0H100V50H0Z"');
  expect(html).toContain("font-size:20px");
  expect(html).toContain("width:120px;height:80px");
});
it("canonical instance wrapper gets its override while materialized definition geometry remains local", () => {
  const p: Project = {
    ...project,
    designComponents: [{ id: "card", version: 1, name: "Card", nodes: [text] }],
    pages: [
      {
        ...project.pages[0],
        nodes: [
          {
            id: "instance",
            type: "SceneFrame",
            props: {},
            slots: {},
            instance: { definitionId: "card" },
            scene: { kind: "frame", x: 0, y: 0, width: 200, height: 150 },
          },
        ],
      },
    ],
  };
  const geometry = geometryResult(
    [
      {
        type: "setNodeGeometry",
        nodeId: "instance",
        geometry: {
          x: 20,
          y: 30,
          width: 200,
          height: 150,
          linearTransform: [2, 0, 0, 2],
        },
      },
    ],
    p,
    "page",
    ["instance"],
  ).geometry;
  const html = render(p, geometry);
  expect(html).toContain('data-node-id="instance"');
  expect(html).toContain('data-node-id="instance::text"');
  expect(html).toContain("matrix(2, 0, 0, 2, 0, 0)");
  expect(html).toContain("width:120px;height:80px");
  expect(p.designComponents![0].nodes[0]).toBe(text);
});
