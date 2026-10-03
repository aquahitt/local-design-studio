import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { demo } from "../src/demo/document";
test("external update changes nested metric", async ({ page }) => {
  await page.goto("/");
  const canvas = page.frameLocator("iframe").first();
  await expect(canvas.getByText("240 000 ₽", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Внешняя правка" }).click();
  await expect(canvas.getByText("180 000 ₽", { exact: true })).toBeVisible();
  await expect(
    canvas.getByText("Расходы на ремонт", { exact: true }),
  ).toBeVisible();
});

test("nested text edits preserve selection and typing focus", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.frameLocator("iframe").first();
  await canvas.getByText("Расходы на ремонт", { exact: true }).click();
  await expect(page.getByTestId("selection")).toHaveText("Выделено: note");
  const field = page.getByRole("textbox");
  await field.fill("Материалы и работа");
  await field.press("End");
  await field.pressSequentially(" — план");
  await expect(field).toBeFocused();
  await expect(
    canvas.getByText("Материалы и работа — план", { exact: true }),
  ).toBeVisible();
  const doc = JSON.parse(
    (await page.getByTestId("document").textContent()) ?? "{}",
  );
  expect(doc.nodes[0].slots.content[0].slots.content[1]).toMatchObject({
    id: "note",
    props: { text: "Материалы и работа — план" },
  });
});

test("export reopens in a clean browser context and invalid import leaves screen intact", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Внешняя правка" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Экспорт JSON" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("DOWNLOAD_MISSING");
  const saved = JSON.parse(await readFile(path, "utf8"));
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto("/");
  await other.getByLabel("Открыть JSON").setInputFiles(path);
  await expect(
    other
      .frameLocator("iframe")
      .first()
      .getByText("180 000 ₽", { exact: true }),
  ).toBeVisible();
  expect(
    JSON.parse((await other.getByTestId("document").textContent()) ?? "{}"),
  ).toEqual(saved);
  await other.getByLabel("Открыть JSON").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":2}'),
  });
  await expect(other.getByRole("alert")).toBeVisible();
  await expect(
    other
      .frameLocator("iframe")
      .first()
      .getByText("180 000 ₽", { exact: true }),
  ).toBeVisible();
  await fresh.close();
});

test("captures phone and desktop previews", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  const canvas = page.frameLocator("iframe").first();
  await expect(canvas.getByText("240 000 ₽", { exact: true })).toBeVisible();
  const phone = page.getByRole("button", {
    name: "Switch to Телефон viewport",
    exact: true,
  });
  if (await phone.isEnabled()) await phone.click();
  await expect(
    page.getByRole("button", {
      name: "Switch to Телефон viewport",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.locator("iframe").first()).toHaveCSS("width", "390px");
  await page.screenshot({
    path: "test-results/studio-phone.png",
    fullPage: true,
    animations: "disabled",
  });
  // Actual Puck viewport controls are selected by their accessible tooltip.
  await page
    .getByRole("button", { name: "Switch to Компьютер viewport", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Switch to Компьютер viewport",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.locator("iframe").first()).toHaveCSS("width", "1280px");
  await page.screenshot({
    path: "test-results/studio-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("viewport choice is included in exported canonical document", async ({
  page,
}) => {
  await page.goto("/");
  const desktop = page.getByRole("button", {
    name: "Switch to Компьютер viewport",
    exact: true,
  });
  if (await desktop.isEnabled()) await desktop.click();
  await expect
    .poll(
      async () =>
        JSON.parse((await page.getByTestId("document").textContent()) ?? "{}")
          .viewport.width,
    )
    .toBe(1280);
});

test("invalid editor input restores the last valid screen", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.frameLocator("iframe").first();
  await canvas.getByText("Расходы на ремонт", { exact: true }).click();
  await page.getByRole("textbox").fill("x".repeat(1001));
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    canvas.getByText("Расходы на ремонт", { exact: true }),
  ).toBeVisible();
  const doc = JSON.parse(
    (await page.getByTestId("document").textContent()) ?? "{}",
  );
  expect(doc.nodes[0].slots.content[0].slots.content[1].props.text).toBe(
    "Расходы на ремонт",
  );
});

test("external update rejects a non-metric node with the same ID", async ({
  page,
}) => {
  await page.goto("/");
  const imported = structuredClone(demo);
  imported.nodes[0].slots.content[0].slots.content[0] = {
    id: "total",
    type: "Text",
    props: { text: "Обычный текст" },
    slots: {},
  };
  await page.getByLabel("Открыть JSON").setInputFiles({
    name: "text.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(
    page
      .frameLocator("iframe")
      .first()
      .getByText("Обычный текст", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Внешняя правка" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(
    JSON.parse((await page.getByTestId("document").textContent()) ?? "{}"),
  ).toEqual(imported);
});
