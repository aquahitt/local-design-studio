import { test, expect } from "@playwright/test";
test("custom selectors search, navigate by keyboard and show screens nested under groups", async ({
  page,
}) => {
  await page.goto("/");
  const snapshot = await page.evaluate(async () => {
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
        operations: [
          {
            type: "addPage",
            page: {
              screenId: "custom-site",
              name: "Site home",
              viewport: { width: 390 },
              nodes: [],
            },
          },
          {
            type: "setGroups",
            groups: [
              {
                id: "custom-buyer",
                name: "PWA Buyer",
                pages: [project.pages[0].screenId],
                components: [],
                tokens: [],
              },
              {
                id: "custom-site-group",
                name: "Site",
                pages: ["custom-site"],
                components: [],
                tokens: [],
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return { session, project };
  });
  try {
    const group = page.getByRole("combobox", {
      name: "Группа проекта",
      exact: true,
    });
    await group.click();
    const search = page.getByLabel("Поиск: Группа проекта", { exact: true });
    await search.fill("buyer");
    await expect(
      page
        .getByRole("listbox", { name: "Группа проекта", exact: true })
        .getByRole("option"),
    ).toHaveCount(1);
    await search.press("Enter");
    await expect(group).toContainText("PWA Buyer");
    await expect(group).toBeFocused();
    await group.press("ArrowDown");
    await page
      .getByLabel("Поиск: Группа проекта", { exact: true })
      .press("Home");
    await page
      .getByLabel("Поиск: Группа проекта", { exact: true })
      .press("Enter");
    await expect(group).toContainText("Все группы");
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    const screen = page.getByRole("combobox", { name: "Экран", exact: true });
    await screen.click();
    const list = page.getByRole("listbox", { name: "Экран", exact: true });
    await expect(
      list
        .getByRole("group", { name: "PWA Buyer", exact: true })
        .getByRole("option"),
    ).toHaveCount(1);
    await expect(
      list
        .getByRole("group", { name: "Site", exact: true })
        .getByRole("option", { name: "Site home", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Поиск: Экран", { exact: true }).fill("site");
    await expect(list.getByRole("option")).toHaveCount(1);
    await page.getByLabel("Поиск: Экран", { exact: true }).press("Enter");
    await expect(screen).toContainText("Site home");
    await screen.click();
    await page.getByLabel("Поиск: Экран", { exact: true }).press("Escape");
    await expect(list).toHaveCount(0);
    await expect(screen).toBeFocused();
    await screen.click();
    await page.getByRole("heading", { name: "Site home", exact: true }).click();
    await expect(list).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await screen.click();
    await expect
      .poll(() =>
        list.evaluate((el) => {
          const rect = el.parentElement!.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight
          );
        }),
      )
      .toBe(true);
    await page.getByLabel("Поиск: Экран", { exact: true }).press("Escape");
  } finally {
    await page.evaluate(async ({ session, project }) => {
      const headers = {
        Authorization: `Bearer ${session.token}`,
        "x-studio-ui-token": session.uiToken,
        "Content-Type": "application/json",
      };
      const latest = await fetch("/api/project", { headers }).then((r) =>
        r.json(),
      );
      const response = await fetch("/api/operations", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          baseRevision: latest.revision,
          operations: [
            { type: "setGroups", groups: project.groups ?? [] },
            { type: "removePage", pageId: "custom-site" },
          ],
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    }, snapshot);
  }
});
