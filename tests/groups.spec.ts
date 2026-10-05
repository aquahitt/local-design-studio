import { test, expect } from "@playwright/test";
test("groups persist, filter components/screens/tokens, and creating a screen keeps it in its group", async ({
  page,
}) => {
  await page.goto("/");
  const session = await page.evaluate(() =>
    fetch("/api/session").then((r) => r.json()),
  );
  const read = () =>
    page.evaluate(
      (token) =>
        fetch("/api/project", {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json()),
      session.token,
    );
  const before = await read();
  await page.getByRole("button", { name: "Управлять группами" }).click();
  await page.getByLabel("Название новой группы").fill("PWA Buyer");
  await page
    .getByRole("button", { name: "Создать группу", exact: true })
    .click();
  await page
    .getByLabel(`В группу: ${before.pages[0].name}`, { exact: true })
    .check();
  await page.getByRole("button", { name: /^Компоненты ·/ }).click();
  await page.getByLabel("Поиск элементов группы").fill("Button");
  await page
    .getByRole("button", { name: "Выбрать найденные", exact: true })
    .click();
  await expect(
    page.getByLabel("В группу: Button", { exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Сохранить группы", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Управление группами" }),
  ).toHaveCount(0);
  const group = (await read()).groups.find((g: any) => g.name === "PWA Buyer");
  expect(group.pages).toEqual([before.pages[0].screenId]);
  expect(group.components).toEqual(["Button"]);
  await page.getByLabel("Группа проекта").selectOption(group.id);
  await expect(page.locator(".catalog-card")).toHaveCount(1);
  await expect(page.locator(".catalog-card")).toHaveAttribute(
    "data-component-type",
    "Button",
  );
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await expect(
    page.getByLabel("Экран", { exact: true }).locator("option"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Экран +", exact: true }).click();
  await expect(
    page.getByLabel("Экран", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await expect
    .poll(
      async () =>
        (await read()).groups.find((g: any) => g.id === group.id).pages.length,
    )
    .toBe(2);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await expect(
    page.getByLabel("Экран", { exact: true }).locator("option"),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Повторить правку", exact: true })
    .click();
  await expect(
    page.getByLabel("Экран", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await page.reload();
  await page.getByLabel("Группа проекта").selectOption(group.id);
  await expect(page.locator(".catalog-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Основы", exact: true }).click();
  await expect(page.locator(".token-grid article")).toHaveCount(0);
  await page.getByRole("button", { name: "Управлять группами" }).click();
  await page.getByLabel("Название новой группы").fill("Site");
  await page
    .getByRole("button", { name: "Создать группу", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить группы", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Управление группами" }),
  ).toHaveCount(0);
  const site = (await read()).groups.find((g: any) => g.name === "Site");
  await page.getByLabel("Группа проекта").selectOption(site.id);
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await expect(page.getByText(/В этой группе пока нет экранов/)).toBeVisible();
  await page.getByRole("button", { name: "Экран +", exact: true }).click();
  await expect(
    page.getByLabel("Экран", { exact: true }).locator("option"),
  ).toHaveCount(1);
  // Restore group metadata so shared browser fixtures remain independent.
  await page.evaluate(
    async ({ session, before }) => {
      const headers = {
        Authorization: `Bearer ${session.token}`,
        "x-studio-ui-token": session.uiToken,
        "Content-Type": "application/json",
      };
      const latest = await fetch("/api/project", { headers }).then((r) =>
        r.json(),
      );
      await fetch("/api/operations", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          baseRevision: latest.revision,
          operations: [
            { type: "setGroups", groups: before.groups ?? [] },
            ...latest.pages
              .filter(
                (p: any) =>
                  !before.pages.some((old: any) => old.screenId === p.screenId),
              )
              .map((p: any) => ({ type: "removePage", pageId: p.screenId })),
          ],
        }),
      });
    },
    { session, before },
  );
});

test("external membership changes preserve an unsaved inspector draft", async ({
  page,
}) => {
  await page.goto("/");
  const applyGroups = async (groups: unknown) =>
    page.evaluate(async (groups) => {
      const session = await fetch("/api/session").then((r) => r.json());
      const headers = {
        Authorization: `Bearer ${session.token}`,
        "x-studio-ui-token": session.uiToken,
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
          operations: [{ type: "setGroups", groups }],
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      return project;
    }, groups);
  const before = await page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    return fetch("/api/project", {
      headers: { Authorization: `Bearer ${session.token}` },
    }).then((r) => r.json());
  });
  const target = before.pages.find((p: any) => p.nodes.length);
  const group = {
    id: "draft-test",
    name: "Draft test",
    pages: [target.screenId],
    components: [],
    tokens: [],
  };
  try {
    await applyGroups([...(before.groups ?? []), group]);
    await expect(
      page.getByLabel("Группа проекта").locator('option[value="draft-test"]'),
    ).toHaveCount(1);
    await page.getByLabel("Группа проекта").selectOption("draft-test");
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await page
      .getByRole("button", {
        name: `Выделить ${target.nodes[0].id}`,
        exact: true,
      })
      .click();
    const draft = JSON.stringify({
      ...target.nodes[0].props,
      text: "Keep this draft",
    });
    await page.getByLabel("Свойства JSON").fill(draft);
    await applyGroups([...(before.groups ?? []), { ...group, pages: [] }]);
    await expect(page.getByText(/Состав группы изменился/)).toBeVisible();
    await expect(page.getByLabel("Свойства JSON")).toHaveValue(draft);
    await page
      .getByRole("button", { name: "Сбросить ввод", exact: true })
      .click();
    await expect(
      page.getByText(/В этой группе пока нет экранов/),
    ).toBeVisible();
  } finally {
    await applyGroups(before.groups ?? []);
  }
});
