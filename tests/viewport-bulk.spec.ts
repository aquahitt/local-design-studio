import { test, expect } from "@playwright/test";
test("device bulk applies only selected group or all pages atomically, validates drafts and supports undo", async ({
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
  const sync = async () => {
    await expect(
      page.getByText(
        `Сохранено локально · ревизия ${(await read()).revision}`,
        { exact: true },
      ),
    ).toBeVisible();
  };
  const apply = async (operations: unknown[]) =>
    page.evaluate(
      async ({ session, operations }) => {
        const headers = {
          Authorization: `Bearer ${session.token}`,
          "x-studio-ui-token": session.uiToken,
          "Content-Type": "application/json",
        };
        const current = await fetch("/api/project", { headers }).then((r) =>
          r.json(),
        );
        const response = await fetch("/api/operations", {
          method: "POST",
          headers,
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            baseRevision: current.revision,
            operations,
          }),
        });
        if (!response.ok) throw new Error(await response.text());
      },
      { session, operations },
    );
  const before = await read(),
    first = before.pages[0].screenId;
  await apply([
    {
      type: "addPage",
      page: {
        screenId: "bulk-buyer",
        name: "Buyer second",
        viewport: { width: 390 },
        nodes: [],
      },
    },
    {
      type: "addPage",
      page: {
        screenId: "bulk-site",
        name: "Site other",
        viewport: { width: 768, height: 900 },
        nodes: [],
      },
    },
    {
      type: "setGroups",
      groups: [
        {
          id: "bulk-buyer-group",
          name: "PWA Buyer",
          pages: [first, "bulk-buyer"],
          components: [],
          tokens: [],
        },
        {
          id: "bulk-site-group",
          name: "Site",
          pages: ["bulk-site"],
          components: [],
          tokens: [],
        },
        {
          id: "bulk-empty",
          name: "Empty",
          pages: [],
          components: [],
          tokens: [],
        },
      ],
    },
  ]);
  try {
    await sync();
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await page
      .getByRole("button", { name: "Настройки устройства", exact: true })
      .click();
    await page.getByLabel("Тип устройства").selectOption("phone-pill");
    await expect(page.locator(".page-stage iframe")).toHaveCSS(
      "height",
      "756px",
    );
    await sync();
    const initial = await read(),
      revision = initial.revision;
    await page
      .getByRole("button", { name: "Применить к группе", exact: true })
      .click();
    await expect.poll(async () => (await read()).revision).toBe(revision + 1);
    const grouped = await read();
    expect(
      grouped.pages.find((p: any) => p.screenId === "bulk-buyer").viewport,
    ).toEqual(grouped.pages[0].viewport);
    expect(
      grouped.pages.find((p: any) => p.screenId === "bulk-site").viewport,
    ).toEqual({ width: 768, height: 900 });
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await read()).pages.find((p: any) => p.screenId === "bulk-buyer")
            .viewport,
      )
      .toEqual(
        initial.pages.find((p: any) => p.screenId === "bulk-buyer").viewport,
      );
    await sync();
    const allBefore = await read();
    await page.getByLabel("Ширина экрана").fill("810");
    await page.getByLabel("Высота экрана").fill("910");
    await page
      .getByRole("button", { name: "Применить ко всем", exact: true })
      .click();
    await expect
      .poll(async () => (await read()).revision)
      .toBe(allBefore.revision + 1);
    const all = await read();
    expect(all.pages.map((p: any) => p.viewport)).toEqual(
      all.pages.map(() =>
        expect.objectContaining({
          width: 810,
          height: 910,
          device: expect.objectContaining({ cutout: "pill" }),
        }),
      ),
    );
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await read()).pages.find((p: any) => p.screenId === "bulk-site")
            .viewport.width,
      )
      .toBe(768);
    await sync();
    const invalidRevision = (await read()).revision;
    await page.getByLabel("Ширина экрана").fill("0");
    await page
      .getByRole("button", { name: "Применить ко всем", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Проверь размеры");
    expect((await read()).revision).toBe(invalidRevision);
    await page
      .getByRole("button", { name: "Сбросить размеры", exact: true })
      .click();
    const target = page.getByRole("combobox", {
      name: "Группа для применения устройства",
      exact: true,
    });
    await target.click();
    await page
      .getByRole("option", { name: "Empty · 0 экранов", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Применить к группе", exact: true }),
    ).toBeDisabled();
    // Applying a draft to another group must leave the source draft and document intact.
    await target.click();
    await page
      .getByRole("option", { name: "Site · 1 экранов", exact: true })
      .click();
    await page.getByLabel("Ширина экрана").fill("720");
    const source = (await read()).pages[0].viewport;
    await page
      .getByRole("button", { name: "Применить к группе", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await read()).pages.find((p: any) => p.screenId === "bulk-site")
            .viewport.width,
      )
      .toBe(720);
    expect((await read()).pages[0].viewport).toEqual(source);
    await expect(page.getByLabel("Ширина экрана")).toHaveValue("720");
    await page
      .getByRole("button", { name: "Сбросить размеры", exact: true })
      .click();
  } finally {
    await apply([
      { type: "setGroups", groups: before.groups ?? [] },
      { type: "removePage", pageId: "bulk-buyer" },
      { type: "removePage", pageId: "bulk-site" },
    ]);
  }
});
