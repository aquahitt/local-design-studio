import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function openExport(page: Page) {
  await page.goto("/");
  const target = await page.evaluate(async () => {
    const session = await fetch("/api/session").then((response) =>
      response.json(),
    );
    const project = await fetch("/api/project", {
      headers: { Authorization: `Bearer ${session.token}` },
    }).then((response) => response.json());
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    return {
      nodeId: project.pages[0].nodes[0].id,
      data: canvas.toDataURL("image/png").split(",")[1],
    };
  });
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page
    .getByRole("button", { name: "Выделить " + target.nodeId, exact: true })
    .click();
  await page.getByText("Экспорт PNG", { exact: true }).click();
  return target;
}
function response(request: Record<string, unknown>, data: string) {
  return {
    ...request,
    mimeType: "image/png",
    data,
    viewport: { width: 390, height: 850 },
    theme: "light",
    bounds: [],
    text: "",
    warnings: [],
    captureBounds: { x: 0, y: 0, width: 2, height: 2 },
    visualBounds: [{ id: request.nodeId, x: 0, y: 0, width: 2, height: 2 }],
    visualBoundsStatus: "conservative",
    visualBoundsPolicy: "test-envelope",
  };
}

test("PNG preview requires explicit download and is invalidated when export settings change", async ({
  page,
}) => {
  const target = await openExport(page);
  let requested: Record<string, unknown> | undefined;
  await page.route("**/api/render", async (route) => {
    requested = route.request().postDataJSON();
    await route.fulfill({ json: response(requested!, target.data) });
  });
  await expect(
    page.getByRole("button", { name: "Скачать PNG", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Подготовить PNG", exact: true })
    .click();
  await expect(
    page.getByAltText("Предпросмотр PNG выбранного слоя"),
  ).toBeVisible();
  expect(requested).toMatchObject({
    nodeId: target.nodeId,
    captureMode: "isolated",
    boundsMode: "visual",
  });
  await expect(page.locator(".png-export-metadata")).toContainText("2 × 2 px");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать PNG", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-r\d+\.png$/);
  expect(await readFile((await file.path())!)).toEqual(
    Buffer.from(target.data, "base64"),
  );
  await page.getByRole("combobox", { name: "Состав PNG", exact: true }).click();
  await page
    .getByRole("option", { name: "Фрагмент сцены", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Скачать PNG", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByAltText("Предпросмотр PNG выбранного слоя"),
  ).toHaveCount(0);
});

test("cancelled PNG requests cannot publish a late preview or download", async ({
  page,
}) => {
  const target = await openExport(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finished!: () => void;
  const requestFinished = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route("**/api/render", async (route) => {
    const input = route.request().postDataJSON();
    started();
    await gate;
    try {
      await route.fulfill({ json: response(input, target.data) });
    } catch {
      /* Aborted fetch can close its route first. */
    } finally {
      finished();
    }
  });
  await page
    .getByRole("button", { name: "Подготовить PNG", exact: true })
    .click();
  await requestStarted;
  await page
    .getByRole("button", { name: "Отменить ожидание PNG", exact: true })
    .click();
  release();
  await requestFinished;
  await expect(
    page.getByRole("status").filter({ hasText: "Ожидание отменено." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Скачать PNG", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByAltText("Предпросмотр PNG выбранного слоя"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Подготовить PNG", exact: true }),
  ).toBeEnabled();
});

for (const [code, copy] of [
  [
    "VISUAL_BOUNDS_UNSUPPORTED",
    "Не удалось определить границы оформления этого слоя. Выбери геометрические границы.",
  ],
  [
    "ISOLATED_CAPTURE_UNSUPPORTED",
    "Этот слой зависит от окружения. Выбери фрагмент сцены, чтобы сохранить его вид.",
  ],
] as const) {
  test(`PNG export explains ${code} without exposing renderer details`, async ({
    page,
  }) => {
    await openExport(page);
    await page.route("**/api/render", (route) =>
      route.fulfill({
        status: 422,
        json: {
          error: `${code}: /private/project/secret.svg filter: url(secret)`,
        },
      }),
    );
    await page
      .getByRole("button", { name: "Подготовить PNG", exact: true })
      .click();
    await expect(page.getByRole("alert")).toHaveText(copy);
    await expect(
      page.getByRole("button", { name: "Скачать PNG", exact: true }),
    ).toHaveCount(0);
  });
}

test("PNG panel prepares a real service snapshot before downloading", async ({
  page,
}) => {
  test.setTimeout(45000);
  const target = await openExport(page);
  const reply = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/render") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Подготовить PNG", exact: true })
    .click();
  const rendered = await reply;
  expect(rendered.status()).toBe(200);
  const result = await rendered.json();
  expect(result).toMatchObject({
    nodeId: target.nodeId,
    captureMode: "isolated",
    boundsMode: "visual",
  });
  expect(result.captureBounds.width).toBeGreaterThan(0);
  await expect(
    page.getByAltText("Предпросмотр PNG выбранного слоя"),
  ).toBeVisible();
  await page
    .locator(".png-export")
    .screenshot({ path: "/tmp/studio-png-export-final.png" });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать PNG", exact: true }).click();
  expect(await readFile((await (await downloading).path())!)).toEqual(
    Buffer.from(result.data, "base64"),
  );
});
