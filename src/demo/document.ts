import type { Screen } from "../model/document";
export const demo: Screen = {
  schemaVersion: 1,
  screenId: "budget",
  revision: 0,
  name: "Бюджет ремонта",
  viewport: { width: 390 },
  nodes: [
    {
      id: "layout",
      type: "Stack",
      props: { gap: 16 },
      slots: {
        content: [
          {
            id: "summary",
            type: "Card",
            props: { title: "Бюджет" },
            slots: {
              content: [
                {
                  id: "total",
                  type: "Metric",
                  props: { label: "Осталось", value: "240 000 ₽" },
                  slots: {},
                },
                {
                  id: "note",
                  type: "Text",
                  props: { text: "Расходы на ремонт" },
                  slots: {},
                },
              ],
            },
          },
          {
            id: "add",
            type: "Button",
            props: { label: "Добавить расход" },
            slots: {},
          },
        ],
      },
    },
  ],
};
