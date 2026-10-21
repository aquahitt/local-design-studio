import { expect, test } from "@playwright/test";
import { selectStudioOption } from "./select-helpers";

test("affine agent proposal previews before approval, preserves matrix through layout edits and Undo", async ({
  page,
}) => {
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
    const baseline = await post("/api/operations", {
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
                  rotation: 15,
                },
              },
            ],
          },
        },
      ],
    });
    await post("/api/proposals", {
      description: id,
      batch: {
        requestId: crypto.randomUUID(),
        baseRevision: baseline.revision,
        operations: [
          {
            type: "setNodeGeometry",
            nodeId: id + "-node",
            geometry: {
              x: 40,
              y: 20,
              width: 100,
              height: 80,
              linearTransform: [1, 0.25, 0.5, 1],
            },
          },
        ],
      },
    });
    return {
      id,
      headers,
      origin: location.origin,
      beforeIds: p.pages.map((row: { screenId: string }) => row.screenId),
    };
  });
  try {
    await page
      .getByRole("button", { name: "Предложения агента", exact: true })
      .click();
    const card = page.locator(".proposal-card").filter({
      has: page.getByRole("heading", { name: fixture.id, exact: true }),
    });
    await expect(card).toContainText("Изменить геометрию слоя");
    await expect(card.locator(".proposal-comparison iframe")).toHaveCount(2);
    await card
      .getByRole("button", { name: "Подтвердить и применить", exact: true })
      .click();
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await selectStudioOption(page, "Экран", fixture.id);
    await page
      .getByRole("button", {
        name: "Выделить " + fixture.id + "-node",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Матричное преобразование", { exact: true }),
    ).toHaveText("[1,0.25,0.5,1]");
    await expect(page.getByLabel("Поворот слоя", { exact: true })).toHaveCount(
      0,
    );
    await page.getByLabel("Ширина слоя", { exact: true }).fill("140");
    await page
      .getByRole("button", { name: "Применить слой", exact: true })
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
      x: 40,
      y: 20,
      width: 140,
      height: 80,
      fill: "red",
      linearTransform: [1, 0.25, 0.5, 1],
    });
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await expect.poll(async () => (await readScene()).width).toBe(100);
    const advanced = page.getByLabel("Параметры слоя JSON", { exact: true });
    const rotateDraft = JSON.parse(await advanced.inputValue());
    delete rotateDraft.scene.linearTransform;
    rotateDraft.scene.rotation = 30;
    await advanced.fill(JSON.stringify(rotateDraft));
    await page
      .getByRole("button", { name: "Применить слой", exact: true })
      .click();
    await expect.poll(readScene).toEqual({
      kind: "frame",
      x: 40,
      y: 20,
      width: 100,
      height: 80,
      fill: "red",
      rotation: 30,
    });
    const matrixDraft = JSON.parse(await advanced.inputValue());
    delete matrixDraft.scene.rotation;
    matrixDraft.scene.linearTransform = [1, 0.5, 0, 1];
    await advanced.fill(JSON.stringify(matrixDraft));
    await page
      .getByRole("button", { name: "Применить слой", exact: true })
      .click();
    await expect
      .poll(async () => (await readScene()).linearTransform)
      .toEqual([1, 0.5, 0, 1]);
    const identityDraft = JSON.parse(await advanced.inputValue());
    delete identityDraft.scene.linearTransform;
    await advanced.fill(JSON.stringify(identityDraft));
    await page
      .getByRole("button", { name: "Применить слой", exact: true })
      .click();
    await expect.poll(readScene).toEqual({
      kind: "frame",
      x: 40,
      y: 20,
      width: 100,
      height: 80,
      fill: "red",
    });
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
