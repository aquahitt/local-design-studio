import { parseProject } from "../core/project";
import { studioLibrary } from "../library/studio";
import { libraryMetadata, toCoreTokens } from "../library/sdk";
export function demoProject() {
  return parseProject({
    schemaVersion: 2,
    projectId: "studio-demo",
    name: "Дизайн-система студии",
    revision: 0,
    library: { id: studioLibrary.id, version: studioLibrary.version },
    theme: "light",
    tokens: toCoreTokens(libraryMetadata(studioLibrary)),
    pages: [
      {
        screenId: "demo-home",
        name: "Типографика и действия студии",
        viewport: { width: 768 },
        nodes: [
          {
            id: "demo-title",
            type: "Text",
            props: { text: "Предложения агента", size: 28 },
            slots: {},
          },
          {
            id: "demo-button",
            type: "Button",
            props: {
              label: "Подтвердить и применить",
              variant: "primary",
              disabled: false,
            },
            slots: {},
          },
          {
            id: "demo-secondary",
            type: "Button",
            props: {
              label: "Отменить правку",
              variant: "secondary",
              disabled: true,
            },
            slots: {},
          },
        ],
      },
      {
        screenId: "demo-details",
        name: "Локальное ядро — блок сайдбара",
        viewport: { width: 390 },
        nodes: [{ id: "demo-core", type: "LocalCore", props: {}, slots: {} }],
      },
    ],
  });
}
