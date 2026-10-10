import { test, expect } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { readFile } from "node:fs/promises";
test("inspect reads actual pixels and React export downloads a usable file archive", async ({ page }) => {
  await page.goto("/");
  const target = await page.evaluate(async () => {
    const session = await fetch("/api/session").then((response) => response.json());
    const project = await fetch("/api/project", { headers: { Authorization: `Bearer ${session.token}` } }).then((response) => response.json());
    return { nodeId: project.pages[0].nodes[0].id };
  });
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page.getByRole("button", { name: "Выделить " + target.nodeId, exact: true }).click();
  await page.getByText("Inspect и экспорт React", { exact: true }).click();
  await page.getByRole("button", { name: "Проверить выбранный слой", exact: true }).click();
  await expect(page.getByLabel("Результат inspect", { exact: true })).toContainText('"computedStyles"');
  const inspection = JSON.parse(await page.getByLabel("Результат inspect", { exact: true }).innerText());
  expect(inspection.bounds.width).toBeGreaterThan(0);
  expect(inspection.computedStyles.layout.position).toBe("relative");
  await page.getByRole("button", { name: "Подготовить экспорт экрана", exact: true }).click();
  await expect(page.getByRole("button", { name: "Скачать React ZIP", exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать React ZIP", exact: true }).click();
  const download = await downloaded;
  const files = unzipSync(await readFile((await download.path())!));
  expect(Object.keys(files)).toEqual(expect.arrayContaining(["Screen.tsx", "Runtime.tsx", "manifest.json", "README.md"]));
  expect(strFromU8(files["Screen.tsx"])).toContain("RegisteredLibrary");
  expect(strFromU8(files["README.md"])).toContain("library");
});
