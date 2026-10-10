import { expect, test } from "@playwright/test";
test("normalized PNG imports locally and stays available after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Изображения", exact: true }).click();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 16;
    const context = canvas.getContext("2d")!; context.fillStyle = "#4673e8"; context.fillRect(0, 0, 32, 16);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Импорт изображений", { exact: true }).setInputFiles({ name: "Offline image.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") });
  const card = page.locator(".asset-card").filter({ hasText: "Offline image.png" });
  await expect(card.getByRole("img", { name: "Offline image.png" })).toBeVisible();
  await expect(card).toContainText("32 × 16");
  const source = await card.getByRole("img").getAttribute("src");
  expect(source).toMatch(/^assets\/[a-f0-9]{64}\.png$/);
  await card.getByRole("button", { name: "На экран +", exact: true }).click();
  await page.getByRole("button", { name: "Изображения", exact: true }).click();
  await expect(card.getByRole("button", { name: "Убрать из библиотеки", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "Изображения", exact: true }).click();
  await expect(card.getByRole("img")).toHaveAttribute("src", source!);
  await expect.poll(() => card.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(32);
  // All external requests are refused; project pixels are still served from its assets directory.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await expect(card.getByRole("img")).toBeVisible();
});
