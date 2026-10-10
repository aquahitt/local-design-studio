import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { I18nProvider, useI18n, translate } from "./i18n";
import { StudioSelect } from "./StudioSelect";
it("defaults to Russian and interpolates values without altering them", () => {
  expect(translate("ru", "Поиск: {0}", { 0: "My project" })).toBe(
    "Поиск: My project",
  );
  expect(translate("en", "Поиск: {0}", { 0: "Мой проект" })).toBe(
    "Search: Мой проект",
  );
  expect(translate("en", "user content")).toBe("user content");
});
it("renders shared controls in English while preserving option/project names", () => {
  function Example() {
    const { t } = useI18n();
    return (
      <StudioSelect
        label={t("Группа проекта")}
        value="mine"
        sections={[
          { label: "", options: [{ value: "mine", label: "Моя группа" }] },
        ]}
        onChange={() => {}}
      />
    );
  }
  const english = renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <Example />
    </I18nProvider>,
  );
  expect(english).toContain('aria-label="Project group"');
  expect(english).toContain("Моя группа");
  expect(
    renderToStaticMarkup(
      <I18nProvider initialLocale="ru">
        <Example />
      </I18nProvider>,
    ),
  ).toContain('aria-label="Группа проекта"');
});
