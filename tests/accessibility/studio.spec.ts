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
  const savedFrame = page.waitForResponse((response) =>
    response.url().endsWith("/api/operations") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Фрейм +", exact: true }).click();
  const frameResult = await savedFrame;
  expect(frameResult.ok()).toBe(true);
  const frameRevision = (await frameResult.json()).revision;
  await expect(rows).toHaveCount(before + 1);
  await expect(page.getByTestId("save-status")).toContainText("ревизия " + frameRevision);
  const count = await rows.count();
  const mod = await page.evaluate(() =>
    /Mac/.test(navigator.platform) ? "Meta" : "Control",
  );
  const savedDuplicate = page.waitForResponse((response) =>
    response.url().endsWith("/api/operations") && response.request().method() === "POST",
  );
  await page.keyboard.press(`${mod}+d`);
  const duplicateResult = await savedDuplicate;
  expect(duplicateResult.ok()).toBe(true);
  const duplicateRevision = (await duplicateResult.json()).revision;
  await expect(rows).toHaveCount(count + 1);
  await expect(page.getByTestId("save-status")).toContainText("ревизия " + duplicateRevision);
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


test("locale switch preserves the selected screen/layer and unsaved inspector draft", async ({ page }) => {
  const sessions: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/session") sessions.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page.getByRole("button", { name: "Экран +", exact: true }).click();
  await expect(page.locator(".layer-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Текст +", exact: true }).click();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await expect(page.getByTestId("save-status")).toContainText("Сохранено");
  const screenName = await page.getByRole("combobox", { name: "Экран", exact: true }).textContent();
  const selected = page.locator(".layer-row").getByRole("button");
  const selectedLabel = await selected.getAttribute("aria-label");
  const draft = JSON.stringify({ text: "Несохранённый ввод · user content" });
  await page.getByLabel("Свойства JSON", { exact: true }).fill(draft);
  await page.getByLabel("Язык студии", { exact: true }).selectOption("en");
  // Polling must use the new language without reopening the connection.
  await expect(page.getByTestId("save-status")).toContainText("Saved locally · revision");
  await expect(page.getByLabel("Properties JSON", { exact: true })).toHaveValue(draft);
  await expect(page.getByRole("combobox", { name: translate("en", "Экран"), exact: true })).toHaveText(screenName!);
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(await selected.getAttribute("aria-label")).toBe(selectedLabel!.replace("Выделить ", translate("en", "Выделить ")));
  expect(sessions).toHaveLength(1);
});
