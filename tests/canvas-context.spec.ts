import { test, expect, type Page } from "@playwright/test";
import { selectStudioOption } from "./select-helpers";
let ownedPageId: string;
let originalPageIds: string[];
test.beforeEach(async ({ request }) => {
  ownedPageId = "canvas-context-" + crypto.randomUUID();
  const sessionResponse = await request.get("/api/session");
  const session = await sessionResponse.json();
  const response = await request.get("/api/project", {
    headers: {
      Origin: new URL(sessionResponse.url()).origin,
      Authorization: `Bearer ${session.token}`,
      "x-studio-ui-token": session.uiToken,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  originalPageIds = (await response.json()).pages.map(
    (page: { screenId: string }) => page.screenId,
  );
});
async function setup(page: Page, locked = false) {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/");
  const state = await page.evaluate(
    async ({ locked, screenId }) => {
      const session = await fetch("/api/session").then((r) => r.json());
      const headers = {
        Authorization: `Bearer ${session.token}`,
        "x-studio-ui-token": session.uiToken,
        "Content-Type": "application/json",
      };
      const project = await fetch("/api/project", { headers }).then((r) =>
        r.json(),
      );
      const name = "Canvas " + screenId;
      const nodes = [
        {
          id: screenId + "-a",
          name: "Left",
          locked,
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
    },
    { locked, screenId: ownedPageId },
  );
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
  await expect
    .poll(() => canvas.getAttribute("data-zoom"), { timeout: 10000 })
    .not.toBe("1");
  const read = () =>
    page.evaluate(
      async (headers) =>
        fetch("/api/project", { headers }).then((r) => r.json()),
      state.headers,
    );
  return { ...state, canvas, read };
}
test("pending picks and moved geometry never publish canonical editor bounds; cancel waits for a fresh epoch", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    (window as any).__contextEvents = [];
    const original = window.fetch;
    window.fetch = function (input, init) {
      if (String(input).endsWith("/api/context") && init?.method === "POST")
        (window as any).__contextEvents.push(JSON.parse(String(init.body)));
      return original.call(this, input, init);
    };
    window.addEventListener(
      "message",
      (event) => {
        if (
          (window as any).__holdGeometry &&
          event.isTrusted &&
          event.data?.type === "studio-preview-geometry"
        ) {
          (window as any).__heldGeometry = event.data;
          event.stopImmediatePropagation();
        }
      },
      true,
    );
  });
  const { canvas, screenId, name, read, revision } = await setup(page);
  const events = () =>
    page.evaluate(
      (id) =>
        (window as any).__contextEvents.filter((e: any) => e.pageId === id),
      screenId,
    );
  await expect
    .poll(async () => (await events()).at(-1)?.bounds[screenId + "-a"])
    .toBeTruthy();
  const frame = page.frameLocator(`iframe[title="Холст ${name}"]`);
  const box = (await frame
    .locator(`[data-node-id="${screenId}-a"]`)
    .boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const count = (await events()).length;
  await page.mouse.down();
  // This must be published on pointerdown, before movement or a 3.5s poll.
  await expect
    .poll(
      async () =>
        (await events()).slice(count).find((e: any) => e.camera?.transient),
      { timeout: 1200 },
    )
    .toBeTruthy();
  const pending = (await events()).at(-1);
  expect(pending.bounds).toEqual({});
  expect(pending.camera.bounds).toEqual([]);
  await page.mouse.move(
    box.x + box.width / 2 + 40,
    box.y + box.height / 2 + 20,
    { steps: 3 },
  );
  await expect
    .poll(async () =>
      frame
        .locator(`[data-node-id="${screenId}-a"]`)
        .evaluate((e) => e.getAttribute("style")),
    )
    .toContain("left:");
  expect((await events()).at(-1).bounds).toEqual({});
  expect((await events()).at(-1).camera.bounds).toEqual([]);
  // Block the replacement canonical epoch, and retain the old transient message.
  await page.evaluate(() => {
    (window as any).__holdGeometry = true;
  });
  await page.mouse.move(
    box.x + box.width / 2 + 45,
    box.y + box.height / 2 + 20,
  );
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__heldGeometry))
    .toBe(true);
  await page.evaluate(() => {
    (window as any).__oldGeometry = (window as any).__heldGeometry;
  });
  const oldEpoch = await page.evaluate(
    () => (window as any).__heldGeometry.epoch,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect
    .poll(async () => (await events()).at(-1)?.camera?.transient)
    .toBe(false);
  expect((await events()).at(-1).bounds).toEqual({});
  expect((await read()).revision).toBe(revision);
  await expect
    .poll(() => page.evaluate(() => (window as any).__heldGeometry.epoch))
    .toBeGreaterThan(oldEpoch);
  await page.evaluate(async () => {
    const iframe = document.querySelector(
      ".canvas-surface iframe",
    ) as HTMLIFrameElement;
    dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        origin: location.origin,
        data: (window as any).__oldGeometry,
      }),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  expect((await events()).at(-1).bounds).toEqual({});
  await page.evaluate(() => {
    (window as any).__holdGeometry = false;
    const iframe = document.querySelector(
      ".canvas-surface iframe",
    ) as HTMLIFrameElement;
    dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        origin: location.origin,
        data: (window as any).__heldGeometry,
      }),
    );
  });
  await expect
    .poll(async () => (await events()).at(-1)?.bounds[screenId + "-a"])
    .toBeTruthy();
  expect((await read()).revision).toBe(revision);
  expect(Number(await canvas.getAttribute("data-zoom"))).toBeGreaterThan(0);
});
test("a blocked nonpan gesture still withholds bounds, while pan keeps camera context available", async ({
  page,
}) => {
  const { canvas, screenId, name, revision, read, headers } = await setup(
    page,
    true,
  );
  const context = () =>
    page.evaluate(
      async (headers) =>
        (await (await fetch("/api/context", { headers })).json()).context,
      headers,
    );
  await expect
    .poll(async () => (await context())?.bounds[screenId + "-a"])
    .toBeTruthy();
  const box = (await page
    .frameLocator(`iframe[title="Холст ${name}"]`)
    .locator(`[data-node-id="${screenId}-a"]`)
    .boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 30,
    box.y + box.height / 2 + 15,
  );
  await expect(page.getByRole("alert")).toContainText(
    "Этот слой нельзя переместить на холсте.",
  );
  const blocked = await context();
  expect(blocked.camera.transient).toBe(true);
  expect(blocked.bounds).toEqual({});
  expect(blocked.camera.bounds).toEqual([]);
  await page.mouse.up();
  await expect
    .poll(async () => (await context())?.camera?.transient)
    .toBe(false);
  const beforePan = (await context()).camera.view.panX;
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 15,
  );
  await expect
    .poll(async () => (await context())?.camera?.view.panX)
    .not.toBe(beforePan);
  expect((await context()).camera.transient).toBe(false);
  await page.mouse.up({ button: "middle" });
  expect((await read()).revision).toBe(revision);
  expect(Number(await canvas.getAttribute("data-zoom"))).toBeGreaterThan(0);
});
test.afterEach(async ({ request }) => {
  const sessionResponse = await request.get("/api/session");
  const session = await sessionResponse.json();
  const headers = {
    Origin: new URL(sessionResponse.url()).origin,
    Authorization: `Bearer ${session.token}`,
    "x-studio-ui-token": session.uiToken,
  };
  const project = await (await request.get("/api/project", { headers })).json();
  const operations = project.pages
    .filter((p: any) => p.screenId === ownedPageId)
    .flatMap((p: any) =>
      p.nodes
        .filter((n: any) => n.locked)
        .map((n: any) => ({
          type: "setNodeMetadata",
          nodeId: n.id,
          locked: false,
        })),
    );
  if (operations.length) {
    const response = await request.post("/api/operations", {
      headers,
      data: {
        requestId: crypto.randomUUID(),
        baseRevision: project.revision,
        operations,
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  const latest = await (await request.get("/api/project", { headers })).json();
  if (
    latest.pages.some(
      (page: { screenId: string }) => page.screenId === ownedPageId,
    )
  ) {
    const response = await request.post("/api/operations", {
      headers,
      data: {
        requestId: crypto.randomUUID(),
        baseRevision: latest.revision,
        operations: [{ type: "removePage", pageId: ownedPageId }],
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  const restored = await (
    await request.get("/api/project", { headers })
  ).json();
  expect(
    restored.pages.map((page: { screenId: string }) => page.screenId),
  ).toEqual(originalPageIds);
});
