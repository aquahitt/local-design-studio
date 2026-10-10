import type { ReactNode } from "react";
import type { ComponentLibrary } from "./sdk";
/** Compatibility renderer for portable schemaVersion=1 pilot documents. */
export const builtinLibrary: ComponentLibrary = {
  sdkVersion: 1,
  capabilities: { jsonProps: true, tokenRefs: true, slots: true },
  id: "builtin",
  version: "1",
  name: "Компоненты пилота",
  themes: [{ id: "light", name: "Светлая" }],
  tokens: [],
  components: {
    Stack: {
      name: "Вертикальный блок",
      fields: { gap: { type: "number", min: 0, max: 64 } },
      defaultProps: { gap: 16 },
      fixtures: [{ name: "Default", props: {} }],
      slots: ["content"],
      render: (p) => (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: Number(p.gap),
          }}
        >
          {p.children as ReactNode}
        </div>
      ),
    },
    Card: {
      name: "Карточка",
      fields: { title: { type: "string" } },
      defaultProps: { title: "Карточка" },
      fixtures: [{ name: "Default", props: {} }],
      slots: ["content"],
      render: (p) => (
        <section
          style={{
            padding: 24,
            background: "white",
            borderRadius: 16,
            boxShadow: "0 1px 3px #00000008,0 0 0 1px #00000009",
          }}
        >
          <h2 style={{ fontSize: 20, margin: "0 0 24px" }}>
            {String(p.title)}
          </h2>
          {p.children as ReactNode}
        </section>
      ),
    },
    Text: {
      name: "Текст",
      fields: { text: { type: "string" } },
      defaultProps: { text: "Текст" },
      fixtures: [{ name: "Default", props: {} }],
      render: (p) => (
        <p
          style={{
            fontSize: 13,
            color: "#7a847c",
            lineHeight: 1.6,
            overflowWrap: "anywhere",
          }}
        >
          {String(p.text)}
        </p>
      ),
    },
    Button: {
      name: "Кнопка",
      fields: { label: { type: "string" } },
      defaultProps: { label: "Действие" },
      fixtures: [{ name: "Default", props: {} }],
      render: (p) => (
        <button
          type="button"
          style={{
            minHeight: 44,
            background: "#254b36",
            color: "white",
            padding: "12px 20px",
            border: 0,
            borderRadius: 8,
          }}
        >
          {String(p.label)}
        </button>
      ),
    },
    Metric: {
      name: "Показатель",
      fields: { label: { type: "string" }, value: { type: "string" } },
      defaultProps: { label: "Показатель", value: "0" },
      fixtures: [{ name: "Default", props: {} }],
      render: (p) => (
        <div>
          <span style={{ fontSize: 12, color: "#7a847c" }}>
            {String(p.label)}
          </span>
          <strong
            style={{
              display: "block",
              fontSize: 32,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {String(p.value)}
          </strong>
        </div>
      ),
    },
  },
};
