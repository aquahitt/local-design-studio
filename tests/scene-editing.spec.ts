import { test, expect } from "@playwright/test";
import { selectStudioOption } from "./select-helpers";

test("frame stroke preserves child coordinates and multi-move preserves document order", async ({ page }) => {
  await page.goto("/");
  const screenId = "scene-geometry-regression";
  const state = await page.evaluate(async (screenId) => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = {
      Authorization: `Bearer ${session.token}`, "x-studio-ui-token": session.uiToken,
      "Content-Type": "application/json",
    };
    const project = await fetch("/api/project", { headers }).then((r) => r.json());
    const nodes = ["a", "b", "c", "d"].map((id, index) => ({
      id: "regression-" + id, name: id.toUpperCase(), type: "SceneText",
      props: { text: id }, slots: {},
      scene: { kind: "text", x: 400, y: index * 40, width: 100, height: 30 },
    }));
    nodes.push({
      id: "regression-frame", name: "Frame", type: "SceneFrame", props: {},
      slots: { content: [{
        id: "regression-child", type: "SceneText", props: { text: "Child" }, slots: {},
        scene: { kind: "text", x: 10, y: 20, width: 120, height: 40 },
      }] },
      scene: { kind: "frame", x: 40, y: 30, width: 300, height: 200,
        stroke: "#123456", strokeWidth: 10, clip: true },
    } as any);
    const response = await fetch("/api/operations", {
      method: "POST", headers,
      body: JSON.stringify({ requestId: crypto.randomUUID(), baseRevision: project.revision,
        operations: [{ type: "addPage", page: {
          screenId, name: "Геометрия и порядок", viewport: { width: 800, height: 700 }, nodes,
        } }] }),
    });
    if (!response.ok) throw new Error(await response.text());
    return { headers, revision: (await response.json()).revision };
  }, screenId);
  const order = () => page.evaluate(async ({ headers, screenId }) => {
    const project = await fetch("/api/project", { headers }).then((r) => r.json());
    return project.pages.find((p: any) => p.screenId === screenId).nodes.map((n: any) => n.id);
  }, { headers: state.headers, screenId });
  try {
    await expect(page.getByTestId("save-status")).toContainText("ревизия " + state.revision);
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await selectStudioOption(page, "Экран", "Геометрия и порядок");
    const frame = page.frameLocator('iframe[title="Экран Геометрия и порядок"]');
    const child = frame.locator('[data-node-id="regression-child"]');
    await expect(child).toBeVisible();
    const geometry = await child.evaluate((node) => {
      const parent = node.parentElement!.closest('[data-node-id="regression-frame"]')!;
      const a = node.getBoundingClientRect(), b = parent.getBoundingClientRect();
      return { x: a.x - b.x, y: a.y - b.y, width: b.width, height: b.height };
    });
    expect(geometry).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    await page.getByRole("button", { name: "Выделить regression-a", exact: true }).click();
    await page.getByRole("checkbox", { name: "Выбрать слой C", exact: true }).check();
    await page.getByRole("button", { name: "Перенести", exact: true }).click();
    await expect.poll(order).toEqual([
      "regression-b", "regression-d", "regression-frame", "regression-a", "regression-c",
    ]);
    await page.getByRole("button", { name: "Отменить правку", exact: true }).click();
    await expect.poll(order).toEqual([
      "regression-a", "regression-b", "regression-c", "regression-d", "regression-frame",
    ]);
  } finally {
    await page.evaluate(async ({ headers, screenId }) => {
      const project = await fetch("/api/project", { headers }).then((r) => r.json());
      const response = await fetch("/api/operations", {
        method: "POST", headers,
        body: JSON.stringify({ requestId: crypto.randomUUID(), baseRevision: project.revision,
          operations: [{ type: "removePage", pageId: screenId }] }),
      });
      if (!response.ok) throw new Error(await response.text());
    }, { headers: state.headers, screenId });
  }
});

test("scene layers create, edit, move, duplicate, hide and undo through durable operations", async ({ page }) => {
  await page.goto("/");
  const id = "scene-acceptance";
  const state = await page.evaluate(async (screenId) => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = { Authorization: `Bearer ${session.token}`, "x-studio-ui-token": session.uiToken, "Content-Type": "application/json" };
    const before = await fetch("/api/project", { headers }).then((r) => r.json());
    const result = await fetch("/api/operations", { method: "POST", headers, body: JSON.stringify({ requestId: crypto.randomUUID(), baseRevision: before.revision, operations: [{ type: "addPage", page: { screenId, name: "Проверка сцены", viewport: { width: 800, height: 700 }, nodes: [] } }] }) }).then((r) => r.json());
    return { headers, revision: result.revision };
  }, id);
  try {
    await expect(page.getByTestId("save-status")).toContainText("ревизия " + state.revision);
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await selectStudioOption(page, "Экран", "Проверка сцены");
    await page.getByRole("button", { name: "Фрейм +", exact: true }).click();
    await expect(page.getByLabel("Название слоя", { exact: true })).toHaveValue("Фрейм");
    await page.getByLabel("Название слоя", { exact: true }).fill("Карточка");
    await page.getByRole("button", { name: "Применить слой", exact: true }).click();
    await expect(page.getByLabel("Название слоя", { exact: true })).toHaveValue("Карточка");
    await expect(page.getByRole("button", { name: "Применить слой", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Текст +", exact: true }).click();
    await expect(page.getByLabel("Название слоя", { exact: true })).toHaveValue("Текст");
    await expect(page.getByLabel("Свойства JSON", { exact: true })).toContainText("Новый текст");
    await page.getByLabel("Свойства JSON", { exact: true }).fill('{"text":"Локальный заголовок"}');
    await page.getByRole("button", { name: "Применить свойства", exact: true }).click();
    const preview = page.frameLocator('iframe[title="Экран Проверка сцены"]');
    await expect(preview.getByText("Локальный заголовок", { exact: true })).toBeVisible();
    await selectStudioOption(page, "Фрейм назначения", "Карточка");
    await page.getByRole("button", { name: "Перенести", exact: true }).click();
    await expect(preview.locator('[data-node-id] [data-node-id]').getByText("Локальный заголовок", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Дублировать", exact: true }).click();
    await expect(preview.getByText("Локальный заголовок", { exact: true })).toHaveCount(2);
    await page.getByText("Комментарии и варианты", { exact: false }).click();
    await page.getByLabel("Новый комментарий", { exact: true }).fill("Проверить заголовок");
    await page.getByLabel("Обоснование решения", { exact: true }).fill("Сохранить читаемость на мобильном экране");
    await page.getByRole("button", { name: "Добавить комментарий", exact: true }).click();
    await expect(page.getByText("Проверить заголовок", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Решить", exact: true }).click();
    await expect(page.getByRole("button", { name: "Открыть снова", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Скрыть", exact: true }).click();
    await expect(preview.getByText("Локальный заголовок", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Отменить правку", exact: true }).click();
    await expect(preview.getByText("Локальный заголовок", { exact: true })).toHaveCount(2);
  } finally {
    await page.evaluate(async ({ headers, screenId }) => {
      const project = await fetch("/api/project", { headers }).then((r) => r.json());
      await fetch("/api/operations", { method: "POST", headers, body: JSON.stringify({ requestId: crypto.randomUUID(), baseRevision: project.revision, operations: [{ type: "removePage", pageId: screenId }, { type: "setAnnotations", annotations: (project.annotations ?? []).filter((row: { pageId?: string }) => row.pageId !== screenId) }] }) });
    }, { headers: state.headers, screenId: id });
  }
});

test("instance variant, text override and detach preserve rendered content", async ({ page }) => {
  await page.goto("/");
  const ids = { page: "instance-acceptance", definition: "acceptance-definition", source: "acceptance-source", instance: "acceptance::instance" };
  await page.evaluate(async (ids) => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = { Authorization: `Bearer ${session.token}`, "x-studio-ui-token": session.uiToken, "Content-Type": "application/json" };
    const project = await fetch("/api/project", { headers }).then((r) => r.json());
    const definitions = [...(project.designComponents ?? []), { id: ids.definition, name: "Заголовок", version: 1, nodes: [{ id: ids.source, type: "SceneText", props: { text: "Базовый заголовок" }, slots: {}, scene: { kind: "text", x: 0, y: 0, width: 280, height: 80, fontSize: 20 } }], variants: { alternative: { [ids.source]: { text: "Вариант заголовка" } } } }];
    const response = await fetch("/api/operations", { method: "POST", headers, body: JSON.stringify({ requestId: crypto.randomUUID(), baseRevision: project.revision, operations: [{ type: "setDesignComponents", definitions }, { type: "addPage", page: { screenId: ids.page, name: "Проверка экземпляра", viewport: { width: 800, height: 700 }, nodes: [{ id: ids.instance, name: "Экземпляр", type: "DesignInstance", props: {}, slots: {}, instance: { definitionId: ids.definition }, scene: { kind: "component", x: 20, y: 20, width: 300, height: 100 } }] } }] }) });
    if (!response.ok) throw new Error(await response.text());
  }, ids);
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", "Проверка экземпляра");
  await page.getByRole("button", { name: "Выделить " + ids.instance, exact: true }).click();
  const preview = page.frameLocator('iframe[title="Экран Проверка экземпляра"]');
  await expect(preview.getByText("Базовый заголовок", { exact: true })).toBeVisible();
  await preview.getByText("Базовый заголовок", { exact: true }).click();
  await expect(page.getByLabel("Название слоя", { exact: true })).toHaveValue("Экземпляр");
  await selectStudioOption(page, "Вариант экземпляра", "alternative");
  await page.getByRole("button", { name: "Применить слой", exact: true }).click();
  await expect(preview.getByText("Вариант заголовка", { exact: true })).toBeVisible();
  const metadata = page.getByLabel("Параметры слоя JSON", { exact: true });
  const draft = JSON.parse(await metadata.inputValue());
  draft.instance.overrides = { [ids.source]: { text: "Мой заголовок" } };
  await metadata.fill(JSON.stringify(draft));
  await page.getByRole("button", { name: "Применить слой", exact: true }).click();
  await expect(preview.getByText("Мой заголовок", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Отсоединить экземпляр", exact: true }).click();
  await expect(page.getByRole("button", { name: "Отсоединить экземпляр", exact: true })).toHaveCount(0);
  await expect(preview.getByText("Мой заголовок", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/alpha3-scene.png", fullPage: true });
});
