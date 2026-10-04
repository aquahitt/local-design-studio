import type { ComponentLibrary, Props } from "./sdk";
export const exampleLibrary: ComponentLibrary = {
  sdkVersion: 1,
  capabilities: { jsonProps: true, tokenRefs: true, slots: true },
  id: "studio-example",
  version: "1.0.0",
  name: "Studio example",
  themes: [
    { id: "light", name: "Light" },
    { id: "dark", name: "Dark", className: "dark" },
  ],
  tokens: [
    {
      name: "--example-accent",
      value: "#315ad8",
      source: "example",
      category: "color",
      themes: { light: "#315ad8", dark: "#8caaff" },
    },
    {
      name: "--accent-text",
      value: "var(--example-accent)",
      source: "example",
      category: "color",
    },
    {
      name: "--bg",
      value: "#f5f7fb",
      source: "example",
      category: "color",
      themes: { light: "#f5f7fb", dark: "#121826" },
    },
    {
      name: "--text-primary",
      value: "#17202c",
      source: "example",
      category: "color",
      themes: { light: "#17202c", dark: "#edf2ff" },
    },
    {
      name: "--text-secondary",
      value: "#536174",
      source: "example",
      category: "color",
      themes: { light: "#536174", dark: "#b3bfd4" },
    },
    {
      name: "--surface-raised",
      value: "#ffffff",
      source: "example",
      category: "color",
      themes: { light: "#ffffff", dark: "#202b3c" },
    },
    {
      name: "--hairline",
      value: "#d8deea",
      source: "example",
      category: "color",
      themes: { light: "#d8deea", dark: "#40516a" },
    },
    {
      name: "--on-accent",
      value: "#ffffff",
      source: "example",
      category: "color",
      themes: { light: "#ffffff", dark: "#111a2c" },
    },
  ],
  components: {
    Button: {
      name: "Button",
      category: "Controls",
      fields: {
        label: { type: "string" },
        disabled: { type: "boolean" },
        variant: { type: "select", options: ["primary", "secondary"] },
      },
      defaultProps: { label: "Continue", disabled: false, variant: "primary" },
      fixtures: [
        { name: "Default", props: {} },
        { name: "Disabled", props: { disabled: true } },
        {
          name: "Long text",
          props: { label: "Continue with your selected configuration" },
        },
      ],
      states: ["default", "disabled", "long-text"],
      render: (p: Props) => (
        <button
          disabled={Boolean(p.disabled)}
          style={{
            border: "1px solid var(--example-accent)",
            borderRadius: 8,
            padding: "10px 18px",
            background:
              p.variant === "secondary"
                ? "var(--surface-raised)"
                : "var(--example-accent)",
            color:
              p.variant === "secondary"
                ? "var(--example-accent)"
                : "var(--on-accent)",
            opacity: p.disabled ? 0.5 : 1,
          }}
        >
          {String(p.label ?? "Continue")}
        </button>
      ),
    },
    Card: {
      name: "Card",
      category: "Layout",
      fields: { title: { type: "string" }, description: { type: "string" } },
      defaultProps: {
        title: "A local component",
        description: "This library works in a clean clone.",
      },
      fixtures: [{ name: "Default", props: {} }],
      render: (p) => (
        <article
          style={{
            padding: 24,
            border: "1px solid var(--hairline)",
            borderRadius: 12,
            background: "var(--surface-raised)",
            color: "var(--text-primary)",
          }}
        >
          <h3>{String(p.title)}</h3>
          <p>{String(p.description)}</p>
        </article>
      ),
    },
    Text: {
      name: "Text",
      category: "Typography",
      fields: {
        text: { type: "string" },
        size: { type: "number", min: 12, max: 64 },
      },
      defaultProps: { text: "Design with real components", size: 20 },
      fixtures: [{ name: "Default", props: {} }],
      render: (p) => (
        <p style={{ fontSize: Number(p.size), color: "var(--text-primary)" }}>
          {String(p.text)}
        </p>
      ),
    },
  },
};
