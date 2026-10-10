import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { translate } from "../src/studio/locales";
import { selectStudioOption } from "./select-helpers";

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 180; count++) {
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      await expect(target).toBeFocused();
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(
    `Geometry action is unreachable by Tab: ${await target.ariaSnapshot()}`,
  );
}

for (const locale of ["ru", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale}/${theme}: accessible world alignment across rotated parents is one durable undoable action`, async ({
      page,
    }, testInfo) => {
      const t = (value: string) => translate(locale, value);
      await page.addInitScript(
        ({ locale, theme }) => {
          localStorage.setItem("local-design-studio:locale", locale);
          localStorage.setItem("local-design-studio:interface-theme", theme);
        },
        { locale, theme },
      );
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(
        page.getByLabel(t("Тема студии"), { exact: true }),
      ).toHaveValue(theme);
      const pageId = `world-alignment-${locale}-${theme}`;
      const state = await page.evaluate(async (pageId) => {
        const session = await fetch("/api/session").then((response) =>
          response.json(),
        );
        const headers = {
          Authorization: `Bearer ${session.token}`,
          "x-studio-ui-token": session.uiToken,
          "Content-Type": "application/json",
        };
        const project = await fetch("/api/project", { headers }).then(
          (response) => response.json(),
        );
        const scene = (
          x: number,
          y: number,
          width: number,
          height: number,
          rotation = 0,
        ) => ({
          kind: "frame",
          x,
          y,
          width,
          height,
          rotation,
          fill: "#ffffff",
        });
        const nodes = [
          {
            id: `geo-parent-${pageId}`,
            name: "Parent",
            type: "SceneFrame",
            props: {},
            scene: scene(100, 100, 200, 200, 90),
            slots: {
              content: [
                {
                  id: `geo-child-${pageId}`,
                  name: "Nested",
                  type: "SceneFrame",
                  props: {},
                  slots: {},
                  scene: scene(10, 20, 40, 10),
                },
              ],
            },
          },
          {
            id: `geo-outside-${pageId}`,
            name: "Outside",
            type: "SceneFrame",
            props: {},
            slots: {},
            scene: scene(150, 180, 30, 20, -90),
          },
          {
            id: `geo-last-${pageId}`,
            name: "Last",
            type: "SceneFrame",
            props: {},
            slots: {},
            scene: scene(300, 200, 20, 10),
          },
        ];
        const response = await fetch("/api/operations", {
          method: "POST",
          headers,
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            baseRevision: project.revision,
            operations: [
              {
                type: "addPage",
                page: {
                  screenId: pageId,
                  name: pageId,
                  viewport: { width: 800, height: 700 },
                  nodes,
                },
              },
            ],
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        return { headers, nodes, revision: (await response.json()).revision };
      }, pageId);
      const read = () =>
        page.evaluate(
          async ({ headers, pageId }) => {
            const project = await fetch("/api/project", { headers }).then(
              (response) => response.json(),
            );
            return {
              revision: project.revision,
              nodes: project.pages.find((item: any) => item.screenId === pageId)
                .nodes,
            };
          },
          { headers: state.headers, pageId },
        );
      await expect(page.getByTestId("save-status")).toContainText(
        (locale === "ru" ? "ревизия " : "revision ") + state.revision,
      );
      await page
        .getByRole("button", { name: t("Экраны"), exact: true })
        .click();
      await selectStudioOption(page, t("Экран"), pageId);
      await page
        .getByRole("button", {
          name: t("Выделить ") + `geo-child-${pageId}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("checkbox", {
          name: t("Выбрать слой ") + "Outside",
          exact: true,
        })
        .check();
      await page
        .getByRole("checkbox", {
          name: t("Выбрать слой ") + "Last",
          exact: true,
        })
        .check();
      const toolbar = page.getByRole("group", {
        name: t("Выравнивание и промежутки"),
        exact: true,
      });
      const labels = [
        "Выровнять по левому краю",
        "Выровнять по центру горизонтально",
        "Выровнять по правому краю",
        "Выровнять по верхнему краю",
        "Выровнять по центру вертикально",
        "Выровнять по нижнему краю",
        "Равные промежутки по горизонтали",
        "Равные промежутки по вертикали",
      ];
      await expect(toolbar.getByRole("button")).toHaveCount(labels.length);
      // Reach the first action through the real tab order, then verify every icon
      // button has a translated name, tooltip, sufficient target and native focus.
      await tabTo(
        page,
        toolbar.getByRole("button", { name: t(labels[0]), exact: true }),
      );
      for (const label of labels) {
        const button = toolbar.getByRole("button", {
          name: t(label),
          exact: true,
        });
        await expect(button).toBeFocused();
        await expect(button).toHaveAttribute("title", t(label));
        await expect(button).toBeEnabled();
        const bounds = await button.boundingBox();
        expect(bounds!.width).toBeGreaterThanOrEqual(40);
        expect(bounds!.height).toBeGreaterThanOrEqual(40);
        if (label !== labels.at(-1)) await page.keyboard.press("Tab");
      }
      for (let index = 1; index < labels.length; index++)
        await page.keyboard.press("Shift+Tab");
      await expect(
        toolbar.getByRole("button", { name: t(labels[0]), exact: true }),
      ).toBeFocused();
      const audit = await new AxeBuilder({ page })
        .include(
          `[role="group"][aria-label=${JSON.stringify(t("Выравнивание и промежутки"))}]`,
        )
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(audit.violations, `${locale}/${theme} geometry toolbar`).toEqual(
        [],
      );
      await toolbar.screenshot({
        path: testInfo.outputPath("geometry-actions.png"),
      });
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/operations") &&
          response.request().method() === "POST",
      );
      await page.keyboard.press("Enter");
      expect((await saved).ok()).toBe(true);
      await expect
        .poll(async () => (await read()).revision)
        .toBe(state.revision + 1);
      const preview = page.frameLocator(
        `iframe[title="${t("Экран ")}${pageId}"]`,
      );
      const left = (id: string) =>
        preview
          .locator(`[data-node-id="${id}"]`)
          .evaluate((node) => node.getBoundingClientRect().left);
      await expect
        .poll(async () =>
          Math.abs(
            (await left(`geo-child-${pageId}`)) -
              (await left(`geo-outside-${pageId}`)),
          ),
        )
        .toBeLessThan(0.01);
      expect(await left(`geo-child-${pageId}`)).toBeCloseTo(
        await left(`geo-last-${pageId}`),
      );
      await page
        .getByRole("button", {
          name: t("Равные промежутки по горизонтали"),
          exact: true,
        })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        t(
          "Недостаточно места для равных промежутков. Раздвинь крайние объекты.",
        ),
      );
      expect((await read()).revision).toBe(state.revision + 1);
      await page
        .getByRole("button", { name: t("Отменить правку"), exact: true })
        .click();
      await expect.poll(async () => (await read()).nodes).toEqual(state.nodes);
      expect((await read()).revision).toBe(state.revision + 2);
      await page
        .getByRole("button", {
          name: t("Равные промежутки по горизонтали"),
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await read()).revision)
        .toBe(state.revision + 3);
      const right = (id: string) =>
        preview
          .locator(`[data-node-id="${id}"]`)
          .evaluate((node) => node.getBoundingClientRect().right);
      await expect
        .poll(async () =>
          Math.abs(
            (await left(`geo-outside-${pageId}`)) -
              (await right(`geo-child-${pageId}`)) -
              ((await left(`geo-last-${pageId}`)) -
                (await right(`geo-outside-${pageId}`))),
          ),
        )
        .toBeLessThan(0.01);
      await page
        .getByRole("button", {
          name: t("Равные промежутки по горизонтали"),
          exact: true,
        })
        .click();
      // The second click must not write a no-op transaction or add an undo step.
      await expect(
        page.getByRole("button", {
          name: t("Равные промежутки по горизонтали"),
          exact: true,
        }),
      ).toBeEnabled();
      expect((await read()).revision).toBe(state.revision + 3);
      await page
        .getByRole("button", { name: t("Отменить правку"), exact: true })
        .click();
      await expect.poll(async () => (await read()).nodes).toEqual(state.nodes);
    });
  }
}
