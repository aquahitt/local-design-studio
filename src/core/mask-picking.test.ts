import { expect, it } from "vitest";
import type { ProjectNode } from "./project";
import { hitTestScene, sceneLayers } from "./scene";
it("normal bounding-box picking skips the source role and its descendants without changing canonical hidden flags", () => {
  const nodes: ProjectNode[] = [
    {
      id: "mask",
      type: "SceneMask",
      props: {},
      scene: {
        kind: "mask",
        maskMode: "alpha",
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      },
      slots: {
        children: [
          {
            id: "content",
            type: "SceneFrame",
            props: {},
            slots: {},
            scene: {
              kind: "frame",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              fill: "#f00",
            },
          },
          {
            id: "source",
            type: "SceneFrame",
            props: {},
            maskSource: true,
            scene: {
              kind: "frame",
              x: 20,
              y: 20,
              width: 60,
              height: 60,
              fill: "#fff",
            },
            slots: {
              children: [
                {
                  id: "source-child",
                  type: "SceneVector",
                  props: {},
                  slots: {},
                  scene: {
                    kind: "vector",
                    x: 0,
                    y: 0,
                    width: 10,
                    height: 10,
                    path: "M0 0H10V10Z",
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ];
  expect(hitTestScene(nodes, { x: 25, y: 25 })).toBe("content");
  const layers = sceneLayers(nodes);
  expect(
    layers.find((layer) => layer.node.id === "source-child"),
  ).toMatchObject({ hidden: false, maskSourceOf: "mask" });
  expect(nodes[0].slots.children[1]).not.toHaveProperty("hidden");
});
