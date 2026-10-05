import {
  StudioSearch,
  StudioThemeExample,
  StudioButton,
  StudioHeading,
  LocalCoreNotice,
} from "../studio/DesignSystem";
import { studioPalette } from "../studio/palette";
import type { ComponentLibrary } from "./sdk";
export const studioLibrary: ComponentLibrary = {
  sdkVersion: 1,
  capabilities: { jsonProps: true, tokenRefs: true, slots: false },
  id: "studio-ui",
  version: "1.0.0",
  name: "Дизайн-система студии",
  themes: [
    { id: "light", name: "Светлая" },
    { id: "dark", name: "Тёмная", className: "dark" },
  ],
  tokens: [
    ...Object.entries(studioPalette).map(([name, values]) => ({
      name: "--studio-" + name,
      value: values[0],
      source: "studio",
      category: "color",
      themes: { light: values[0], dark: values[1] },
    })),
    {
      name: "--bg",
      value: "var(--studio-bg)",
      source: "studio",
      category: "color",
    },
    {
      name: "--text-primary",
      value: "var(--studio-text)",
      source: "studio",
      category: "color",
    },
  ],
  components: {
    Button: {
      name: "Кнопка студии",
      category: "Управление",
      description:
        "Тот же компонент, что в панели инструментов и действиях студии.",
      fields: {
        label: { type: "string" },
        disabled: { type: "boolean" },
        variant: { type: "select", options: ["primary", "secondary"] },
      },
      defaultProps: {
        label: "Экспорт проекта ↗",
        disabled: false,
        variant: "secondary",
      },
      fixtures: [
        { name: "Экспорт", props: {} },
        {
          name: "Основное действие",
          props: { label: "Применить свойства", variant: "primary" },
        },
        {
          name: "Недоступное действие",
          props: { label: "Отменить правку", disabled: true },
        },
      ],
      render: (p) => (
        <div className="ds-studio ds-component">
          <StudioButton
            className={p.variant === "primary" ? "accent" : undefined}
            disabled={Boolean(p.disabled)}
          >
            {String(p.label)}
          </StudioButton>
        </div>
      ),
    },
    Text: {
      name: "Заголовок раздела",
      category: "Типографика",
      fields: {
        text: { type: "string" },
        size: { type: "number", min: 12, max: 64 },
      },
      defaultProps: { text: "Предложения агента", size: 28 },
      fixtures: [
        { name: "Предложения агента", props: {} },
        { name: "Основы", props: { text: "Токены и темы" } },
      ],
      render: (p) => (
        <div
          className="ds-studio ds-component ds-content"
          style={{ padding: 0 }}
        >
          <StudioHeading size={Number(p.size)}>{String(p.text)}</StudioHeading>
        </div>
      ),
    },
    Search: {
      name: "Поиск компонентов",
      category: "Управление",
      fields: { placeholder: { type: "string" } },
      defaultProps: { placeholder: "Найти компонент…" },
      fixtures: [{ name: "Библиотека компонентов", props: {} }],
      render: (p) => (
        <div className="ds-studio ds-component section-title catalog-heading">
          <StudioSearch
            aria-label="Поиск компонентов"
            placeholder={String(p.placeholder)}
          />
        </div>
      ),
    },
    ThemeChoice: {
      name: "Выбор темы студии",
      category: "Управление",
      fields: {},
      defaultProps: {},
      fixtures: [{ name: "Настройка интерфейса", props: {} }],
      render: () => (
        <div className="ds-studio ds-component">
          <StudioThemeExample />
        </div>
      ),
    },
    LocalCore: {
      name: "Локальное ядро",
      category: "Навигация",
      fields: {},
      defaultProps: {},
      fixtures: [{ name: "Сайдбар", props: {} }],
      render: () => (
        <div className="ds-studio ds-component">
          <LocalCoreNotice demo />
        </div>
      ),
    },
  },
};
