import { test, expect } from "@playwright/test";
test("device and custom geometry persists, sets actual preview viewport, respects safe zones and supports atomic undo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const session = await page.evaluate(() =>
    fetch("/api/session").then((r) => r.json()),
  );
  const read = () =>
    page.evaluate(
      (token) =>
        fetch("/api/project", {
          headers: { Authorization: "Bearer " + token },
        }).then((r) => r.json()),
      session.token,
    );
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  const screen = page.locator(".page-stage iframe");
  await page.getByLabel("Тип устройства").selectOption("phone-pill");
  await expect(screen).toHaveCSS("height", "756px");
  await expect(screen).toHaveCSS("width", "390px");
  await expect
    .poll(async () => (await read()).pages[0].viewport.height)
    .toBe(844);
  const preview = page.frames().find((f) => f.url().includes("/preview"))!;
  expect(
    await preview.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ).toEqual({ width: 390, height: 756 });
  const revision = (await read()).revision;
  await page.getByLabel("Шторка уведомлений", { exact: true }).check();
  await expect(
    page.getByRole("dialog", { name: "Шторка уведомлений" }),
  ).toBeVisible();
  expect((await read()).revision).toBe(revision);
  await page
    .getByRole("button", { name: "Закрыть шторку", exact: true })
    .click();
  await expect(
    page.getByLabel("Шторка уведомлений", { exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Повернуть устройство" }).click();
  await expect(screen).toHaveCSS("width", "736px");
  await expect(screen).toHaveCSS("height", "369px");
  const rotated = (await read()).pages[0].viewport;
  await page.getByLabel("Ширина экрана").fill("720");
  await page.getByLabel("Высота экрана").fill("900");
  await page.getByText("Системные зоны и вырез", { exact: true }).click();
  await page.getByLabel("Системная зона сверху").fill("32");
  await page.getByLabel("Системная зона снизу").fill("20");
  await page.getByLabel("Системная зона слева").fill("0");
  await page.getByLabel("Системная зона справа").fill("0");
  await page.getByLabel("Вырез устройства").selectOption("none");
  await page
    .getByRole("button", { name: "Применить размеры", exact: true })
    .click();
  await expect(screen).toHaveCSS("width", "720px");
  await expect(screen).toHaveCSS("height", "848px");
  const custom = (await read()).pages[0].viewport;
  expect(custom).toMatchObject({
    width: 720,
    height: 900,
    device: {
      preset: "custom",
      safeArea: { top: 32, bottom: 20, left: 0, right: 0 },
    },
  });
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await expect
    .poll(async () => (await read()).pages[0].viewport)
    .toEqual(rotated);
  await page
    .getByRole("button", { name: "Повторить правку", exact: true })
    .click();
  await expect
    .poll(async () => (await read()).pages[0].viewport)
    .toEqual(custom);
  await page.reload();
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await expect(page.getByLabel("Ширина экрана")).toHaveValue("720");
  await expect(page.getByLabel("Высота экрана")).toHaveValue("900");
  await expect(screen).toHaveCSS("height", "848px");
  await expect(
    page.getByLabel("Шторка уведомлений", { exact: true }),
  ).not.toBeChecked();
});

test("external page removal preserves a viewport draft, cannot apply it to another page, and does not crash context", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const session = await page.evaluate(() =>
    fetch("/api/session").then((r) => r.json()),
  );
  const read = () =>
    page.evaluate(
      (token) =>
        fetch("/api/project", {
          headers: { Authorization: "Bearer " + token },
        }).then((r) => r.json()),
      session.token,
    );
  const apply = async (operations: unknown[]) =>
    page.evaluate(
      async ({ token, uiToken, operations }) => {
        const headers = {
          Authorization: "Bearer " + token,
          "x-studio-ui-token": uiToken,
          "Content-Type": "application/json",
        };
        const project = await fetch("/api/project", { headers }).then((r) =>
          r.json(),
        );
        const response = await fetch("/api/operations", {
          method: "POST",
          headers,
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            baseRevision: project.revision,
            operations,
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      },
      { token: session.token, uiToken: session.uiToken, operations },
    );
  const before = await read(),
    original = before.pages[0];
  await apply([
    {
      type: "addPage",
      page: {
        screenId: "viewport-remaining",
        name: "Remaining",
        viewport: { width: 320, height: 480 },
        nodes: [],
      },
    },
  ]);
  try {
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await page.getByLabel("Ширина экрана").fill("800");
    await apply([{ type: "removePage", pageId: original.screenId }]);
    await expect(
      page.getByText("Выбранный экран удалён.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByLabel("Ширина экрана")).toHaveValue("800");
    await page
      .getByRole("button", { name: "Применить размеры", exact: true })
      .click();
    expect((await read()).pages[0].viewport).toEqual({
      width: 320,
      height: 480,
    });
    await page
      .getByRole("button", { name: "Сбросить размеры", exact: true })
      .click();
    await expect(page.getByLabel("Ширина экрана")).toHaveValue("320");
    expect(errors).toEqual([]);
  } finally {
    await apply([
      { type: "addPage", page: original },
      { type: "removePage", pageId: "viewport-remaining" },
    ]);
  }
});
