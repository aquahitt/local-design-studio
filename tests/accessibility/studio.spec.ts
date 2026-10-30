import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { translate } from "../../src/studio/locales";

test("editor and group dialog have no WCAG A/AA violations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Управлять группами" }),
  ).toBeVisible();
  const audit = () =>
    new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
  expect((await audit()).violations).toEqual([]);
  const invoker = page.getByRole("button", { name: "Управлять группами" });
  await invoker.focus();
  await invoker.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Управление группами" }),
  ).toBeVisible();
  expect((await audit()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(invoker).toBeFocused();
});

test("custom select supports keyboard choice and restores focus on Escape", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("combobox", {
    name: "Группа проекта",
    exact: true,
  });
  await trigger.focus();
  await trigger.press("ArrowDown");
  const search = page.getByRole("combobox", {
    name: "Поиск: Группа проекта",
    exact: true,
  });
  await expect(search).toBeFocused();
  await search.press("End");
  await expect(search).toHaveAttribute("aria-activedescendant", /.+-\d+$/);
  await search.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.press("ArrowDown");
  await search.fill("Без группы");
  await search.press("Enter");
  await expect(trigger).toContainText("Без группы");
  await expect(trigger).toBeFocused();
});

test("locale preference survives reload and user project text stays unchanged", async ({
  page,
}) => {
  await page.goto("/");
  const heading = await page.locator(".ds-project strong").textContent();
  await page.getByLabel("Язык студии", { exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("button", { name: "Manage groups" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Studio language", { exact: true })).toHaveValue(
    "en",
  );
  await expect(
    page.getByRole("button", { name: "Manage groups" }),
  ).toBeVisible();
  expect(await page.locator(".ds-project strong").textContent()).toBe(heading);
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await page.getByRole("button", { name: "Text +", exact: true }).click();
  const properties = await page
    .getByLabel("Properties JSON", { exact: true })
    .inputValue();
  expect(JSON.parse(properties).text).toBe("Новый текст");
});

test("layer keyboard commands share undoable actions and leave text editing alone", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  const rows = page.locator(".layer-row");
  const before = await rows.count();
  // Read the owner's exact operation response through APIRequestContext before
  // fulfilling it to Chromium. The browser may discard a response body when the
  // preview document is replaced; its resource lifetime is not a save receipt.
  let pendingSave:
    | {
        resolve: (value: { revision: number }) => void;
        reject: (reason: unknown) => void;
      }
    | undefined;
  await page.route("**/api/operations", async (route) => {
    const pending = pendingSave;
    pendingSave = undefined;
    try {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response });
      if (pending) {
        expect(response.ok()).toBe(true);
        pending.resolve(body);
      }
    } catch (error) {
      if (pending) pending.reject(error);
      else throw error;
    }
  });
  const savedOperation = () =>
    new Promise<{ revision: number }>((resolve, reject) => {
      if (pendingSave)
        throw new Error("An operation receipt is already pending");
      pendingSave = { resolve, reject };
    });
  const savedFrame = savedOperation();
  await page.getByRole("button", { name: "Фрейм +", exact: true }).click();
  const frameRevision = (await savedFrame).revision;
  await expect(rows).toHaveCount(before + 1);
  await expect(page.getByTestId("save-status")).toContainText(
    "ревизия " + frameRevision,
  );
  const count = await rows.count();
  const mod = await page.evaluate(() =>
    /Mac/.test(navigator.platform) ? "Meta" : "Control",
  );
  const savedDuplicate = savedOperation();
  await page.keyboard.press(`${mod}+d`);
  const duplicateRevision = (await savedDuplicate).revision;
  await expect(rows).toHaveCount(count + 1);
  await expect(page.getByTestId("save-status")).toContainText(
    "ревизия " + duplicateRevision,
  );
  await page.keyboard.press(`${mod}+z`);
  await expect(rows).toHaveCount(count);
  await rows.last().getByRole("button").click();
  const input = page.getByLabel("Название слоя", { exact: true });
  await input.focus();
  await input.fill("Typing draft");
  await input.press("Backspace");
  await expect(rows).toHaveCount(count);
  await expect(input).toHaveValue("Typing draf");
});

test("locale switch preserves the selected screen/layer and unsaved inspector draft", async ({
  page,
}) => {
  const sessions: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/session")
      sessions.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page.getByRole("button", { name: "Экран +", exact: true }).click();
  await expect(page.locator(".layer-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Текст +", exact: true }).click();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await expect(page.getByTestId("save-status")).toContainText("Сохранено");
  const screenName = await page
    .getByRole("combobox", { name: "Экран", exact: true })
    .textContent();
  const selected = page.locator(".layer-row").getByRole("button");
  const selectedLabel = await selected.getAttribute("aria-label");
  const draft = JSON.stringify({ text: "Несохранённый ввод · user content" });
  await page.getByLabel("Свойства JSON", { exact: true }).fill(draft);
  await page.getByLabel("Язык студии", { exact: true }).selectOption("en");
  // Polling must use the new language without reopening the connection.
  await expect(page.getByTestId("save-status")).toContainText(
    "Saved locally · revision",
  );
  await expect(page.getByLabel("Properties JSON", { exact: true })).toHaveValue(
    draft,
  );
  await expect(
    page.getByRole("combobox", { name: translate("en", "Экран"), exact: true }),
  ).toHaveText(screenName!);
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(await selected.getAttribute("aria-label")).toBe(
    selectedLabel!.replace("Выделить ", translate("en", "Выделить ")),
  );
  expect(sessions).toHaveLength(1);
});

for (const locale of ["ru", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale}/${theme}: rulers and guide dialog support keyboard focus and accessible drafts`, async ({
      page,
    }) => {
      test.setTimeout(60000);
      const { selectStudioOption } = await import("../select-helpers");
      const t = (source: string) => translate(locale, source);
      await page.setViewportSize({ width: 1600, height: 1200 });
      // Locale/theme are fixture setup; the actual ruler/dialog path below uses Tab/Enter.
      await page.addInitScript(
        ({ locale, theme }) => {
          localStorage.setItem("local-design-studio:locale", locale);
          localStorage.setItem("local-design-studio:interface-theme", theme);
        },
        { locale, theme },
      );
      await page.goto("/");
      await expect(
        page.getByRole("button", { name: t("Экраны"), exact: true }),
      ).toBeVisible();
      const readDocument = () =>
        page.evaluate(async () => {
          const session = await fetch("/api/session").then((response) =>
            response.json(),
          );
          const response = await fetch("/api/project", {
            headers: { Authorization: `Bearer ${session.token}` },
          });
          if (!response.ok)
            throw new Error(`Project read failed: ${response.status}`);
          return response.json();
        });
      const fixture = await page.evaluate(async () => {
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
        const screenId = "a11y-guides-" + crypto.randomUUID();
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
                  screenId,
                  name: screenId,
                  viewport: { width: 800, height: 600 },
                  nodes: [
                    {
                      id: screenId + "-frame",
                      type: "SceneFrame",
                      props: {},
                      slots: { content: [] },
                      scene: {
                        kind: "frame",
                        x: 40,
                        y: 40,
                        width: 300,
                        height: 200,
                        fill: "#ffffff",
                      },
                    },
                  ],
                  guides: [
                    { id: screenId + "-x", axis: "x", position: 100 },
                    {
                      id: screenId + "-y",
                      axis: "y",
                      position: 160,
                      locked: true,
                    },
                  ],
                },
              },
            ],
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        return { screenId, revision: (await response.json()).revision };
      });
      try {
        await expect(page.getByTestId("save-status")).toHaveText(
          t("Сохранено локально · ревизия ") + fixture.revision,
        );
        await page
          .getByRole("button", { name: t("Экраны"), exact: true })
          .click();
        await selectStudioOption(page, t("Экран"), fixture.screenId);
        const edit = page.getByRole("button", {
          name: t("Редактирование холста"),
          exact: true,
        });
        if ((await edit.getAttribute("aria-pressed")) !== "true")
          await edit.click();
        await expect(
          page.getByRole("region", { name: t("Свободный холст"), exact: true }),
        ).toBeVisible();
        const rulers = page.getByRole("button", {
          name: t("Линейки"),
          exact: true,
        });
        if ((await rulers.getAttribute("aria-pressed")) !== "true")
          await rulers.click();
        const canonical = await readDocument();
        const tabTo = async (target: import("@playwright/test").Locator) => {
          await expect(target).toBeVisible();
          for (let count = 0; count < 160; count++) {
            if (
              await target.evaluate(
                (element) => element === document.activeElement,
              )
            )
              return;
            await page.keyboard.press("Tab");
          }
          throw new Error(
            `Control is unreachable by Tab: ${await target.ariaSnapshot()}`,
          );
        };
        const ruler = page.getByRole("button", {
          name: t("Вертикальная линейка"),
          exact: true,
        });
        await tabTo(ruler);
        await expect(ruler).toBeFocused();
        const audit = async () => {
          const result = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          expect(result.violations).toEqual([]);
        };
        await audit();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", {
          name: t("Направляющие страницы"),
          exact: true,
        });
        const input = dialog.getByLabel(t("Позиция направляющей"), {
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await expect(input).toBeFocused();
        await expect(
          dialog.getByRole("combobox", {
            name: t("Ось направляющей"),
            exact: true,
          }),
        ).toContainText(t("Вертикальная (X)"));
        await audit();
        await page.screenshot({
          path: test.info().outputPath(`guide-panel-${locale}-${theme}.png`),
        });
        // Preserve incomplete numeric input on Escape; explicit discard is the exit.
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText("1e");
        await expect(input).toHaveValue("1e");
        await expect(
          dialog.getByRole("button", {
            name: t("Закрыть направляющие"),
            exact: true,
          }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        await expect(input).toBeFocused();
        await expect(input).toHaveValue("1e");
        for (let count = 0; count < 14; count++) {
          await page.keyboard.press("Tab");
          expect(
            await dialog.evaluate(
              (element) =>
                !document.hasFocus() ||
                element.contains(document.activeElement),
            ),
          ).toBe(true);
        }
        await audit();
        await tabTo(
          dialog.getByRole("button", { name: t("Отменить ввод"), exact: true }),
        );
        await page.keyboard.press("Enter");
        await expect(input).toHaveValue("0");
        await tabTo(
          dialog.getByRole("button", {
            name: t("Закрыть направляющие"),
            exact: true,
          }),
        );
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        await expect(ruler).toBeFocused();
        expect(await readDocument()).toEqual(canonical);
      } finally {
        await page.evaluate(async (screenId) => {
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
          if (
            !project.pages.some(
              (candidate: { screenId: string }) =>
                candidate.screenId === screenId,
            )
          )
            return;
          const response = await fetch("/api/operations", {
            method: "POST",
            headers,
            body: JSON.stringify({
              requestId: crypto.randomUUID(),
              baseRevision: project.revision,
              operations: [{ type: "removePage", pageId: screenId }],
            }),
          });
          if (!response.ok) throw new Error(await response.text());
        }, fixture.screenId);
      }
    });
  }
}
