import type { Config } from "@puckeditor/core";
import type { ReactNode } from "react";
export const config: Config = {
  root: {
    fields: {},
    render: ({ children }: { children: ReactNode }) => (
      <div
        style={{
          padding: 24,
          minHeight: "100vh",
          background: "#f6f7f3",
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          color: "#263128",
        }}
      >
        {children}
      </div>
    ),
  },
  components: {
    Stack: {
      label: "Вертикальный блок",
      fields: {
        gap: { type: "number", label: "Отступ", min: 0, max: 64 },
        content: { type: "slot", label: "Содержимое" },
      },
      defaultProps: { gap: 16, content: [] },
      render: ({ gap, content: Content }) => (
        <Content style={{ display: "flex", flexDirection: "column", gap }} />
      ),
    },
    Card: {
      label: "Карточка",
      fields: {
        title: { type: "text", label: "Заголовок" },
        content: { type: "slot", label: "Содержимое" },
      },
      defaultProps: { title: "Карточка", content: [] },
      render: ({ title, content: Content }) => (
        <section
          style={{
            padding: 24,
            background: "#fff",
            boxShadow: "0 1px 3px #00000008, 0 0 0 1px #00000009",
            borderRadius: 16,
          }}
        >
          <h2 style={{ margin: "0 0 24px", fontSize: 20 }}>{title}</h2>
          <Content />
        </section>
      ),
    },
    Text: {
      label: "Текст",
      fields: { text: { type: "textarea", label: "Текст" } },
      defaultProps: { text: "Текст" },
      render: ({ text }) => (
        <p
          style={{
            fontSize: 13,
            color: "#7a847c",
            lineHeight: 1.6,
            overflowWrap: "anywhere",
          }}
        >
          {text}
        </p>
      ),
    },
    Button: {
      label: "Кнопка",
      fields: { label: { type: "text", label: "Подпись" } },
      defaultProps: { label: "Действие" },
      render: ({ label }) => (
        <button
          style={{
            minHeight: 44,
            background: "#254b36",
            color: "white",
            padding: "12px 20px",
            border: 0,
            borderRadius: 8,
            fontSize: 14,
          }}
          type="button"
          onClick={() => alert("Демонстрация без API")}
        >
          {label}
        </button>
      ),
    },
    Metric: {
      label: "Показатель",
      fields: {
        label: { type: "text", label: "Подпись" },
        value: { type: "text", label: "Значение" },
      },
      defaultProps: { label: "Показатель", value: "0" },
      render: ({ label, value }) => (
        <div>
          <span style={{ fontSize: 12, color: "#7a847c" }}>{label}</span>
          <strong
            style={{
              display: "block",
              fontSize: 32,
              marginTop: 6,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-1px",
              overflowWrap: "anywhere",
            }}
          >
            {value}
          </strong>
        </div>
      ),
    },
  },
};
