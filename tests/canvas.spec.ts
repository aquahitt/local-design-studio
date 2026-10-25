import { cleanupCanvasPages } from "./canvas-cleanup";
import { test, expect, type Page } from "@playwright/test";
import { selectStudioOption } from "./select-helpers";
async function waitForCanvasGeometry(
  page: Page,
  canvas: ReturnType<Page["getByRole"]>,
  node: ReturnType<ReturnType<Page["frameLocator"]>["locator"]>,
  headers: Record<string, string>,
  nodeId: string,
) {
  await expect
    .poll(async () => {
      const { context, revision } = await page.evaluate(async (headers) => {
        const [context, project] = await Promise.all([
          fetch("/api/context", { headers }).then((r) => r.json()),
          fetch("/api/project", { headers }).then((r) => r.json()),
        ]);
        return { context: context.context, revision: project.revision };
      }, headers);
      const view = await canvas.evaluate((element) => ({
        zoom: Number(element.getAttribute("data-zoom")),
        panX: Number(element.getAttribute("data-pan-x")),
        panY: Number(element.getAttribute("data-pan-y")),
      }));
      const camera = context?.camera,
        measured = context?.bounds?.[nodeId];
      const box = await node.boundingBox();
      return (
        context?.revision === revision &&
        camera?.revision === revision &&
        camera.transient === false &&
        camera.view.zoom === view.zoom &&
        camera.view.panX === view.panX &&
        camera.view.panY === view.panY &&
        camera.bounds.some((bound: { id: string }) => bound.id === nodeId) &&
        !!measured &&
        !!box &&
        (["x", "y", "width", "height"] as const).every(
          (key) => Math.abs(measured[key] - box[key]) < 1,
        )
      );
    })
    .toBe(true);
}
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
  const { canvas, read, screenId, revision, name, headers } = await setup(page);
  const frame = page.frameLocator(`iframe[title="Холст ${name}"]`);
  const node = frame.locator(`[data-node-id="${screenId}-a"]`);
  const p = async () => {
    await waitForCanvasGeometry(page, canvas, node, headers, screenId + "-a");
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
  await waitForCanvasGeometry(page, canvas, node, headers, screenId + "-a");
  await page.keyboard.down("Shift");
  await page.mouse.click(click.x, click.y);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection")).toContainText("—");
  expect(await read()).toEqual(before);
});

test("rapid selected-layer clicks apply the latest held reply and ignore an older reply", async ({
  page,
}) => {
  const { canvas, read, screenId, name, headers } = await setup(page);
  const nodeId = screenId + "-a";
  const node = page
    .frameLocator(`iframe[title="Холст ${name}"]`)
    .locator(`[data-node-id="${nodeId}"]`);
  await page
    .getByRole("button", { name: "Выделить " + nodeId, exact: true })
    .click();
  await expect(page.getByTestId("selection")).toContainText(nodeId);
  await waitForCanvasGeometry(page, canvas, node, headers, nodeId);
  const before = await read();
  await page.evaluate(() => {
    const w = window as any;
    w.__heldPicks = [];
    const iframe = document.querySelector(
      ".canvas-surface iframe",
    ) as HTMLIFrameElement;
    const hold = (event: MessageEvent) => {
      if (
        event.isTrusted &&
        event.origin === location.origin &&
        event.source === iframe.contentWindow &&
        event.data?.type === "studio-preview-picked"
      ) {
        w.__heldPicks.push({
          data: event.data,
          source: event.source,
          origin: event.origin,
        });
        event.stopImmediatePropagation();
      }
    };
    addEventListener("message", hold, true);
    w.__stopHoldingPicks = () => removeEventListener("message", hold, true);
  });
  const box = (await node.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => page.evaluate(() => (window as any).__heldPicks.length))
    .toBe(1);
  await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Shift");
  await expect
    .poll(() => page.evaluate(() => (window as any).__heldPicks.length))
    .toBe(2);
  const replies = await page.evaluate(() =>
    (window as any).__heldPicks.map((reply: any) => reply.data),
  );
  expect(replies[1].requestId).toBeGreaterThan(replies[0].requestId);
  expect(replies[1].epoch).toBe(replies[0].epoch);
  expect(replies.map((reply: any) => reply.id)).toEqual([nodeId, nodeId]);
  await page.evaluate(() => {
    const w = window as any;
    w.__stopHoldingPicks();
    dispatchEvent(new MessageEvent("message", w.__heldPicks[1]));
  });
  await expect(page.getByTestId("selection")).toContainText("—");
  await page.evaluate(async () => {
    dispatchEvent(new MessageEvent("message", (window as any).__heldPicks[0]));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(page.getByTestId("selection")).toContainText("—");
  expect(await read()).toEqual(before);
});

test.afterEach(async ({ request }) => cleanupCanvasPages(request, "canvas-"));
