import { randomUUID } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";
import type { Operation } from "../src/core/operations";
import type { Project, ProjectNode, ProjectPage } from "../src/core/project";
import { selectStudioOption } from "./select-helpers";

type Point = { x: number; y: number };

function frame(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 80,
): ProjectNode {
  return {
    id,
    type: "SceneFrame",
    props: {},
    slots: { content: [] },
    scene: { kind: "frame", x, y, width, height, fill: "#e36d40" },
  };
}

async function createFixture(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const session = await page.evaluate(async () => {
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ token: string; uiToken: string }>;
  });
  const headers = {
    Authorization: `Bearer ${session.token}`,
    "x-studio-ui-token": session.uiToken,
    "Content-Type": "application/json",
    Origin: origin,
    Connection: "close",
  };
  const api = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      signal: AbortSignal.timeout(5000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  };
  const read = () => api<Project>("/api/project");
  const id = "snapping-" + randomUUID();
  const initial = await read();
  const originalPages = initial.pages.map((item) => item.screenId);
  const batch = async (operations: Operation[]) =>
    api<Project>("/api/operations", {
      requestId: randomUUID(),
      baseRevision: (await read()).revision,
      operations,
    });
  const ownPage: ProjectPage = {
    screenId: id,
    name: id,
    viewport: { width: 800, height: 600 },
    nodes: [
      frame(id + "-a", 80, 80),
      frame(id + "-b", 210, 250, 70, 50),
      { ...frame(id + "-target", 420, 160, 100, 110), locked: true },
    ],
  };
  await batch([{ type: "addPage", page: ownPage }]);
  const currentPage = async () => {
    const found = (await read()).pages.find((item) => item.screenId === id);
    if (!found) throw new Error("Owned snapping page is missing");
    return found;
  };
  const node = (suffix = "a") =>
    page
      .frameLocator(`iframe[title="Холст ${id}"]`)
      .locator(`[data-node-id="${id}-${suffix}"]`);
  const canvas = page.getByRole("region", {
    name: "Свободный холст",
    exact: true,
  });
  const view = async () => ({
    zoom: Number(await canvas.getAttribute("data-zoom")),
    panX: Number(await canvas.getAttribute("data-pan-x")),
    panY: Number(await canvas.getAttribute("data-pan-y")),
  });
  const ready = async (suffix = "a") => {
    const revision = (await read()).revision;
    await expect
      .poll(async () => {
        const { context } = await api<{ context: any }>("/api/context");
        const camera = context?.camera;
        const displayed = await view();
        const measured = context?.bounds?.[id + "-" + suffix];
        const box = await node(suffix).boundingBox();
        return (
          context?.pageId === id &&
          context.revision === revision &&
          camera?.revision === revision &&
          camera.transient === false &&
          camera.view.zoom === displayed.zoom &&
          camera.view.panX === displayed.panX &&
          camera.view.panY === displayed.panY &&
          camera.bounds.some(
            (bound: { id: string }) => bound.id === id + "-" + suffix,
          ) &&
          !!measured &&
          !!box &&
          (["x", "y", "width", "height"] as const).every(
            (key) => Math.abs(box[key] - measured[key]) < 1,
          )
        );
      })
      .toBe(true);
  };
  const select = async (suffix = "a") => {
    await page
      .getByRole("button", { name: `Выделить ${id}-${suffix}`, exact: true })
      .click();
    await expect(page.getByTestId("selection")).toContainText(
      id + "-" + suffix,
    );
    await ready(suffix);
  };
  const open = async () => {
    await expect(page.getByTestId("save-status")).toContainText(
      "ревизия " + (await read()).revision,
    );
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await selectStudioOption(page, "Экран", id);
    const edit = page.getByRole("button", {
      name: "Редактирование холста",
      exact: true,
    });
    if ((await edit.getAttribute("aria-pressed")) !== "true")
      await edit.click();
    await expect(canvas).toBeVisible();
    // Initial fit is asynchronous; establish a canonical render before resetting the camera.
    await ready();
    await page
      .getByRole("button", { name: "Масштаб 100%", exact: true })
      .click();
    await expect(canvas).toHaveAttribute("data-zoom", "1");
    await select();
  };
  const center = async (suffix = "a") => {
    await ready(suffix);
    const box = (await node(suffix).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const begin = async (point?: Point) => {
    point ??= await center();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    return point;
  };
  const undo = async () => {
    const before = (await read()).revision;
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await expect.poll(async () => (await read()).revision).toBe(before + 1);
    await ready();
  };
  const cleanup = async () => {
    const project = await read();
    const own = project.pages.find((item) => item.screenId === id);
    if (own) {
      const unlock: Operation[] = [];
      const visit = (nodes: ProjectNode[]) =>
        nodes.forEach((item) => {
          if (item.locked)
            unlock.push({
              type: "setNodeMetadata",
              nodeId: item.id,
              locked: false,
            });
          Object.values(item.slots).forEach(visit);
        });
      visit(own.nodes);
      for (const guide of own.guides ?? []) {
        if (guide.locked)
          unlock.push({
            type: "setGuideLocked",
            pageId: id,
            guideId: guide.id,
            locked: false,
          });
      }
      if (unlock.length) await batch(unlock);
      await batch([{ type: "removePage", pageId: id }]);
    }
    expect((await read()).pages.map((item) => item.screenId)).toEqual(
      originalPages,
    );
  };
  return {
    id,
    api,
    read,
    batch,
    currentPage,
    node,
    canvas,
    view,
    ready,
    select,
    open,
    center,
    begin,
    undo,
    cleanup,
  };
}

const test = base.extend<{ studio: Awaited<ReturnType<typeof createFixture>> }>(
  {
    studio: async ({ page }, use, testInfo) => {
      const fixture = await createFixture(page);
      try {
        await use(fixture);
      } finally {
        // An assertion can fail while pointer capture is active. Cancel before
        // pointerup so teardown never commits the preview or races its own cleanup.
        await page.keyboard.press("Escape").catch(() => {});
        await page.keyboard.up("Control").catch(() => {});
        await page.keyboard.up("Meta").catch(() => {});
        await page.keyboard.up("Shift").catch(() => {});
        await page.mouse.up().catch(() => {});
        try {
          await fixture.cleanup();
        } catch (error) {
          if (testInfo.status === testInfo.expectedStatus) throw error;
          // Keep the original assertion/timeout as the primary failure.
          await testInfo.attach("cleanup-failure", {
            body: String(error),
            contentType: "text/plain",
          });
        }
      }
    },
  },
);

test("object snapping previews its matched line, bypasses at a stationary pointer, commits once and survives Undo/reload", async ({
  page,
  studio: f,
}) => {
  await f.open();
  await expect(
    page.getByRole("button", { name: "Умные привязки", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const before = await f.read();
  const original = await f.currentPage();
  const writes: { baseRevision: number; operations: Operation[] }[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/operations" &&
      request.method() === "POST"
    ) {
      writes.push(request.postDataJSON());
    }
  });
  const start = await f.begin();
  const originalBox = (await f.node().boundingBox())!;
  // Moving right edge 180 to within 4 screen px of locked target's left edge 420.
  await page.mouse.move(start.x + 236, start.y + 27, { steps: 4 });
  const line = page.locator('[data-snap-axis="x"][data-snap-position="420"]');
  await expect(line).toBeVisible();
  await expect
    .poll(async () => (await f.node().boundingBox())!.x)
    .toBeCloseTo(originalBox.x + 240, 2);
  expect(await f.read()).toEqual(before);
  for (const modifier of ["Control", "Meta"]) {
    await page.keyboard.down(modifier);
    await expect(line).toHaveCount(0);
    await expect
      .poll(async () => (await f.node().boundingBox())!.x)
      .toBeCloseTo(originalBox.x + 236, 2);
    await page.keyboard.up(modifier);
    await expect(line).toBeVisible();
    await expect
      .poll(async () => (await f.node().boundingBox())!.x)
      .toBeCloseTo(originalBox.x + 240, 2);
  }
  await page.mouse.up();
  await expect
    .poll(async () => (await f.read()).revision)
    .toBe(before.revision + 1);
  expect(writes).toHaveLength(1);
  expect(writes[0].baseRevision).toBe(before.revision);
  expect(writes[0].operations).toHaveLength(1);
  expect(writes[0].operations[0]).toMatchObject({
    type: "setNodeGeometry",
    nodeId: f.id + "-a",
  });
  expect((await f.currentPage()).nodes[0].scene).toMatchObject({
    x: 320,
    y: 107,
  });
  expect((await f.currentPage()).nodes.slice(1)).toEqual(
    original.nodes.slice(1),
  );
  await expect(line).toHaveCount(0);
  const saved = await f.currentPage();
  await page.reload();
  await f.open();
  expect(await f.currentPage()).toEqual(saved);
  await f.undo();
  expect(await f.currentPage()).toEqual(original);
});

for (const zoom of [0.75, 1.5]) {
  test(`snap enter/release thresholds stay in screen pixels at zoom ${zoom} after pan`, async ({
    page,
    studio: f,
  }) => {
    await f.open();
    await f.canvas.focus();
    await page.keyboard.press("Shift+2");
    const input = page.getByRole("spinbutton", {
      name: "Масштаб холста, проценты",
      exact: true,
    });
    await input.fill(String(zoom * 100));
    await input.press("Enter");
    await expect(f.canvas).toHaveAttribute("data-zoom", String(zoom));
    await f.ready();
    const prior = await f.view();
    const box = (await f.canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(23, -19);
    await expect
      .poll(async () => (await f.view()).panX)
      .toBeCloseTo(prior.panX - 23, 4);
    await f.ready();
    const original = await f.read();
    const originalBox = (await f.node().boundingBox())!;
    const start = await f.begin();
    const line = page.locator('[data-snap-axis="x"][data-snap-position="420"]');
    const move = async (distance: number) =>
      page.mouse.move(start.x + 240 * zoom - distance, start.y + 27 * zoom);
    await move(7);
    await expect(line).toHaveCount(0);
    await expect
      .poll(async () => (await f.node().boundingBox())!.x)
      .toBeCloseTo(originalBox.x + 240 * zoom - 7, 2);
    await move(5);
    await expect(line).toBeVisible();
    await expect
      .poll(async () => (await f.node().boundingBox())!.x)
      .toBeCloseTo(originalBox.x + 240 * zoom, 2);
    await move(8);
    await expect(line).toBeVisible();
    await expect
      .poll(async () => (await f.node().boundingBox())!.x)
      .toBeCloseTo(originalBox.x + 240 * zoom, 2);
    await move(10);
    await expect(line).toHaveCount(0);
    await expect
      .poll(async () => (await f.node().boundingBox())!.x)
      .toBeCloseTo(originalBox.x + 240 * zoom - 10, 2);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await f.read()).toEqual(original);
  });
}

test("multiple selected roots snap by their union and one Undo restores the complete move", async ({
  page,
  studio: f,
}) => {
  await f.open();
  const pointB = await f.center("b");
  await page.keyboard.down("Shift");
  await page.mouse.click(pointB.x, pointB.y);
  await page.keyboard.up("Shift");
  for (const suffix of ["a", "b"]) {
    const row = page.locator(".layer-row").filter({
      has: page.getByRole("button", {
        name: `Выделить ${f.id}-${suffix}`,
        exact: true,
      }),
    });
    await expect(row.getByRole("checkbox")).toBeChecked();
  }
  await expect
    .poll(async () => {
      const { context } = await f.api<{ context: { selectedIds: string[] } }>(
        "/api/context",
      );
      return [...context.selectedIds].sort();
    })
    .toEqual([f.id + "-a", f.id + "-b"].sort());
  await f.ready();
  const original = await f.currentPage();
  const revision = (await f.read()).revision;
  const start = await f.begin();
  // Union right edge is 280: the individual A edge (180) must not be used.
  await page.mouse.move(start.x + 136, start.y + 39, { steps: 4 });
  await expect(
    page.locator('[data-snap-axis="x"][data-snap-position="420"]'),
  ).toBeVisible();
  expect((await f.read()).revision).toBe(revision);
  await page.mouse.up();
  await expect.poll(async () => (await f.read()).revision).toBe(revision + 1);
  const moved = await f.currentPage();
  expect(moved.nodes[0].scene).toMatchObject({ x: 220, y: 119 });
  expect(moved.nodes[1].scene).toMatchObject({ x: 350, y: 289 });
  expect(moved.nodes[2]).toEqual(original.nodes[2]);
  await f.undo();
  expect(await f.currentPage()).toEqual(original);
});

for (const tool of ["Изменение размера", "Масштабирование содержимого"]) {
  test(`${tool}: side handle reaches a guide without moving its fixed anchor`, async ({
    page,
    studio: f,
  }) => {
    await f.batch([
      {
        type: "addGuide",
        pageId: f.id,
        guide: { id: f.id + "-guide", axis: "x", position: 420 },
      },
    ]);
    await f.open();
    await page.getByRole("button", { name: tool, exact: true }).click();
    const before = await f.currentPage();
    const revision = (await f.read()).revision;
    const originalBox = (await f.node().boundingBox())!;
    const handle = (await page
      .locator('[data-transform-handle="e"]')
      .boundingBox())!;
    const start = await f.begin({
      x: handle.x + handle.width / 2,
      y: handle.y + handle.height / 2,
    });
    await page.mouse.move(start.x + 236, start.y, { steps: 4 });
    await expect(
      page.locator('[data-snap-axis="x"][data-snap-position="420"]'),
    ).toBeVisible();
    const box = (await f.node().boundingBox())!;
    expect(box.x).toBeCloseTo(originalBox.x, 2);
    expect(box.y).toBeCloseTo(originalBox.y, 2);
    expect(box.width).toBeCloseTo(340, 2);
    expect(box.height).toBeCloseTo(80, 2);
    expect((await f.read()).revision).toBe(revision);
    await page.mouse.up();
    await expect.poll(async () => (await f.read()).revision).toBe(revision + 1);
    const scene = (await f.currentPage()).nodes[0].scene!;
    if (tool === "Изменение размера") {
      expect(scene).toMatchObject({ x: 80, y: 80, width: 340, height: 80 });
    } else {
      expect(scene.width).toBe(100);
      expect(scene.height).toBe(80);
      expect(scene.linearTransform![0]).toBeCloseTo(3.4, 8);
      expect(scene.linearTransform![3]).toBeCloseTo(1, 8);
    }
    await f.undo();
    expect(await f.currentPage()).toEqual(before);
  });
}

test("Escape and an external revision cancel the snapped preview without a late pointerup write", async ({
  page,
  studio: f,
}) => {
  await f.open();
  const original = await f.currentPage();
  let before = await f.read();
  let start = await f.begin();
  await page.mouse.move(start.x + 236, start.y + 39, { steps: 4 });
  await expect(
    page.locator('[data-snap-axis="x"][data-snap-position="420"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("[data-snap-axis]")).toHaveCount(0);
  expect(await f.read()).toEqual(before);
  await f.ready();
  before = await f.read();
  start = await f.begin();
  await page.mouse.move(start.x + 236, start.y + 39, { steps: 4 });
  await expect(
    page.locator('[data-snap-axis="x"][data-snap-position="420"]'),
  ).toBeVisible();
  const external = await f.batch([
    {
      type: "setNodeMetadata",
      nodeId: f.id + "-b",
      name: "External edit while snapping",
    },
  ]);
  await expect(page.getByTestId("save-status")).toContainText(
    "ревизия " + external.revision,
  );
  await page.mouse.up();
  await expect(page.locator("[data-snap-axis]")).toHaveCount(0);
  expect((await f.read()).revision).toBe(before.revision + 1);
  expect((await f.currentPage()).nodes[0]).toEqual(original.nodes[0]);
  expect((await f.currentPage()).nodes[1].name).toBe(
    "External edit while snapping",
  );
});

test("a reflected, sheared and rotated parent preserves local geometry while its child snaps in world space", async ({
  page,
  studio: f,
}) => {
  const parent = frame(f.id + "-parent", 500, 140, 250, 230);
  parent.scene!.linearTransform = [-0.9, 0.35, 0.3, 1.1];
  await f.batch([
    { type: "insertNode", pageId: f.id, index: 3, node: parent },
    {
      type: "setNodeMetadata",
      nodeId: f.id + "-a",
      scene: { x: 40, y: 40, width: 100, height: 60 },
    },
    {
      type: "moveNode",
      nodeId: f.id + "-a",
      pageId: f.id,
      parentId: parent.id,
      slot: "content",
      index: 0,
    },
    {
      type: "addGuide",
      pageId: f.id,
      guide: { id: f.id + "-affine-guide", axis: "x", position: 650 },
    },
  ]);
  await f.open();
  const original = await f.currentPage();
  const revision = (await f.read()).revision;
  const originalBox = (await f.node().boundingBox())!;
  // Analytic world AABB: M * [40,40] gives (476,198), rightmost corner x=494.
  const start = await f.begin();
  await page.mouse.move(start.x + 152, start.y + 39, { steps: 4 });
  await expect(
    page.locator('[data-snap-axis="x"][data-snap-position="650"]'),
  ).toBeVisible();
  // Chromium quantizes transformed DOM bounds to 1/64 CSS px. The saved
  // inverse-matrix coordinates below remain checked independently to 7 digits.
  await expect
    .poll(async () =>
      Math.abs((await f.node().boundingBox())!.x - (originalBox.x + 156)),
    )
    .toBeLessThanOrEqual(1 / 64 + 1e-6);
  expect((await f.read()).revision).toBe(revision);
  await page.mouse.up();
  await expect.poll(async () => (await f.read()).revision).toBe(revision + 1);
  const moved = (await f.currentPage()).nodes.find(
    (item) => item.id === parent.id,
  )!;
  expect(moved.scene).toEqual(parent.scene);
  const child = moved.slots.content[0].scene!;
  const determinant = -0.9 * 1.1 - 0.35 * 0.3;
  expect(child.x).toBeCloseTo(40 + (1.1 * 156 - 0.3 * 39) / determinant, 7);
  expect(child.y).toBeCloseTo(40 + (-0.35 * 156 - 0.9 * 39) / determinant, 7);
  expect(child.width).toBe(100);
  expect(child.height).toBe(60);
  await f.undo();
  expect(await f.currentPage()).toEqual(original);
});

test("numeric guides create, move, lock and delete through canonical operations and survive reload/Undo", async ({
  page,
  studio: f,
}) => {
  await f.open();
  await page.getByRole("button", { name: "Направляющие", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Направляющие страницы",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const revision = (await f.read()).revision;
  await selectStudioOption(page, "Ось направляющей", "Горизонтальная (Y)");
  await dialog
    .getByLabel("Позиция направляющей", { exact: true })
    .fill("-125.5");
  await dialog
    .getByRole("button", { name: "Создать направляющую", exact: true })
    .click();
  await expect.poll(async () => (await f.read()).revision).toBe(revision + 1);
  let guide = (await f.currentPage()).guides![0];
  expect(guide).toMatchObject({ axis: "y", position: -125.5 });
  expect(guide.id.length).toBeGreaterThan(0);
  const row = dialog.locator(`[data-guide-row="${guide.id}"]`);
  const position = row.getByRole("textbox", {
    name: "Позиция направляющей 1",
    exact: true,
  });
  await position.fill("222.75");
  await dialog
    .getByRole("button", { name: "Сохранить позицию", exact: true })
    .click();
  await expect
    .poll(async () => (await f.currentPage()).guides![0].position)
    .toBe(222.75);
  expect((await f.read()).revision).toBe(revision + 2);
  await row
    .getByRole("button", { name: "Заблокировать направляющую 1", exact: true })
    .click();
  await expect
    .poll(async () => (await f.currentPage()).guides![0].locked)
    .toBe(true);
  await expect(position).toHaveAttribute("readonly", "");
  await expect(
    row.getByRole("button", { name: "Удалить направляющую 1", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Закрыть направляющие", exact: true })
    .click();
  await page.reload();
  await f.open();
  guide = (await f.currentPage()).guides![0];
  expect(guide).toMatchObject({ axis: "y", position: 222.75, locked: true });
  await page.getByRole("button", { name: "Направляющие", exact: true }).click();
  await row
    .getByRole("button", { name: "Разблокировать направляющую 1", exact: true })
    .click();
  await expect
    .poll(async () => (await f.currentPage()).guides![0].locked)
    .toBe(false);
  await row
    .getByRole("button", { name: "Удалить направляющую 1", exact: true })
    .click();
  await expect.poll(async () => (await f.currentPage()).guides!.length).toBe(0);
  expect((await f.read()).revision).toBe(revision + 5);
  await dialog
    .getByRole("button", { name: "Закрыть направляющие", exact: true })
    .click();
  await f.undo();
  expect((await f.currentPage()).guides).toEqual([{ ...guide, locked: false }]);
});

test("guide numeric drafts preserve incomplete input and reject an external revision without rebasing", async ({
  page,
  studio: f,
}) => {
  await f.open();
  await page.getByRole("button", { name: "Направляющие", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Направляющие страницы",
    exact: true,
  });
  const input = dialog.getByLabel("Позиция направляющей", { exact: true });
  const create = dialog.getByRole("button", {
    name: "Создать направляющую",
    exact: true,
  });
  const original = await f.read();
  for (const raw of ["-", "1e"]) {
    await input.fill(raw);
    await input.press("Tab");
    await expect(input).toHaveValue(raw);
    await expect(create).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Закрыть направляющие", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(input).toHaveValue(raw);
    expect(await f.read()).toEqual(original);
  }
  await input.fill("456.75");
  const updated = await f.batch([
    {
      type: "setNodeMetadata",
      nodeId: f.id + "-b",
      name: "External guide conflict",
    },
  ]);
  await expect(dialog.getByRole("status")).toContainText(
    "Страница изменилась. Ввод сохранён.",
  );
  await expect(input).toHaveValue("456.75");
  await expect(create).toBeDisabled();
  await input.press("Enter");
  expect((await f.read()).revision).toBe(updated.revision);
  expect((await f.currentPage()).guides).toBeUndefined();
  await dialog
    .getByRole("button", { name: "Отменить ввод", exact: true })
    .click();
  await expect(input).toHaveValue("0");
  await input.fill("456.75");
  await create.click();
  await expect
    .poll(async () => (await f.read()).revision)
    .toBe(updated.revision + 1);
  expect((await f.currentPage()).guides![0].position).toBe(456.75);
});

test("deleting the source page preserves a guide draft until explicit discard", async ({
  page,
  studio: f,
}) => {
  await f.open();
  await page.getByRole("button", { name: "Направляющие", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Направляющие страницы",
    exact: true,
  });
  const input = dialog.getByLabel("Позиция направляющей", { exact: true });
  await input.fill("1e");
  // Unlock only the fixture's own reference; removePage respects protected descendants.
  await f.batch([
    { type: "setNodeMetadata", nodeId: f.id + "-target", locked: false },
    { type: "removePage", pageId: f.id },
  ]);
  await expect(dialog).toBeVisible();
  await expect(
    dialog
      .getByRole("status")
      .filter({ hasText: "Страница недоступна. Ввод сохранён." }),
  ).toBeVisible();
  await expect(input).toHaveValue("1e");
  await expect(
    dialog.getByRole("button", { name: "Создать направляющую", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Закрыть направляющие", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Отменить ввод", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Закрыть направляющие", exact: true })
    .click();
  expect((await f.read()).pages.some((item) => item.screenId === f.id)).toBe(
    false,
  );
});

test("ruler dragging creates world guides once, Escape cancels, and keyboard exposes numeric coordinates", async ({
  page,
  studio: f,
}) => {
  await f.open();
  const rulers = page.getByRole("button", { name: "Линейки", exact: true });
  if ((await rulers.getAttribute("aria-pressed")) !== "true")
    await rulers.click();
  await f.ready();
  const original = await f.read();
  const view = await f.view();
  const canvasBox = (await f.canvas.boundingBox())!;
  const horizontal = page.getByRole("button", {
    name: "Горизонтальная линейка",
    exact: true,
  });
  const box = (await horizontal.boundingBox())!;
  expect(box.height).toBe(24);
  const verticalBox = (await page
    .getByRole("button", { name: "Вертикальная линейка", exact: true })
    .boundingBox())!;
  expect(verticalBox.width).toBe(24);
  const cornerBox = (await page
    .getByRole("button", { name: "Управление направляющими", exact: true })
    .boundingBox())!;
  expect(cornerBox.width).toBe(24);
  expect(cornerBox.height).toBe(24);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const endpoint = { x: start.x, y: canvasBox.y + view.panY + 200 * view.zoom };
  await f.begin(start);
  await page.mouse.move(endpoint.x, endpoint.y, { steps: 4 });
  expect(await f.read()).toEqual(original);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await f.read()).toEqual(original);
  await f.begin(start);
  await page.mouse.move(endpoint.x, endpoint.y, { steps: 4 });
  expect(await f.read()).toEqual(original);
  await page.mouse.up();
  await expect
    .poll(async () => (await f.read()).revision)
    .toBe(original.revision + 1);
  const guide = (await f.currentPage()).guides![0];
  expect(guide.axis).toBe("y");
  expect(guide.position).toBeCloseTo(200, 3);
  await page
    .getByRole("button", { name: "Вертикальная линейка", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Направляющие страницы",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Ось направляющей", exact: true }),
  ).toContainText("Вертикальная (X)");
  await dialog
    .getByLabel("Позиция направляющей", { exact: true })
    .fill("-36.25");
  await dialog
    .getByRole("button", { name: "Создать направляющую", exact: true })
    .click();
  await expect.poll(async () => (await f.currentPage()).guides!.length).toBe(2);
  expect((await f.currentPage()).guides![1]).toMatchObject({
    axis: "x",
    position: -36.25,
  });
  expect((await f.read()).revision).toBe(original.revision + 2);
});

test("an existing guide drag previews without writes, cancels with Escape/revision conflict and has one Undo", async ({
  page,
  studio: f,
}) => {
  const guideId = f.id + "-draggable-guide";
  await f.batch([
    {
      type: "addGuide",
      pageId: f.id,
      guide: { id: guideId, axis: "y", position: 200 },
    },
  ]);
  await f.open();
  const handle = page.locator(`[data-guide-id="${guideId}"]`);
  await expect(handle).toBeVisible();
  const original = await f.currentPage();
  const before = await f.read();
  const handleBox = (await handle.boundingBox())!;
  const point = {
    x: handleBox.x + handleBox.width - 50,
    y: handleBox.y + handleBox.height / 2,
  };
  await f.begin(point);
  await page.mouse.move(point.x, point.y + 37, { steps: 4 });
  await expect
    .poll(async () => (await handle.boundingBox())!.y)
    .toBeCloseTo(handleBox.y + 37, 2);
  expect(await f.read()).toEqual(before);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect
    .poll(async () => (await handle.boundingBox())!.y)
    .toBeCloseTo(handleBox.y, 2);
  expect(await f.read()).toEqual(before);
  await f.begin(point);
  await page.mouse.move(point.x, point.y + 47, { steps: 4 });
  expect(await f.read()).toEqual(before);
  await page.mouse.up();
  await expect
    .poll(async () => (await f.read()).revision)
    .toBe(before.revision + 1);
  const movedGuides = (await f.currentPage()).guides!;
  expect(movedGuides).toHaveLength(1);
  expect(movedGuides[0]).toMatchObject({ id: guideId, axis: "y" });
  expect(Math.abs(movedGuides[0].position - 247)).toBeLessThanOrEqual(1e-8);
  expect((await f.currentPage()).nodes).toEqual(original.nodes);
  await f.undo();
  expect(await f.currentPage()).toEqual(original);
  const afterUndo = (await f.read()).revision;
  await f.begin(point);
  await page.mouse.move(point.x, point.y + 51, { steps: 4 });
  await expect
    .poll(async () => (await handle.boundingBox())!.y)
    .toBeCloseTo(handleBox.y + 51, 2);
  const updated = await f.batch([
    {
      type: "setNodeMetadata",
      nodeId: f.id + "-b",
      name: "External guide gesture conflict",
    },
  ]);
  await expect(page.getByTestId("save-status")).toContainText(
    "ревизия " + updated.revision,
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await handle.boundingBox())!.y)
    .toBeCloseTo(handleBox.y, 2);
  expect((await f.read()).revision).toBe(afterUndo + 1);
  expect((await f.currentPage()).guides).toEqual(original.guides);
});

test("rulers, guides and snapping preferences leave canonical geometry intact and stay out of preview/handoff", async ({
  page,
  studio: f,
}) => {
  await f.open();
  const original = await f.read();
  type Handoff = { supported: boolean; files: Record<string, string> };
  const beforeExport = await f.api<Handoff>("/api/handoff", {
    pageId: f.id,
    revision: original.revision,
  });
  expect(beforeExport.supported).toBe(true);
  const guideId = f.id + "-editor-only-guide";
  const updated = await f.batch([
    {
      type: "addGuide",
      pageId: f.id,
      guide: { id: guideId, axis: "x", position: 360 },
    },
  ]);
  await expect(page.getByTestId("save-status")).toContainText(
    "ревизия " + updated.revision,
  );
  await f.ready();
  await expect(page.locator(`[data-guide-id="${guideId}"]`)).toBeVisible();
  const documentFrame = page.frameLocator(`iframe[title="Холст ${f.id}"]`);
  await expect(
    documentFrame.locator(
      "[data-guide-id], [data-snap-axis], .canvas-rulers, .canvas-guide-overlay",
    ),
  ).toHaveCount(0);
  const afterExport = await f.api<Handoff>("/api/handoff", {
    pageId: f.id,
    revision: updated.revision,
  });
  expect(afterExport.supported).toBe(true);
  for (const file of [
    "Screen.tsx",
    "Runtime.tsx",
    "styles.css",
    "tokens.css",
  ]) {
    expect(afterExport.files[file]).toBe(beforeExport.files[file]);
    expect(afterExport.files[file]).not.toContain(guideId);
    expect(afterExport.files[file]).not.toMatch(
      /data-snap-axis|canvas-rulers|canvas-guide-overlay/,
    );
  }
  const guidePage = await f.currentPage();
  for (const name of ["Умные привязки", "Линейки"]) {
    const toggle = page.getByRole("button", { name, exact: true });
    const pressed = await toggle.getAttribute("aria-pressed");
    await toggle.click();
    await expect(toggle).toHaveAttribute(
      "aria-pressed",
      pressed === "true" ? "false" : "true",
    );
    expect((await f.read()).revision).toBe(updated.revision);
    expect(await f.currentPage()).toEqual(guidePage);
  }
  expect(guidePage.nodes).toEqual(
    original.pages.find((item) => item.screenId === f.id)!.nodes,
  );
  await page.getByLabel("Тема студии", { exact: true }).selectOption("dark");
  await page.getByLabel("Язык студии", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("button", { name: "Smart snapping", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rulers", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Guides", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Page guides", exact: true }),
  ).toBeVisible();
  expect((await f.read()).revision).toBe(updated.revision);
});

test("a pending guide proposal shows read-only before/after guides and rejection preserves the canonical document", async ({
  page,
  studio: f,
}) => {
  const existingId = f.id + "-existing-proposal-guide";
  const addedId = f.id + "-new-proposal-guide";
  await f.batch([
    {
      type: "addGuide",
      pageId: f.id,
      guide: { id: existingId, axis: "x", position: 120 },
    },
  ]);
  await f.open();
  const canonical = await f.read();
  const documentOverlaySelector =
    "[data-proposal-guide-overlay], [data-proposal-guide-axis], [data-guide-id], [data-snap-axis]";
  await expect(
    page
      .frameLocator(`iframe[title="Холст ${f.id}"]`)
      .locator(documentOverlaySelector),
  ).toHaveCount(0);
  type Handoff = { supported: boolean; files: Record<string, string> };
  const beforeExport = await f.api<Handoff>("/api/handoff", {
    pageId: f.id,
    revision: canonical.revision,
  });
  expect(beforeExport.supported).toBe(true);
  const description = "Guide proposal " + f.id;
  const proposal = await f.api<{ id: string; status: string }>(
    "/api/proposals",
    {
      description,
      batch: {
        requestId: randomUUID(),
        baseRevision: canonical.revision,
        author: "agent",
        operations: [
          {
            type: "moveGuide",
            pageId: f.id,
            guideId: existingId,
            position: 280,
          },
          {
            type: "addGuide",
            pageId: f.id,
            guide: { id: addedId, axis: "y", position: 205 },
          },
        ] satisfies Operation[],
      },
    },
  );
  expect(proposal.status).toBe("pending");
  expect(await f.read()).toEqual(canonical);
  await page
    .getByRole("button", { name: "Предложения агента", exact: true })
    .click();
  const card = page.locator(".proposal-card").filter({
    has: page.getByRole("heading", { name: description, exact: true }),
  });
  await expect(card.getByText("pending", { exact: true })).toBeVisible();
  await expect(
    card.getByText("Предварительный просмотр · проект пока не изменён", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(card.locator(".proposal-comparison iframe")).toHaveCount(2);
  const beforeFrame = card.frameLocator(`iframe[title="Сейчас · ${f.id}"]`);
  const afterFrame = card.frameLocator(
    `iframe[title="После принятия · ${f.id}"]`,
  );
  for (const preview of [beforeFrame, afterFrame]) {
    const overlay = preview.locator("[data-proposal-guide-overlay]");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS("pointer-events", "none");
    await expect(preview.locator("[data-guide-id]")).toHaveCount(0);
  }
  await expect(
    beforeFrame.locator(
      '[data-proposal-guide-axis="x"][data-proposal-guide-position="120"]',
    ),
  ).toHaveCount(1);
  await expect(beforeFrame.locator("[data-proposal-guide-axis]")).toHaveCount(
    1,
  );
  await expect(
    afterFrame.locator(
      '[data-proposal-guide-axis="x"][data-proposal-guide-position="280"]',
    ),
  ).toHaveCount(1);
  await expect(
    afterFrame.locator(
      '[data-proposal-guide-axis="y"][data-proposal-guide-position="205"]',
    ),
  ).toHaveCount(1);
  await expect(afterFrame.locator("[data-proposal-guide-axis]")).toHaveCount(2);
  const movedCells = card
    .locator(`[data-guide-change="${existingId}"]`)
    .getByRole("cell");
  await expect(movedCells).toHaveText([
    "X · 120px · Разблокирована",
    "X · 280px · Разблокирована",
  ]);
  const addedCells = card
    .locator(`[data-guide-change="${addedId}"]`)
    .getByRole("cell");
  await expect(addedCells).toHaveText([
    "Нет направляющей",
    "Y · 205px · Разблокирована",
  ]);
  // Reviewing or clicking either overlay must never apply its simulated operations.
  const afterBox = (await afterFrame
    .locator("[data-proposal-guide-overlay]")
    .boundingBox())!;
  await page.mouse.click(afterBox.x + 280, afterBox.y + 205);
  expect(await f.read()).toEqual(canonical);
  const pendingExport = await f.api<Handoff>("/api/handoff", {
    pageId: f.id,
    revision: canonical.revision,
  });
  expect(pendingExport.files).toEqual(beforeExport.files);
  for (const file of ["Screen.tsx", "Runtime.tsx", "styles.css"]) {
    expect(pendingExport.files[file]).not.toMatch(
      /data-proposal-guide|data-guide-change/,
    );
    expect(pendingExport.files[file]).not.toContain(addedId);
    expect(pendingExport.files[file]).not.toContain(existingId);
  }
  await card.getByRole("button", { name: "Отклонить", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await f.api<{ status: string }>("/api/proposals/" + proposal.id))
          .status,
    )
    .toBe("rejected");
  expect(await f.read()).toEqual(canonical);
  await page.reload();
  await f.open();
  await expect(
    page
      .frameLocator(`iframe[title="Холст ${f.id}"]`)
      .locator(documentOverlaySelector),
  ).toHaveCount(0);
  expect(await f.read()).toEqual(canonical);
});
