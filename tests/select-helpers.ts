import { expect, type Page } from "@playwright/test";
export async function selectStudioOption(
  page: Page,
  label: string,
  name: string,
) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name, exact: true }).first().click();
}
export async function expectStudioOptions(
  page: Page,
  label: string,
  count: number,
) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await expect(
    page.getByRole("listbox", { name: label, exact: true }).getByRole("option"),
  ).toHaveCount(count);
  await page.getByLabel(`Поиск: ${label}`, { exact: true }).press("Escape");
}
