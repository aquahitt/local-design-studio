import { test, expect } from "@playwright/test";
test.skip(
  !process.env.STUDIO_LIBRARY_ROOT?.includes("stroi-homes"),
  "Opt-in actual product checkout",
);
test("actual local library, theme and image fixture remain portable after save/reload", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.getByTestId("catalog-count")).toContainText("72");
  await expect(
    page.getByRole("button", { name: "Экраны", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Тема проекта").selectOption("web-dark");
  const search = page.getByLabel("Поиск компонентов");
  await search.fill("ImageCarousel");
  const card = page.locator(".catalog-card").filter({
    has: page.getByRole("heading", { name: "ImageCarousel", exact: true }),
  });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "На экран +" }).click();
  await expect(
    page.getByRole("heading", { name: "Компоненты проекта", exact: true }),
  ).toBeVisible();
  const text = page.getByLabel("Свойства JSON");
  await expect.poll(() => text.inputValue()).toContain("assets/");
  const frame = page.frameLocator("iframe").first();
  await expect(frame.locator("img").first()).toBeVisible();
  await expect
    .poll(() =>
      frame
        .locator("img")
        .first()
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await expect(frame.locator("img").first()).toBeVisible();
  await expect(page.getByLabel("Тема проекта")).toHaveValue("web-dark");
  await page.getByRole("button", { name: "Компоненты", exact: true }).click();
  await search.fill("Button");
  await search.fill("BuildingPriceTables");
  const tableCard = page.locator(".catalog-card").filter({
    has: page.getByRole("heading", {
      name: "BuildingPriceTables",
      exact: true,
    }),
  });
  await tableCard.getByRole("button", { name: "На экран +" }).click();
  const tableProps = page.getByLabel("Свойства JSON");
  const original = await tableProps.inputValue();
  await tableProps.fill(
    JSON.stringify({ ...JSON.parse(original), tables: {} }),
  );
  await page.getByRole("button", { name: "Применить свойства" }).click();
  await expect(frame.getByRole("alert")).toBeVisible();
  await tableProps.fill(original);
  await page.getByRole("button", { name: "Применить свойства" }).click();
  await expect(frame.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Компоненты", exact: true }).click();
  await search.fill("Button");
  await expect(
    page
      .frameLocator("iframe")
      .first()
      .getByRole("button", { name: "Продолжить", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/local-design-system.png",
    fullPage: true,
    animations: "disabled",
  });
});
