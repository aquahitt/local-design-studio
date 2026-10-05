import { test, expect } from "@playwright/test";
test("static repo-subpath demo renders previews, edits, persists and resets without API calls", async ({
  page,
}) => {
  const api: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/api/")) api.push(r.url());
  });
  await page.goto("./");
  await expect(page.getByLabel("Режим демо")).toContainText(
    "Интерактивное демо",
  );
  await expect(
    page
      .frameLocator("iframe")
      .first()
      .getByRole("button", { name: "Экспорт проекта ↗", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Тема проекта").selectOption("dark");
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page
    .getByRole("button", { name: "Выделить demo-title", exact: true })
    .click();
  const props = page.getByLabel("Свойства JSON");
  await props.fill('{"text":"My browser edit","size":24}');
  await page.getByRole("button", { name: "Применить свойства" }).click();
  await expect(page.getByTestId("save-status")).toContainText(
    "Сохранено в браузере",
  );
  await page.reload();
  await expect(page.getByLabel("Тема проекта")).toHaveValue("dark");
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page
    .getByRole("button", { name: "Выделить demo-title", exact: true })
    .click();
  await expect.poll(() => props.inputValue()).toContain("My browser edit");
  await expect(
    page
      .frameLocator("iframe")
      .first()
      .getByText("My browser edit", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Предложения агента", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Создать пример предложения" })
    .click();
  await expect(
    page.getByText("Демо-агент (симуляция)", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить и применить" }).click();
  await expect(page.getByText("applied", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await expect.poll(() => props.inputValue()).toContain("My browser edit");
  const other = await page.context().newPage();
  await other.goto("./");
  await expect(other.getByLabel("Тема проекта")).toHaveValue("dark");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Сбросить демо" }).click();
  await expect(page.getByLabel("Тема проекта")).toHaveValue("light");
  await expect(other.getByLabel("Тема проекта")).toHaveValue("light");
  await other.close();
  expect(api).toEqual([]);
});

test("studio theme is independent and persistent; sidebar core stays visible; demo uses real studio UI", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("./");
  await expect(page.locator(".catalog-card")).toHaveCount(5);
  await expect(
    page.getByRole("heading", { name: "Дизайн-система студии", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".catalog-heading")).toContainText(
    "Дизайн-система студии",
  );
  const theme = page.getByLabel("Тема студии", { exact: true });
  await theme.selectOption("dark");
  await expect(page.locator("main.ds-studio")).toHaveAttribute(
    "data-studio-theme",
    "dark",
  );
  await expect(page.getByLabel("Тема проекта")).toHaveValue("light");
  await expect(page.locator("main.ds-studio")).toHaveCSS(
    "background-color",
    "rgb(21, 25, 34)",
  );
  await page.reload();
  await expect(theme).toHaveValue("dark");
  await expect(page.getByLabel("Тема проекта")).toHaveValue("light");
  await page.getByRole("button", { name: "Основы", exact: true }).click();
  const footer = page.locator(".ds-nav-bottom");
  const before = await footer.boundingBox();
  expect(before!.y + before!.height).toBeLessThanOrEqual(720);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const after = await footer.boundingBox();
  expect(Math.abs(before!.y - after!.y)).toBeLessThan(2);
  await expect(
    footer.getByText("Локальное ядро", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Тема проекта").selectOption("dark");
  await theme.selectOption("light");
  await expect(page.getByLabel("Тема проекта")).toHaveValue("dark");
  await page.getByRole("button", { name: "Компоненты", exact: true }).click();
  const previewButton = page
    .frameLocator("iframe")
    .first()
    .getByRole("button", { name: "Экспорт проекта ↗", exact: true });
  const shellButton = page.getByRole("button", {
    name: "Экспорт проекта ↗",
    exact: true,
  });
  await expect(previewButton).toBeVisible();
  const radius = await shellButton.evaluate(
    (el) => getComputedStyle(el).borderRadius,
  );
  await expect(previewButton).toHaveCSS("border-radius", radius);
  await expect(previewButton).toHaveCSS("background-color", "rgb(32, 38, 50)");
  await expect(shellButton).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(theme).toBeVisible();
  await expect(footer.getByRole("link")).toBeVisible();
});
