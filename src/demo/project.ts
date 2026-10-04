import { parseProject } from "../core/project";
import { exampleLibrary } from "../library/example";
import { libraryMetadata, toCoreTokens } from "../library/sdk";
export function demoProject() {
  return parseProject({
    schemaVersion: 2,
    projectId: "studio-demo",
    name: "Studio Playground",
    revision: 0,
    library: { id: exampleLibrary.id, version: exampleLibrary.version },
    theme: "light",
    tokens: {
      ...toCoreTokens(libraryMetadata(exampleLibrary)),
      "heading-size": { type: "number", value: 28, themes: { dark: 30 } },
    },
    pages: [
      {
        screenId: "demo-home",
        name: "Добро пожаловать",
        viewport: { width: 390 },
        nodes: [
          {
            id: "demo-title",
            type: "Text",
            props: {
              text: "Идея → интерфейс",
              size: { $token: "heading-size" },
            },
            slots: {},
          },
          {
            id: "demo-card",
            type: "Card",
            props: {
              title: "Твой следующий проект",
              description:
                "Меняй свойства, выбирай тему и собирай экран из настоящих компонентов.",
            },
            slots: {},
          },
          {
            id: "demo-button",
            type: "Button",
            props: {
              label: "Начать проект",
              variant: "primary",
              disabled: false,
            },
            slots: {},
          },
        ],
      },
      {
        screenId: "demo-details",
        name: "Карточка проекта",
        viewport: { width: 768 },
        nodes: [
          {
            id: "details-title",
            type: "Text",
            props: { text: "Всё начинается с компонента", size: 24 },
            slots: {},
          },
          {
            id: "details-card",
            type: "Card",
            props: {
              title: "Компоненты + токены",
              description:
                "Одна модель для редактора и агента. Это публичные синтетические примеры.",
            },
            slots: {},
          },
          {
            id: "details-button",
            type: "Button",
            props: {
              label: "Посмотреть исходный код",
              variant: "secondary",
              disabled: false,
            },
            slots: {},
          },
        ],
      },
    ],
  });
}
