import { cleanupCanvasPages } from "./canvas-cleanup";
import { test, expect, type Page } from "@playwright/test";
import { selectStudioOption } from "./select-helpers";
async function setup(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/");
  const state = await page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "x-studio-ui-token": session.uiToken,
      "Content-Type": "application/json",
    };
    const project = await fetch("/api/project", { headers }).then((r) =>
      r.json(),
    );
    const screenId = "canvas-" + crypto.randomUUID();
    const name = "Canvas " + screenId;
    const nodes = [
      {
        id: screenId + "-a",
        name: "Left",
        type: "SceneFrame",
        props: {},
        slots: { content: [] },
        scene: {
          kind: "frame",
          x: -500,
          y: -200,
          width: 300,
          height: 200,
          fill: "#ef4444",
        },
      },
      {
        id: screenId + "-b",
        name: "Right",
        type: "SceneFrame",
        props: {},
        slots: { content: [] },
        scene: {
          kind: "frame",
          x: 900,
          y: 400,
          width: 250,
          height: 180,
          fill: "#22c55e",
        },
      },
    ];
    const r = await fetch("/api/operations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: project.revision,
        operations: [
          {
            type: "addPage",
            page: {
              screenId,
              name,
              viewport: { width: 800, height: 700 },
              nodes,
            },
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    return { headers, screenId, name, revision: (await r.json()).revision };
  });
  await expect(page.getByTestId("save-status")).toContainText(
    "ревизия " + state.revision,
  );
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", state.name);
  await page
    .getByRole("button", { name: "Редактирование холста", exact: true })
    .click();
  const canvas = page.getByRole("region", {
    name: "Свободный холст",
    exact: true,
  });
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  await expect.poll(() => canvas.getAttribute("data-zoom")).not.toBe("1");
  const read = () =>
    page.evaluate(
      async (headers) =>
        fetch("/api/project", { headers }).then((r) => r.json()),
      state.headers,
    );
  return { ...state, canvas, read };
}
test("camera pans, zooms around cursor, fits negative frames and restores without project writes", async ({
  page,
}, testInfo) => {
  const { canvas, read, revision, name } = await setup(page);
  const before = await read();
  await page.screenshot({
    path: testInfo.outputPath("canvas-ru-light.png"),
    fullPage: true,
  });
  const box = (await canvas.boundingBox())!;
  const view = async () =>
    canvas.evaluate((e) => ({
      zoom: Number(e.getAttribute("data-zoom")),
      panX: Number(e.getAttribute("data-pan-x")),
      panY: Number(e.getAttribute("data-pan-y")),
    }));
  const a = await view();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(100, 80);
  await expect.poll(async () => (await view()).panX).toBeCloseTo(a.panX - 100);
  const p = {
      x: Math.round(box.x + box.width * 0.6) - box.x,
      y: Math.round(box.y + box.height * 0.4) - box.y,
    },
    b = await view();
  await canvas.dispatchEvent("wheel", {
    clientX: box.x + p.x,
    clientY: box.y + p.y,
    deltaY: -100,
    ctrlKey: true,
  });
  await expect.poll(async () => (await view()).zoom).toBeGreaterThan(b.zoom);
  const c = await view();
  expect((p.x - c.panX) / c.zoom).toBeCloseTo((p.x - b.panX) / b.zoom, 3);
  expect((p.y - c.panY) / c.zoom).toBeCloseTo((p.y - b.panY) / b.zoom, 3);
  expect(await read()).toEqual(before);
  await page.reload();
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", name);
  await expect(canvas).toBeVisible();
  await expect.poll(view).toEqual(c);
  expect((await read()).revision).toBe(revision);
  await canvas.focus();
  await page.keyboard.press("Shift+1");
  await expect.poll(async () => (await view()).panX).not.toBe(c.panX);
  expect(await read()).toEqual(before);
});
test("scene drag commits once, undo restores, Shift toggles and Escape cancels", async ({
  page,
}) => {
  const { canvas, read, screenId, revision, name } = await setup(page);
  const frame = page.frameLocator(`iframe[title="Холст ${name}"]`);
  const node = frame.locator(`[data-node-id="${screenId}-a"]`);
  const p = async () => {
    const b = (await node.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const start = await p();
  const zoom = Number(await canvas.getAttribute("data-zoom"));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).revision).toBe(revision + 1);
  const moved = (await read()).pages.find((p: any) => p.screenId === screenId)
    .nodes[0];
  expect(moved.scene.x).toBeCloseTo(-500 + 30 / zoom, 3);
  expect(moved.scene.y).toBeCloseTo(-200 + 20 / zoom, 3);
  const saved = await read();
  await page.reload();
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", name);
  await expect(canvas).toBeVisible();
  await expect(node).toBeVisible();
  expect(await read()).toEqual(saved);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await read()).pages.find((p: any) => p.screenId === screenId).nodes[0]
          .scene.x,
    )
    .toBe(-500);
  const before = await read();
  const again = await p();
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await page.mouse.move(again.x + 35, again.y + 25, { steps: 3 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await read()).toEqual(before);
  await expect.poll(async () => (await p()).x).toBeCloseTo(again.x, 2);
  const click = await p();
  await page.mouse.click(click.x, click.y);
  await expect(page.getByTestId("selection")).toContainText(screenId + "-a");
  await page.keyboard.down("Shift");
  await page.mouse.click(click.x, click.y);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection")).toContainText("—");
  expect(await read()).toEqual(before);
});

test.afterEach(async ({ request }) => cleanupCanvasPages(request, "canvas-"));
