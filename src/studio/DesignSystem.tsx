import { useI18n } from "./i18n";
import { useState } from "react";
import { studioPalette } from "./palette";
import type {
  ButtonHTMLAttributes,
  ReactNode,
  InputHTMLAttributes,
  CSSProperties,
} from "react";
export function StudioButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { t } = useI18n();

  return <button {...props} />;
}
export function StudioHeading({
  children,
  size,
}: {
  children: ReactNode;
  size?: number;
}) {
  const { t } = useI18n();

  return (
    <h1 style={size === undefined ? undefined : { fontSize: size }}>
      {children}
    </h1>
  );
}
export function LocalCoreNotice({ demo = false }: { demo?: boolean }) {
  const { t } = useI18n();

  return (
    <div className="ds-core-notice">
      <strong>{t("Локальное ядро")}</strong>
      <p>
        {demo
          ? t("Дизайн-система самой студии. Правки остаются в браузере.")
          : t(
              "Один документ для человека и агента. AI подключается через MCP.",
            )}
      </p>
      <a
        href={
          demo
            ? "https://github.com/aquahitt/local-design-studio#запуск"
            : "/pilot"
        }
      >
        {demo ? t("Установить локально ↗") : t("Открыть технический пилот ↗")}
      </a>
    </div>
  );
}
export const STUDIO_THEME_KEY = "local-design-studio:interface-theme";
export function readStudioTheme(): "light" | "dark" {
  try {
    return localStorage.getItem(STUDIO_THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function StudioSearch(props: InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useI18n();

  return <input type="search" {...props} />;
}
export function StudioThemeChoice({
  value,
  onChange,
}: {
  value: "light" | "dark";
  onChange: (value: "light" | "dark") => void;
}) {
  const { t } = useI18n();

  return (
    <label className="ds-theme-choice">
      {t("Тема студии")}
      <select
        aria-label={t("Тема студии")}
        value={value}
        onChange={(event) => onChange(event.target.value as "light" | "dark")}
      >
        <option value="light">{t("Светлая")}</option>
        <option value="dark">{t("Тёмная")}</option>
      </select>
    </label>
  );
}
export function StudioThemeExample() {
  const { t } = useI18n();

  const [value, setValue] = useState<"light" | "dark">("light");
  return <StudioThemeChoice value={value} onChange={setValue} />;
}
export function studioThemeStyle(theme: "light" | "dark"): CSSProperties {
  return Object.fromEntries(
    Object.entries(studioPalette).map(([name, values]) => [
      "--studio-" + name,
      values[theme === "dark" ? 1 : 0],
    ]),
  ) as CSSProperties;
}
