export function sceneProject() {
  return {
    schemaVersion: 2,
    projectId: "scene-example",
    name: "Scene example",
    revision: 0,
    library: { id: "external", version: "1" },
    theme: "light",
    tokens: {},
    groups: [
      {
        id: "screens",
        name: "Screens",
        pages: ["home"],
        components: [],
        tokens: [],
      },
    ],
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 800, height: 600 },
        nodes: [
          {
            id: "frame",
            type: "SceneFrame",
            name: "Frame",
            hidden: false,
            locked: false,
            scene: {
              kind: "frame",
              x: 40,
              y: 30,
              width: 300,
              height: 200,
              fill: "#fff",
              clip: true,
            },
            props: {},
            slots: {
              content: [
                {
                  id: "label",
                  type: "SceneText",
                  scene: {
                    kind: "text",
                    x: 10,
                    y: 20,
                    width: 120,
                    height: 40,
                    fontSize: 16,
                  },
                  props: { text: "Hello" },
                  slots: {},
                },
                {
                  id: "shape",
                  type: "SceneVector",
                  scene: {
                    kind: "vector",
                    x: 150,
                    y: 40,
                    width: 50,
                    height: 50,
                    path: "M0 0 L50 0 L25 50 Z",
                  },
                  props: {},
                  slots: {},
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function componentProject() {
  return {
    schemaVersion: 2,
    projectId: "components",
    name: "Components",
    revision: 0,
    library: { id: "external", version: "1" },
    theme: "light",
    tokens: {},
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 800 },
        nodes: [
          {
            id: "instance",
            type: "SceneComponent",
            props: {},
            slots: {},
            scene: { kind: "component", x: 100, y: 50, width: 200, height: 80 },
            instance: {
              definitionId: "button",
              variant: "primary",
              overrides: { "button-label": { text: "Override" } },
            },
          },
        ],
      },
    ],
    designComponents: [
      {
        id: "button",
        name: "Button",
        version: 1,
        nodes: [
          {
            id: "button-label",
            type: "SceneText",
            props: { text: "Default" },
            slots: {},
            scene: { kind: "text", x: 10, y: 15, width: 180, height: 40 },
          },
        ],
        variants: { primary: { "button-label": { text: "Primary" } } },
        properties: {
          label: {
            nodeId: "button-label",
            prop: "text",
            default: "Property default",
          },
        },
      },
    ],
  };
}
