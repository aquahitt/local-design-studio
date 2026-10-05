import { test, expect } from "@playwright/test";

test("board loads more on scroll and resets search without duplicate components", async ({
  page,
}) => {
  test.skip(
    !process.env.STUDIO_LIBRARY_ROOT?.includes("stroi-homes"),
    "Real component library has multiple batches",
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  const cards = page.locator(".catalog-card");
  await expect(page.locator(".catalog-pagination")).toHaveCount(0);
  await expect(cards).toHaveCount(12);
  await page.getByTestId("catalog-sentinel").scrollIntoViewIfNeeded();
  await expect.poll(() => cards.count()).toBeGreaterThan(12);
  const types = await cards.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-component-type")),
  );
  expect(new Set(types).size).toBe(types.length);
  await page.getByLabel("Поиск компонентов").fill("ImageCarousel");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole("heading")).toHaveText("ImageCarousel");
  await page.getByLabel("Поиск компонентов").fill("no-such-component-987");
  await expect(page.getByText("Ничего не найдено")).toBeVisible();
  await page.getByRole("button", { name: "Сбросить фильтры" }).click();
  await expect(cards).toHaveCount(12);
});

test("board preserves fixture choice through filtering and fits a narrow screen", async ({
  page,
}) => {
  test.skip(
    !process.env.STUDIO_LIBRARY_ROOT?.includes("stroi-homes"),
    "Actual library fixture",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const search = page.getByLabel("Поиск компонентов");
  await search.fill("Button");
  await page
    .getByLabel("Состояние Button", { exact: true })
    .selectOption("Disabled");
  await search.fill("ImageCarousel");
  await search.fill("Button");
  await expect(
    page.getByLabel("Состояние Button", { exact: true }),
  ).toHaveValue("Disabled");
  await search.fill("");
  await page.getByRole("button", { name: "Overlays", exact: true }).click();
  await expect
    .poll(() => page.locator(".catalog-card").count())
    .toBeGreaterThan(0);
  expect(
    await page.locator(".catalog-card header small").allTextContents(),
  ).toEqual(expect.arrayContaining(["Overlays"]));
  await page
    .getByRole("button", { name: "Все компоненты", exact: true })
    .click();
  await page.frameLocator("iframe").first().getByText("BYN").waitFor();
  await page.screenshot({ path: "test-results/component-board.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Поиск компонентов")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
