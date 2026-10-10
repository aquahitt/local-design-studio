import { test, expect } from "@playwright/test";
test.describe.configure({ mode: "serial" });
test.skip(!!process.env.STUDIO_LIBRARY_ROOT, "Generic fixture suite");
test("catalog exposes real states, themes and a portable document", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Библиотека компонентов" }),
  ).toBeVisible();
  await expect(page.getByTestId("catalog-count")).toContainText("компонент");
  await page.getByRole("button", { name: "Основы", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Токены и темы" }),
  ).toBeVisible();
  await page.getByLabel("Тема проекта").selectOption("dark");
  await expect(page.getByTestId("save-status")).toContainText("Сохранено");
  await page.reload();
  await expect(page.getByLabel("Тема проекта")).toHaveValue("dark");
});
test("external changes preserve selection, viewport and pending input, shared undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page
    .getByRole("button", { name: "Выделить intro", exact: true })
    .click();
  const props = page.getByLabel("Свойства JSON");
  await props.fill('{"text":"Мой незавершённый текст","size":20}');
  await page.getByRole("button", { name: "Компоненты", exact: true }).click();
  await expect(props).toBeVisible();
  const contextCredentials = await page.evaluate(async () =>
    fetch("/api/session").then((r) => r.json()),
  );
  await expect
    .poll(() =>
      page.evaluate(
        async ({ token }) =>
          fetch("/api/context", {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then((r) => r.json())
            .then((r) => Object.keys(r.context?.bounds ?? {}).length),
        contextCredentials,
      ),
    )
    .toBeGreaterThan(0);
  const credentials = await page.evaluate(async () =>
    fetch("/api/session").then((r) => r.json()),
  );
  const project = await page.evaluate(
    async ({ token }) =>
      fetch("/api/project", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    credentials,
  );
  await page.evaluate(
    async ({ token, uiToken, revision }) =>
      fetch("/api/operations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-studio-ui-token": uiToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          baseRevision: revision,
          operations: [
            {
              type: "updateProps",
              nodeId: "intro",
              props: { text: "Внешняя правка" },
            },
          ],
        }),
      }).then((r) => {
        if (!r.ok) throw new Error("External failed");
      }),
    { ...credentials, revision: project.revision },
  );
  await expect(props).toHaveValue(
    '{"text":"Мой незавершённый текст","size":20}',
  );
  await expect(page.getByTestId("selection")).toContainText("intro");
  await expect(page.getByText("Документ изменился")).toBeVisible();
  await page
    .getByRole("button", { name: "Сохранить мой ввод поверх новой ревизии" })
    .click();
  await page.getByRole("button", { name: "Применить свойства" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Сохранено");
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await expect.poll(() => props.inputValue()).toContain("Внешняя правка");
});
test("agent proposal requires visible approval and is undone as one batch", async ({
  page,
}) => {
  await page.goto("/");
  const credentials = await page.evaluate(async () =>
    fetch("/api/session").then((r) => r.json()),
  );
  const current = await page.evaluate(
    async ({ token }) =>
      fetch("/api/project", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    credentials,
  );
  const label = "Агент обновляет заголовок";
  await page.evaluate(
    async ({ token, revision, label }) =>
      fetch("/api/proposals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: label,
          batch: {
            requestId: crypto.randomUUID(),
            baseRevision: revision,
            author: "agent",
            operations: [
              {
                type: "updateProps",
                nodeId: "intro",
                props: { text: "После предложения агента" },
              },
            ],
          },
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
      }),
    { ...credentials, revision: current.revision, label },
  );
  await page
    .getByRole("button", { name: "Предложения агента", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: label })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить и применить" }).click();
  await expect(page.locator(".proposal-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "История предложений", exact: true })
    .click();
  await expect(
    page
      .locator(".proposal-card")
      .filter({ has: page.getByRole("heading", { name: label, exact: true }) })
      .getByText("applied", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page
    .getByRole("button", { name: "Выделить intro", exact: true })
    .click();
  await expect
    .poll(() => page.getByLabel("Свойства JSON").inputValue())
    .toContain("После предложения агента");
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await expect
    .poll(() => page.getByLabel("Свойства JSON").inputValue())
    .not.toContain("После предложения агента");
  await page.getByRole("button", { name: "Компоненты", exact: true }).click();
  await page.screenshot({
    path: "test-results/design-system-studio.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("theme resolves bound properties without replacing token references", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page.evaluate(async () => {
    const { token, uiToken } = await fetch("/api/session").then((r) =>
      r.json(),
    );
    const p = await fetch("/api/project", {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    const r = await fetch("/api/operations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-studio-ui-token": uiToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: p.revision,
        operations: [
          {
            type: "setTokens",
            tokens: {
              ...p.tokens,
              "text-size": { type: "number", value: 18, themes: { dark: 32 } },
            },
          },
          {
            type: "updateProps",
            nodeId: "intro",
            props: { size: { $token: "text-size" } },
          },
          { type: "setTheme", theme: "light" },
        ],
      }),
    });
    if (!r.ok) throw new Error(await r.text());
  });
  const text = page
    .frameLocator("iframe")
    .first()
    .locator('[data-node-id="intro"] p');
  await expect(text).toHaveCSS("font-size", "18px");
  await page.getByLabel("Тема проекта").selectOption("dark");
  await expect(text).toHaveCSS("font-size", "32px");
  await page
    .getByRole("button", { name: "Выделить intro", exact: true })
    .click();
  await expect
    .poll(() => page.getByLabel("Свойства JSON").inputValue())
    .toContain('"$token": "text-size"');
});
test("external deletion keeps an unsaved property draft until explicit reset", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page
    .getByRole("button", { name: "Выделить intro", exact: true })
    .click();
  const props = page.getByLabel("Свойства JSON");
  await props.fill('{"text":"Сохранить этот черновик"}');
  await page.evaluate(async () => {
    const { token, uiToken } = await fetch("/api/session").then((r) =>
      r.json(),
    );
    const p = await fetch("/api/project", {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    const r = await fetch("/api/operations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-studio-ui-token": uiToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: p.revision,
        operations: [{ type: "removeNode", nodeId: "intro" }],
      }),
    });
    if (!r.ok) throw new Error(await r.text());
  });
  await expect(page.getByRole("alert")).toContainText("удалён");
  await expect(props).toHaveValue('{"text":"Сохранить этот черновик"}');
  await page.getByRole("button", { name: "Сбросить ввод" }).click();
  await expect(props).not.toBeVisible();
});
