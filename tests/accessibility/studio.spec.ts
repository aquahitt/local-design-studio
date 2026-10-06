import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
  await page.getByRole("button", { name: "Фрейм +", exact: true }).click();
  const rows = page.locator(".layer-row");
  const count = await rows.count();
  const mod = await page.evaluate(() =>
    /Mac/.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${mod}+d`);
  await expect(rows).toHaveCount(count + 1);
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
