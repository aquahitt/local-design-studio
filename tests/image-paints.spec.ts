import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { selectStudioOption } from "./select-helpers";

test("image fills import into one revisioned draft, preserve crop pixels and undo after reopening", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/");
  const session = await page.request
    .get("/api/session")
    .then((response) => response.json());
  const origin = new URL(page.url()).origin;
  const headers = {
    Authorization: `Bearer ${session.token}`,
    "x-studio-ui-token": session.uiToken,
    "Content-Type": "application/json",
    Origin: origin,
  };
  const read = () =>
    fetch(origin + "/api/project", {
      headers,
      signal: AbortSignal.timeout(5000),
    }).then((response) => response.json());
  const batch = async (operations: unknown[]) => {
    const before = await read();
    const response = await fetch(origin + "/api/operations", {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        requestId: randomUUID(),
        baseRevision: before.revision,
        operations,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  const id = "image-paint-" + randomUUID(),
    nodeId = id + "-frame";
  const original = await read();
  let releaseList = () => {};
  const listGate = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  let heldList = false,
    listDelivered = false;
  await page.route("**/api/assets-list", async (route) => {
    if (heldList) {
      await route.continue();
      return;
    }
    heldList = true;
    const response = await route.fetch();
    await listGate;
    await route.fulfill({ response });
    listDelivered = true;
  });
  let releaseUpload = () => {};
  const added = await batch([
    {
      type: "addPage",
      page: {
        screenId: id,
        name: id,
        viewport: { width: 500, height: 400 },
        nodes: [
          {
            id: nodeId,
            type: "SceneFrame",
            props: {},
            slots: {},
            scene: {
              kind: "frame",
              x: 20,
              y: 20,
              width: 200,
              height: 160,
              fill: "#123456",
              stroke: "#000000",
              strokeWidth: 4,
            },
          },
        ],
      },
    },
  ]);
  const node = async () =>
    (await read()).pages.find((p: any) => p.screenId === id).nodes[0];
  const open = async () => {
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await selectStudioOption(page, "Экран", id);
    await page
      .getByRole("button", { name: "Выделить " + nodeId, exact: true })
      .click();
  };
  try {
    await expect(page.getByTestId("save-status")).toContainText(
      "ревизия " + added.revision,
    );
    await open();
    const inspector = page.locator(".layout-inspector");
    await inspector
      .getByLabel("Импортировать изображение и добавить заливку", {
        exact: true,
      })
      .setInputFiles({
        name: "crop-source.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path fill="#f00" d="M0 0h100v100H0z"/><path fill="#00f" d="M100 0h100v100H100z"/></svg>',
        ),
      });
    await expect(
      inspector.getByRole("combobox", {
        name: "Размещение изображения",
        exact: true,
      }),
    ).toBeVisible();
    releaseList();
    await expect.poll(() => listDelivered).toBe(true);
    await expect(
      inspector.getByRole("combobox", {
        name: "Изображение заливки",
        exact: true,
      }),
    ).toContainText("crop-source.svg");
    expect((await read()).revision).toBe(added.revision);
    await selectStudioOption(page, "Размещение изображения", "Вписать целиком");
    await selectStudioOption(page, "Размещение изображения", "Кадрировать");
    const draft = () =>
      inspector
        .getByLabel("Параметры слоя JSON", { exact: true })
        .inputValue()
        .then(JSON.parse);
    await expect
      .poll(async () => (await draft()).scene.fills[0].mapping.imageToFrame)
      .toEqual([200, 0, 0, 100, 0, 30]);
    await inspector
      .getByText("Матрица изображения UV → px", { exact: true })
      .click();
    const x = inspector.getByLabel("Матрица изображения x", { exact: true });
    await x.fill("-");
    await x.blur();
    await expect(x).toHaveValue("-");
    await expect(
      inspector.getByRole("button", { name: "Применить слой", exact: true }),
    ).toBeDisabled();
    await x.fill("0");
    await inspector
      .getByRole("button", { name: "Открыть кадрирование", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Кадрирование изображения",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath("image-crop.png") });
    expect(
      (await new AxeBuilder({ page }).include(".image-crop-dialog").analyze())
        .violations,
    ).toEqual([]);
    const surface = dialog.getByRole("group", {
      name: "Область кадрирования",
      exact: true,
    });
    await surface.focus();
    await surface.press("Shift+ArrowRight");
    await expect
      .poll(async () => (await draft()).scene.fills[0].mapping.imageToFrame[4])
      .toBe(10);
    const beforeDrag = (await draft()).scene.fills[0].mapping.imageToFrame;
    const box = (await surface.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 30,
      box.y + box.height / 2 + 15,
    );
    await surface.press("Escape");
    await page.mouse.up();
    expect((await draft()).scene.fills[0].mapping.imageToFrame).toEqual(
      beforeDrag,
    );
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Увеличить изображение", exact: true })
      .click();
    expect((await draft()).scene.fills[0].mapping.imageToFrame[0]).toBeCloseTo(
      250,
    );
    await dialog
      .getByRole("button", { name: "Уменьшить изображение", exact: true })
      .click();
    expect((await draft()).scene.fills[0].mapping.imageToFrame[0]).toBeCloseTo(
      200,
    );
    await dialog
      .getByRole("button", {
        name: "Повернуть изображение на 15°",
        exact: true,
      })
      .click();
    expect(
      (await draft()).scene.fills[0].mapping.imageToFrame[1],
    ).toBeGreaterThan(50);
    await dialog.getByRole("button", { name: "Готово", exact: true }).click();
    const reset = await draft();
    reset.scene.fills[0].mapping.imageToFrame = [200, 0, 0, 100, 10, 30];
    await inspector
      .getByLabel("Параметры слоя JSON", { exact: true })
      .fill(JSON.stringify(reset));
    await page.getByLabel("Язык студии", { exact: true }).selectOption("en");
    await page.getByLabel("Studio theme", { exact: true }).selectOption("dark");
    await inspector
      .getByRole("button", { name: "Open crop editor", exact: true })
      .click();
    const englishDialog = page.getByRole("dialog", {
      name: "Image crop",
      exact: true,
    });
    await expect(
      englishDialog.getByRole("button", {
        name: "Scale image up",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include(".image-crop-dialog").analyze())
        .violations,
    ).toEqual([]);
    await englishDialog.screenshot({
      path: testInfo.outputPath("image-crop-en-dark.png"),
    });
    await englishDialog
      .getByRole("button", { name: "Done", exact: true })
      .click();
    await page
      .getByLabel("Studio language", { exact: true })
      .selectOption("ru");
    await page.getByLabel("Тема студии", { exact: true }).selectOption("light");

    expect((await read()).revision).toBe(added.revision);
    // Hold a successful upload response, then edit that paint. Late bytes must
    // remain unused assets rather than replacing the user's newer draft.
    let uploaded = false;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await page.route("**/api/assets", async (route) => {
      const response = await route.fetch();
      uploaded = true;
      await uploadGate;
      await route.fulfill({ response });
    });
    const originalAsset = (await draft()).scene.fills[0].asset;
    await inspector
      .getByLabel("Импортировать изображение для заливки", { exact: true })
      .setInputFiles({
        name: "late.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><path fill="green" d="M0 0h20v10H0z"/></svg>',
        ),
      });
    await expect.poll(() => uploaded).toBe(true);
    const edited = await draft();
    edited.scene.fills[0].opacity = 0.4;
    await inspector
      .getByLabel("Параметры слоя JSON", { exact: true })
      .fill(JSON.stringify(edited));
    releaseUpload();
    await expect(
      inspector.getByText("Обрабатываем изображения…", { exact: true }),
    ).toHaveCount(0);
    expect((await draft()).scene.fills[0].asset).toBe(originalAsset);
    expect((await draft()).scene.fills[0].opacity).toBe(0.4);
    await inspector
      .getByLabel("Непрозрачность заливки 1", { exact: true })
      .fill("1");
    await inspector
      .getByRole("button", { name: "Применить слой", exact: true })
      .click();
    await expect
      .poll(async () => (await read()).revision)
      .toBe(added.revision + 1);
    const saved = await node();
    expect(saved.scene.fills).toHaveLength(2);
    expect(saved.scene.fills[1].color).toEqual({ r: 18, g: 52, b: 86, a: 1 });
    expect(saved.scene.fills[0].mapping).toEqual({
      mode: "crop",
      imageToFrame: [200, 0, 0, 100, 10, 30],
    });
    const frame = page.frameLocator(`iframe[title="Экран ${id}"]`);
    await expect(
      frame.locator(`[data-node-id="${nodeId}"] image`),
    ).toHaveAttribute("transform", "matrix(200 0 0 100 10 30)");
    await page.reload();
    await open();
    expect((await node()).scene).toEqual(saved.scene);
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await expect.poll(async () => (await node()).scene.fills).toBeUndefined();
    expect((await node()).scene.fill).toBe("#123456");
    const beforeProposal = await read();
    const description = "Image proposal " + id;
    const created = await page.request.post(origin + "/api/proposals", {
      headers,
      data: {
        description,
        batch: {
          requestId: randomUUID(),
          baseRevision: beforeProposal.revision,
          operations: [{ type: "setNodeMetadata", nodeId, scene: saved.scene }],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const proposal = await created.json();
    expect(proposal.status).toBe("pending");
    const agentHeaders = {
      Authorization: headers.Authorization,
      "Content-Type": "application/json",
      Origin: origin,
    };
    expect(
      (
        await page.request.post(
          origin + "/api/proposals/" + proposal.id + "/approve",
          { headers: agentHeaders, data: {} },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(
          origin + "/api/proposals/" + proposal.id + "/apply",
          { headers: agentHeaders, data: {} },
        )
      ).status(),
    ).toBe(403);
    await page
      .getByRole("button", { name: "Предложения агента", exact: true })
      .click();
    const card = page
      .locator(".proposal-card")
      .filter({
        has: page.getByRole("heading", { name: description, exact: true }),
      });
    const proposed = card.frameLocator("iframe").nth(1);
    await expect(
      proposed.locator(`[data-node-id="${nodeId}"] image`),
    ).toHaveAttribute("transform", "matrix(200 0 0 100 10 30)");
    await expect(proposed.locator("html")).toHaveAttribute(
      "data-studio-preview-revision",
      String(beforeProposal.revision + 1),
    );
    expect((await read()).revision).toBe(beforeProposal.revision);
    expect((await node()).scene.fills).toBeUndefined();
    await card
      .getByRole("button", { name: "Подтвердить и применить", exact: true })
      .click();
    await expect
      .poll(async () => (await read()).revision)
      .toBe(beforeProposal.revision + 1);
    expect((await node()).scene.fills).toEqual(saved.scene.fills);
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await expect.poll(async () => (await node()).scene.fills).toBeUndefined();
  } finally {
    releaseList();
    releaseUpload();
    await batch([{ type: "removePage", pageId: id }]);
    expect((await read()).pages.map((p: any) => p.screenId)).toEqual(
      original.pages.map((p: any) => p.screenId),
    );
  }
});
