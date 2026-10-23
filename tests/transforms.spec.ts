import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { selectStudioOption } from "./select-helpers";

test("numeric Scale preserves content geometry, Resize changes layout and stale drafts survive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto("/");
  const fixture = await page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "x-studio-ui-token": session.uiToken,
      "Content-Type": "application/json",
    };
    const post = async (path: string, body: unknown) => {
      const r = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    };
    const p = await fetch("/api/project", { headers }).then((r) => r.json());
    const id = "affine-" + crypto.randomUUID();
    await post("/api/operations", {
      requestId: crypto.randomUUID(),
      baseRevision: p.revision,
      operations: [
        {
          type: "addPage",
          page: {
            screenId: id,
            name: id,
            viewport: { width: 390, height: 300 },
            nodes: [
              {
                id: id + "-node",
                name: "Affine frame",
                type: "SceneFrame",
                props: {},
                slots: {},
                scene: {
                  kind: "frame",
                  x: 40,
                  y: 20,
                  width: 100,
                  height: 80,
                  fill: "red",
                  linearTransform: [1, 0.25, 0.5, 1],
                },
              },
            ],
          },
        },
      ],
    });
    return {
      id,
      headers,
      origin: location.origin,
      beforeIds: p.pages.map((row: { screenId: string }) => row.screenId),
    };
  });
  try {
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await selectStudioOption(page, "Экран", fixture.id);
    await page
      .getByRole("button", {
        name: "Выделить " + fixture.id + "-node",
        exact: true,
      })
      .click();
    await page.getByText("Преобразования", { exact: true }).click();
    await page.getByRole("button", { name: "Масштаб", exact: true }).click();
    await page.getByLabel("Сохранять пропорции", { exact: true }).uncheck();
    await page.getByLabel("Масштаб X, %", { exact: true }).fill("200");
    await page
      .getByRole("button", { name: "Применить преобразование", exact: true })
      .click();
    const readScene = () =>
      page.evaluate(async (id) => {
        const s = await fetch("/api/session").then((r) => r.json());
        const p = await fetch("/api/project", {
          headers: { Authorization: `Bearer ${s.token}` },
        }).then((r) => r.json());
        return p.pages.find((p: any) => p.screenId === id).nodes[0].scene;
      }, fixture.id);
    await expect.poll(readScene).toEqual({
      kind: "frame",
      x: -10,
      y: 7.5,
      width: 100,
      height: 80,
      fill: "red",
      linearTransform: [2, 0.5, 0.5, 1],
    });
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await expect
      .poll(async () => (await readScene()).linearTransform)
      .toEqual([1, 0.25, 0.5, 1]);
    await page.getByRole("button", { name: "Размер", exact: true }).click();
    await page.getByLabel("Ширина контейнера, px", { exact: true }).fill("140");
    await page
      .getByRole("button", { name: "Применить преобразование", exact: true })
      .click();
    await expect.poll(async () => (await readScene()).width).toBe(140);
    await expect
      .poll(async () => (await readScene()).linearTransform)
      .toEqual([1, 0.25, 0.5, 1]);
    await page.getByLabel("Сохранять пропорции", { exact: true }).check();
    await page.getByLabel("Ширина контейнера, px", { exact: true }).fill("280");
    await expect(
      page.getByLabel("Высота контейнера, px", { exact: true }),
    ).toHaveValue("160");
    const beforeAspect = await fetch(fixture.origin + "/api/project", {
      headers: fixture.headers,
    }).then((r) => r.json());
    const aspect = await fetch(fixture.origin + "/api/operations", {
      method: "POST",
      headers: { ...fixture.headers, Origin: fixture.origin },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: beforeAspect.revision,
        operations: [
          {
            type: "setNodeGeometry",
            nodeId: fixture.id + "-node",
            geometry: {
              x: 40,
              y: 20,
              width: 140,
              height: 160,
              linearTransform: [1, 0.25, 0.5, 1],
            },
          },
        ],
      }),
    });
    expect(aspect.ok).toBe(true);
    await aspect.json();
    await page
      .getByRole("button", {
        name: "Пересчитать от текущего выделения",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Ширина контейнера, px", { exact: true }),
    ).toHaveValue("280");
    await expect(
      page.getByLabel("Высота контейнера, px", { exact: true }),
    ).toHaveValue("320");
    await page
      .getByRole("button", { name: "Применить преобразование", exact: true })
      .click();
    await expect.poll(async () => (await readScene()).height).toBe(320);
    const width = page.getByLabel("Ширина контейнера, px", { exact: true });
    await width.fill("1e");
    await expect(
      page.getByRole("button", {
        name: "Применить преобразование",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("Свойства JSON", { exact: true }),
    ).toBeDisabled();
    const response = await fetch(fixture.origin + "/api/project", {
      headers: fixture.headers,
    });
    const current = await response.json();
    const changed = await fetch(fixture.origin + "/api/operations", {
      method: "POST",
      headers: { ...fixture.headers, Origin: fixture.origin },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: current.revision,
        operations: [
          {
            type: "renamePage",
            pageId: fixture.id,
            name: fixture.id + " renamed",
          },
        ],
      }),
    });
    expect(changed.ok).toBe(true);
    await changed.json();
    await expect(width).toHaveValue("1e");
    await expect(
      page.getByRole("button", {
        name: "Пересчитать от текущего выделения",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Сбросить черновик", exact: true })
      .click();
    await expect(
      page.getByLabel("Свойства JSON", { exact: true }),
    ).toBeEnabled();
    const readProject = () =>
      fetch(fixture.origin + "/api/project", { headers: fixture.headers }).then(
        (r) => r.json(),
      );
    const unchanged = await readProject();
    await page
      .getByRole("button", { name: "Применить преобразование", exact: true })
      .click();
    expect((await readProject()).revision).toBe(unchanged.revision);
    await page.getByLabel("Тема студии", { exact: true }).selectOption("dark");
    await page.getByLabel("Язык студии", { exact: true }).selectOption("en");
    await expect(page.locator(".transform-controls summary")).toHaveText(
      "Transforms",
    );
    await expect(
      page.getByRole("button", { name: "Resize", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Scale", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resize", exact: true }),
    ).toHaveCSS("background-color", "rgb(40, 55, 81)");
    expect(
      (
        await new AxeBuilder({ page })
          .include(".transform-controls")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page
      .locator(".transform-controls")
      .screenshot({ path: test.info().outputPath("transforms-en-dark.png") });
    await page
      .getByLabel("Studio theme", { exact: true })
      .selectOption("light");
    await expect(
      page.getByRole("button", { name: "Resize", exact: true }),
    ).toHaveCSS("background-color", "rgb(237, 241, 254)");
    expect(
      (
        await new AxeBuilder({ page })
          .include(".transform-controls")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page
      .locator(".transform-controls")
      .screenshot({ path: test.info().outputPath("transforms-en-light.png") });
    await page.getByLabel("Container width, px", { exact: true }).fill("160");
    const removed = await fetch(fixture.origin + "/api/operations", {
      method: "POST",
      headers: { ...fixture.headers, Origin: fixture.origin },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: unchanged.revision,
        operations: [{ type: "removePage", pageId: fixture.id }],
      }),
    });
    expect(removed.ok).toBe(true);
    await removed.json();
    const rebase = page.getByRole("button", {
      name: "Rebase on current selection",
      exact: true,
    });
    await expect(rebase).toBeVisible();
    await expect(
      page.getByLabel("Container width, px", { exact: true }),
    ).toHaveValue("160");
    await expect(
      page.getByRole("button", { name: "Apply transform", exact: true }),
    ).toBeDisabled();
    await rebase.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "The selection is unavailable" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Reset draft", exact: true })
      .click();
    expect((await readProject()).pages.map((p: any) => p.screenId)).toEqual(
      fixture.beforeIds,
    );
  } finally {
    // This suite shares one temporary project. Restore page order even when UI
    // assertions fail; Node fetch cleanup also works after Playwright closes page.
    const headers = {
      ...fixture.headers,
      Origin: fixture.origin,
      Connection: "close",
    };
    const current = await fetch(fixture.origin + "/api/project", {
      headers,
    }).then((r) => r.json());
    if (
      current.pages.some(
        (row: { screenId: string }) => row.screenId === fixture.id,
      )
    ) {
      const response = await fetch(fixture.origin + "/api/operations", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          baseRevision: current.revision,
          operations: [{ type: "removePage", pageId: fixture.id }],
        }),
      });
      expect(response.ok).toBe(true);
      const restored = await response.json();
      expect(
        restored.pages.map((row: { screenId: string }) => row.screenId),
      ).toEqual(fixture.beforeIds);
    }
  }
});
