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

test("opening a fixed overlay grows the card and closing restores its height", async ({
  page,
}) => {
  test.skip(
    !process.env.STUDIO_LIBRARY_ROOT?.includes("stroi-homes"),
    "Actual overlay fixture",
  );
  await page.goto("/");
  await page.getByLabel("Поиск компонентов").fill("Modal");
  const card = page.locator('.catalog-card[data-component-type="Modal"]');
  const frame = card.frameLocator("iframe");
  const size = () =>
    card.locator("iframe").evaluate((el) => el.getBoundingClientRect().height);
  await frame
    .getByRole("button", { name: "Открыть Modal", exact: true })
    .waitFor();
  await expect.poll(size).toBe(120);
  await frame
    .getByRole("button", { name: "Открыть Modal", exact: true })
    .click();
  await expect(frame.getByRole("dialog")).toBeVisible();
  await expect.poll(size).toBeGreaterThanOrEqual(640);
  await frame.getByRole("dialog").press("Escape");
  await expect(frame.getByRole("dialog")).toHaveCount(0);
  await expect.poll(size).toBe(120);
});

for (const [type, trigger] of [
  ["Sheet", "Открыть Sheet"],
  ["OverflowActions", "Ещё"],
]) {
  test(`${type} opens entirely inside the expanded preview`, async ({
    page,
  }) => {
    test.skip(
      !process.env.STUDIO_LIBRARY_ROOT?.includes("stroi-homes"),
      "Actual overlay fixture",
    );
    await page.goto("/");
    await page.getByLabel("Поиск компонентов").fill(type);
    const card = page.locator(`.catalog-card[data-component-type="${type}"]`);
    const frame = card.frameLocator("iframe");
    await frame.getByRole("button", { name: trigger, exact: true }).click();
    await expect
      .poll(() =>
        card
          .locator("iframe")
          .evaluate((el) => el.getBoundingClientRect().height),
      )
      .toBeGreaterThanOrEqual(640);
    const dialog = frame.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= -1 && r.bottom <= innerHeight + 1;
        }),
      )
      .toBe(true);
    if (type === "Sheet")
      await page.screenshot({
        path: "test-results/expanded-component-preview.png",
      });
    await dialog.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() =>
        card
          .locator("iframe")
          .evaluate((el) => el.getBoundingClientRect().height),
      )
      .toBe(120);
  });
}

test("wide confirmation actions fit the card and remain interactive", async ({
  page,
}) => {
  test.skip(
    !process.env.STUDIO_LIBRARY_ROOT?.includes("stroi-homes"),
    "Actual confirmation fixture",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Поиск компонентов").fill("ConfirmDialog");
  const card = page.locator(
    '.catalog-card[data-component-type="ConfirmDialog"]',
  );
  const frame = card.frameLocator("iframe");
  await expect(frame.getByRole("dialog")).toBeVisible();
  await expect
    .poll(() =>
      frame
        .getByRole("button", { name: "Подтвердить", exact: true })
        .evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth;
        }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      card.locator("iframe").evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const parent = el.parentElement!.getBoundingClientRect();
        return rect.right <= parent.right + 1;
      }),
    )
    .toBe(true);
  await card.locator("iframe").scrollIntoViewIfNeeded();
  await frame.getByRole("button", { name: "Подтвердить", exact: true }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
