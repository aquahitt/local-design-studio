import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { translate } from "../../src/studio/locales";
for (const locale of ["ru", "en"] as const)
  for (const theme of ["light", "dark"] as const) {
    test(`${locale}/${theme}: mask controls expose keyboard choices, accessible names and safe source editing`, async ({
      page,
    }) => {
      const t = (text: string) => translate(locale, text);
      await page.setViewportSize({ width: 1600, height: 1200 });
      await page.addInitScript(
        ({ locale, theme }) => {
          localStorage.setItem("local-design-studio:locale", locale);
          localStorage.setItem("local-design-studio:interface-theme", theme);
        },
        { locale, theme },
      );
      await page.goto("/");
      const id = "a11y-mask-" + crypto.randomUUID();
      await page.evaluate(async (id) => {
        const session = await fetch("/api/session").then((r) => r.json()),
          headers = {
            Authorization: "Bearer " + session.token,
            "Content-Type": "application/json",
            "x-studio-ui-token": session.uiToken,
          };
        const project = await fetch("/api/project", { headers }).then((r) =>
          r.json(),
        );
        const response = await fetch("/api/operations", {
          method: "POST",
          headers,
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            baseRevision: project.revision,
            operations: [
              {
                type: "insertNode",
                pageId: project.pages[0].screenId,
                index: project.pages[0].nodes.length,
                node: {
                  id,
                  type: "SceneMask",
                  name: "Accessible mask",
                  props: {},
                  scene: {
                    kind: "mask",
                    maskMode: "alpha",
                    x: 20,
                    y: 20,
                    width: 160,
                    height: 100,
                  },
                  slots: {
                    children: [
                      {
                        id: id + "-source",
                        name: "Source",
                        type: "SceneFrame",
                        maskSource: true,
                        props: {},
                        slots: {},
                        scene: {
                          kind: "frame",
                          x: 10,
                          y: 10,
                          width: 60,
                          height: 60,
                          fill: "#fff",
                        },
                      },
                      {
                        id: id + "-content",
                        name: "Content",
                        type: "SceneFrame",
                        props: {},
                        slots: {},
                        scene: {
                          kind: "frame",
                          x: 0,
                          y: 0,
                          width: 160,
                          height: 100,
                          fill: "#f00",
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }),
        });
        if (!response.ok) throw new Error(await response.text());
      }, id);
      await page.reload();
      await page
        .getByRole("button", { name: t("Экраны"), exact: true })
        .click();
      await page
        .getByRole("button", { name: t("Выделить ") + id, exact: true })
        .click();
      const mode = page.getByRole("combobox", {
        name: t("Режим маски"),
        exact: true,
      });
      await mode.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("option", {
          name: t("По прозрачности (alpha)"),
          exact: true,
        }),
      ).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(mode).toBeFocused();
      await page
        .getByRole("button", { name: t("Редактировать источник"), exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: t("Удалить выбранные"), exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByText(t("Сначала сними маску или выбери другой источник."), {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    });
  }
