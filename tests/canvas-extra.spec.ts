import { cleanupCanvasPages } from "./canvas-cleanup";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProjectStore } from "../src/core/store";
import { parseProject } from "../src/core/project";
import { test, expect, type Page } from "@playwright/test";
import { selectStudioOption } from "./select-helpers";
import { translate } from "../src/studio/locales";
type Locale = "ru" | "en";
async function setup(
  page: Page,
  locale: Locale = "ru",
  theme = "light",
  url = "/",
  leftX = -200,
) {
  await page.setViewportSize({ width: 1700, height: 1500 });
  await page.addInitScript(
    ({ locale, theme }) => {
      localStorage.setItem("local-design-studio:locale", locale);
      localStorage.setItem("local-design-studio:interface-theme", theme);
      window.addEventListener("message", (e) => {
        if (e.data?.type === "studio-preview-render" && e.data.canvas)
          (window as any).__canvasInput = e.data;
      });
    },
    { locale, theme },
  );
  await page.goto(url);
  const state = await page.evaluate(async (leftX) => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "x-studio-ui-token": session.uiToken,
      "Content-Type": "application/json",
    };
    const project = await fetch("/api/project", { headers }).then((r) =>
      r.json(),
    );
    const screenId = "canvas-extra-" + crypto.randomUUID(),
      name = "Extra " + screenId;
    const node = (id: string, x: number) => ({
      id: screenId + id,
      type: "SceneFrame",
      name: id,
      props: {},
      slots: { content: [] },
      scene: {
        kind: "frame",
        x,
        y: 0,
        width: 320,
        height: 240,
        fill: "#e2e8f0",
      },
    });
    const left = node("-a", leftX),
      right = node("-b", leftX + 380);
    if (leftX === 20)
      (left.slots.content as any[]).push({
        id: screenId + "-search",
        name: "Search",
        type: "Search",
        props: { placeholder: "Canvas search" },
        slots: {},
        scene: { kind: "component", x: 20, y: 20, width: 270, height: 80 },
      });
    const result = await fetch("/api/operations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        baseRevision: project.revision,
        requestId: crypto.randomUUID(),
        operations: [
          {
            type: "addPage",
            page: {
              screenId,
              name,
              viewport: { width: 900, height: 700 },
              nodes: [left, right],
            },
          },
        ],
      }),
    });
    if (!result.ok) throw new Error(await result.text());
    return {
      headers,
      screenId,
      name,
      revision: (await result.json()).revision,
    };
  }, leftX);
  const t = (source: string) => translate(locale, source);
  await expect(page.getByTestId("save-status")).toContainText(
    String(state.revision),
  );
  await page.getByRole("button", { name: t("Экраны"), exact: true }).click();
  await selectStudioOption(page, t("Экран"), state.name);
  await page
    .getByRole("button", { name: t("Редактирование холста"), exact: true })
    .click();
  const canvas = page.getByRole("region", {
    name: t("Свободный холст"),
    exact: true,
  });
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const frame = page.frameLocator(
    `iframe[title="${t("Холст ")}${state.name}"]`,
  );
  await expect(
    frame.locator(`[data-node-id="${state.screenId}-a"]`),
  ).toBeVisible();
  // A visible node may still use the camera from before initial fit. Require
  // canonical measurements for the camera currently displayed before hit testing.
  await expect
    .poll(
      async () => {
        const context = await page.evaluate(
          async (headers) =>
            (await fetch("/api/context", { headers }).then((r) => r.json()))
              .context,
          state.headers,
        );
        const displayed = await canvas.evaluate((element) => ({
          zoom: Number(element.getAttribute("data-zoom")),
          panX: Number(element.getAttribute("data-pan-x")),
          panY: Number(element.getAttribute("data-pan-y")),
        }));
        const camera = context?.camera;
        if (
          context?.pageId !== state.screenId ||
          context.revision !== state.revision ||
          camera?.transient !== false ||
          camera.revision !== context.revision ||
          camera.view.zoom !== displayed.zoom ||
          camera.view.panX !== displayed.panX ||
          camera.view.panY !== displayed.panY
        )
          return false;
        for (const suffix of ["-a", "-b"]) {
          const id = state.screenId + suffix;
          const measured = context.bounds?.[id];
          const box = await frame
            .locator(`[data-node-id="${id}"]`)
            .boundingBox();
          if (
            !camera.bounds.some((bound: { id: string }) => bound.id === id) ||
            !measured ||
            !box ||
            !(["x", "y", "width", "height"] as const).every(
              (key) => Math.abs(box[key] - measured[key]) < 1,
            )
          )
            return false;
        }
        return true;
      },
      { timeout: 10000 },
    )
    .toBe(true);
  const read = () =>
    page.evaluate(
      async (headers) =>
        fetch("/api/project", { headers }).then((r) => r.json()),
      state.headers,
    );
  const view = () =>
    canvas.evaluate((e) => ({
      x: Number(e.getAttribute("data-pan-x")),
      y: Number(e.getAttribute("data-pan-y")),
      zoom: Number(e.getAttribute("data-zoom")),
    }));
  const center = async (id: string) => {
    const b = (await frame
      .locator(`[data-node-id="${state.screenId}${id}"]`)
      .boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height * 0.8 };
  };
  return { ...state, t, canvas, frame, read, view, center };
}
test("Edit intercepts actual studio component typing while Preview restores interaction", async ({
  page,
}) => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "studio-canvas-ui-"));
  const owner = await ProjectStore.open(root, {
    initialProject: parseProject({
      schemaVersion: 2,
      projectId: "canvas-studio-ui",
      name: "Canvas UI fixture",
      revision: 0,
      library: { id: "studio-ui", version: "1.0.0" },
      theme: "light",
      tokens: {},
      pages: [
        {
          screenId: "home",
          name: "Home",
          viewport: { width: 900, height: 700 },
          nodes: [],
        },
      ],
    }),
  });
  await owner.close();
  const child = spawn(
    process.execPath,
    [
      resolve("node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "5202",
      "--strictPort",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STUDIO_PROJECT: root,
        STUDIO_LIBRARY_ROOT: "",
        VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (v) => {
    output = (output + v).slice(-4000);
  });
  child.stderr?.on("data", (v) => {
    output = (output + v).slice(-4000);
  });
  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error(output);
          return fetch("http://127.0.0.1:5202/api/session")
            .then((r) => r.ok)
            .catch(() => false);
        },
        { timeout: 20000 },
      )
      .toBe(true);
    const s = await setup(page, "ru", "light", "http://127.0.0.1:5202/", 20),
      before = await s.read();
    const input = s.frame.locator("input[type=search]");
    const b = (await input.boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.keyboard.type("blocked");
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("selection")).toContainText(
      s.screenId + "-search",
    );
    await page
      .getByRole("button", { name: "Просмотр экрана", exact: true })
      .click();
    const preview = page.frameLocator(`iframe[title="Экран ${s.name}"]`),
      active = preview.locator("input[type=search]");
    await active.click();
    await page.keyboard.type("interactive");
    await expect(active).toHaveValue("interactive");
    expect(await s.read()).toEqual(before);
  } finally {
    await page.goto("about:blank").catch(() => {});
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((resolveStop, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Canvas fixture did not stop"));
        }, 10000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolveStop();
        });
        child.kill("SIGTERM");
      });
    await rm(root, { recursive: true, force: true });
  }
});
test("external revision cancels an in-flight drag without overwriting agent changes", async ({
  page,
}) => {
  const s = await setup(page);
  const start = await s.center("-b");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 20, { steps: 4 });
  await expect(page.getByTestId("selection")).toContainText(s.screenId + "-b");
  const changed = await page.evaluate(
    async ({ headers, id }) => {
      const current = await fetch("/api/project", { headers }).then((r) =>
        r.json(),
      );
      const response = await fetch("/api/operations", {
        method: "POST",
        headers,
        body: JSON.stringify({
          baseRevision: current.revision,
          requestId: crypto.randomUUID(),
          operations: [
            {
              type: "setNodeMetadata",
              nodeId: id,
              name: "Agent-owned revision",
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { headers: s.headers, id: s.screenId + "-b" },
  );
  await expect(page.getByTestId("save-status")).toContainText(
    String(changed.revision),
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Документ изменился. Перемещение отменено." }),
  ).toBeVisible();
  await page.mouse.up();
  expect(await s.read()).toEqual(changed);
});
test("dirty inspector blocks selection and drag but leaves camera usable", async ({
  page,
}) => {
  const s = await setup(page);
  let point = await s.center("-b");
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("selection")).toContainText(s.screenId + "-b");
  const input = page.getByRole("textbox", {
    name: "Название слоя",
    exact: true,
  });
  await input.fill("Pending input");
  const before = await s.read();
  point = await s.center("-a");
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("selection")).toContainText(s.screenId + "-b");
  await expect(input).toHaveValue("Pending input");
  await expect(
    page.getByRole("alert").filter({ hasText: "Есть несохранённый ввод." }),
  ).toBeVisible();
  const a = await s.view();
  await s.canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await s.view()).x).toBe(a.x - 40);
  expect(await s.read()).toEqual(before);
  await expect(input).toHaveValue("Pending input");
});
for (const locale of ["ru", "en"] as const)
  for (const theme of ["light", "dark"]) {
    test(`${locale}/${theme}: canvas keyboard pan, editable zoom and Shift toggle preserve project`, async ({
      page,
    }) => {
      const s = await setup(page, locale, theme);
      await expect(s.frame.locator("html")).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      await expect(s.canvas.locator("iframe")).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      const before = await s.read(),
        a = await s.view();
      await s.canvas.focus();
      await page.keyboard.press("ArrowDown");
      await expect.poll(async () => (await s.view()).y).toBe(a.y - 40);
      const zoom = page.getByRole("spinbutton", {
        name: s.t("Масштаб холста, проценты"),
        exact: true,
      });
      await zoom.fill("125");
      await zoom.press("Enter");
      await expect.poll(async () => (await s.view()).zoom).toBe(1.25);
      await page
        .getByRole("button", { name: s.t("Вместить всё"), exact: true })
        .click();
      const p = await s.center("-b");
      await page.mouse.click(p.x, p.y);
      await expect(page.getByTestId("selection")).toContainText(
        s.screenId + "-b",
      );
      await page.keyboard.down("Shift");
      await page.mouse.click(p.x, p.y);
      await page.keyboard.up("Shift");
      await expect(page.getByTestId("selection")).toContainText("—");
      expect(await s.read()).toEqual(before);
    });
  }
test("bridge drops forged source, origin, stale revision and foreign surface geometry", async ({
  page,
}) => {
  const s = await setup(page);
  const p = await s.center("-b");
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("selection")).toContainText(s.screenId + "-b");
  const frame = s.frame;
  const input = await frame
    .locator("body")
    .evaluate(() => (window as any).__canvasInput);
  expect(input.canvas.surfaceId).toBeTruthy();
  await expect
    .poll(() =>
      page.evaluate(async (headers) => {
        const data = await fetch("/api/context", { headers }).then((r) =>
          r.json(),
        );
        return data.context?.camera?.bounds?.length ?? 0;
      }, s.headers),
    )
    .toBeGreaterThan(0);
  const snapshot = await page.evaluate(
    async (headers) => fetch("/api/context", { headers }).then((r) => r.json()),
    s.headers,
  );
  const fake = {
    type: "studio-preview-geometry",
    epoch: input.canvas.epoch,
    revision: input.project.revision,
    surfaceId: input.canvas.surfaceId,
    bounds: [
      { id: s.screenId + "-b", x: 999999, y: 999999, width: 1, height: 1 },
    ],
  };
  await page.evaluate(
    (fake) => window.postMessage(fake, location.origin),
    fake,
  );
  await frame.locator("body").evaluate((_body, fake) => {
    parent.postMessage({ ...fake, epoch: fake.epoch - 1 }, location.origin);
    parent.postMessage(
      { ...fake, revision: fake.revision - 1 },
      location.origin,
    );
    parent.postMessage(
      { ...fake, surfaceId: "foreign-surface" },
      location.origin,
    );
    parent.dispatchEvent(
      new MessageEvent("message", {
        data: fake,
        origin: "https://foreign.invalid",
        source: window,
      }),
    );
  }, fake);
  await page.waitForTimeout(3700); // Context heartbeat must retain the last valid geometry.
  const next = await page.evaluate(
    async (headers) => fetch("/api/context", { headers }).then((r) => r.json()),
    s.headers,
  );
  expect(next.context.camera.bounds.every((b: any) => b.x !== 999999)).toBe(
    true,
  );
  expect(next.context.selectedIds).toEqual(snapshot.context.selectedIds);
  expect(next.context.revision).toBe(snapshot.context.revision);
});

test.afterEach(async ({ request }) =>
  cleanupCanvasPages(request, "canvas-extra-"),
);

test("removing a secondary selected layer leaves the surviving layer draggable", async ({
  page,
}) => {
  const s = await setup(page);
  const left = await s.center("-a"),
    right = await s.center("-b");
  await page.mouse.click(left.x, left.y);
  await expect(page.getByTestId("selection")).toContainText(s.screenId + "-a");
  await page.keyboard.down("Shift");
  await page.mouse.click(right.x, right.y);
  await page.keyboard.up("Shift");
  const changed = await page.evaluate(
    async ({ headers, id }) => {
      const project = await fetch("/api/project", { headers }).then((r) =>
        r.json(),
      );
      const result = await fetch("/api/operations", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          baseRevision: project.revision,
          operations: [{ type: "removeNode", nodeId: id }],
        }),
      });
      if (!result.ok) throw new Error(await result.text());
      return result.json();
    },
    { headers: s.headers, id: s.screenId + "-b" },
  );
  await expect(page.getByTestId("save-status")).toContainText(
    String(changed.revision),
  );
  const start = await s.center("-a"),
    zoom = (await s.view()).zoom;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 25, start.y + 15, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await s.read()).revision)
    .toBe(changed.revision + 1);
  const node = (await s.read()).pages.find(
    (p: any) => p.screenId === s.screenId,
  ).nodes[0];
  expect(node.scene.x).toBeCloseTo(-200 + 25 / zoom, 3);
});

test("cancelled drag cannot publish late geometry from its old render snapshot", async ({
  page,
}) => {
  test.setTimeout(25000);
  const s = await setup(page),
    before = await s.read();
  const start = await s.center("-b");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 20, { steps: 5 });
  await expect
    .poll(() =>
      s.frame
        .locator("body")
        .evaluate(
          () =>
            Object.keys((window as any).__canvasInput.canvas.geometry ?? {})
              .length,
        ),
    )
    .toBeGreaterThan(0);
  const input = await s.frame
    .locator("body")
    .evaluate(() => (window as any).__canvasInput);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect
    .poll(() =>
      s.frame
        .locator("body")
        .evaluate(() => (window as any).__canvasInput.canvas.epoch),
    )
    .toBeGreaterThan(input.canvas.epoch);
  await s.frame.locator("body").evaluate(
    (_body, input) =>
      parent.postMessage(
        {
          type: "studio-preview-geometry",
          surfaceId: input.canvas.surfaceId,
          epoch: input.canvas.epoch,
          revision: input.project.revision,
          bounds: [
            {
              id: input.nodes[1].id,
              x: 999999,
              y: 0,
              width: 320,
              height: 240,
            },
          ],
        },
        location.origin,
      ),
    input,
  );
  await expect
    .poll(
      () =>
        page.evaluate(async (headers) => {
          const data = await fetch("/api/context", { headers }).then((r) =>
            r.json(),
          );
          return (
            data.context?.camera?.transient === false &&
            data.context.camera.bounds.some(
              (b: any) => b.id.endsWith("-b") && Math.abs(b.x - 180) < 0.1,
            )
          );
        }, s.headers),
      { timeout: 10000 },
    )
    .toBe(true);
  expect(await s.read()).toEqual(before);
});

test("camera change cancels an unanswered pick so the wheel remains usable", async ({
  page,
}) => {
  const s = await setup(page),
    before = await s.read();
  await s.frame.locator("body").evaluate(() =>
    window.addEventListener(
      "message",
      (event) => {
        if (event.data?.type === "studio-preview-pick")
          event.stopImmediatePropagation();
      },
      true,
    ),
  );
  const p = await s.center("-b");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.keyboard.press("0");
  await expect.poll(async () => (await s.view()).zoom).toBe(1);
  await page.mouse.up();
  const pan = (await s.view()).x;
  await s.canvas.dispatchEvent("wheel", { deltaX: 45, deltaY: 0 });
  await expect.poll(async () => (await s.view()).x).toBeCloseTo(pan - 45);
  expect(await s.read()).toEqual(before);
});

test("Space and middle-button pan release cleanly without project operations", async ({
  page,
}) => {
  const s = await setup(page),
    before = await s.read();
  const box = (await s.canvas.boundingBox())!,
    p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await s.canvas.focus();
  const start = await s.view();
  await page.keyboard.down("Space");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 35, p.y + 25, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(async () => (await s.view()).x).toBeCloseTo(start.x + 35);
  await expect.poll(async () => (await s.view()).y).toBeCloseTo(start.y + 25);
  const middle = await s.view();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(p.x - 20, p.y - 15, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  await expect.poll(async () => (await s.view()).x).toBeCloseTo(middle.x - 20);
  await expect.poll(async () => (await s.view()).y).toBeCloseTo(middle.y - 15);
  await page.keyboard.down("Space");
  await page
    .getByRole("spinbutton", { name: "Масштаб холста, проценты", exact: true })
    .focus();
  await page.keyboard.up("Space");
  const last = await s.view();
  await s.canvas.dispatchEvent("wheel", { deltaX: 30, deltaY: 0 });
  await expect.poll(async () => (await s.view()).x).toBeCloseTo(last.x - 30);
  expect(await s.read()).toEqual(before);
});

test("nested drag uses world delta at changed zoom and pan under a rotated parent", async ({
  page,
}) => {
  const s = await setup(page),
    childId = s.screenId + "-nested";
  const changed = await page.evaluate(
    async ({ headers, parentId, pageId, childId }) => {
      const p = await fetch("/api/project", { headers }).then((r) => r.json());
      const r = await fetch("/api/operations", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          baseRevision: p.revision,
          operations: [
            {
              type: "setNodeMetadata",
              nodeId: parentId,
              scene: { rotation: 30 },
            },
            {
              type: "insertNode",
              pageId,
              parentId,
              slot: "content",
              index: 0,
              node: {
                id: childId,
                name: "Nested",
                type: "SceneFrame",
                props: {},
                slots: {},
                scene: {
                  kind: "frame",
                  x: 40,
                  y: 30,
                  width: 80,
                  height: 60,
                  rotation: 15,
                  fill: "#315ad8",
                },
              },
            },
          ],
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    {
      headers: s.headers,
      parentId: s.screenId + "-a",
      pageId: s.screenId,
      childId,
    },
  );
  await expect(page.getByTestId("save-status")).toContainText(
    String(changed.revision),
  );
  await page
    .getByRole("button", { name: "Выделить " + childId, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Вместить выделение", exact: true })
    .click();
  const initial = await s.view();
  await s.canvas.dispatchEvent("wheel", { deltaX: 60, deltaY: 20 });
  await expect.poll(async () => (await s.view()).x).toBeCloseTo(initial.x - 60);
  const node = s.frame.locator(`[data-node-id="${childId}"]`);
  const b = (await node.boundingBox())!,
    start = { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    zoom = (await s.view()).zoom;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 25, start.y + 15, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await s.read()).revision)
    .toBe(changed.revision + 1);
  const parent = (await s.read()).pages.find(
      (p: any) => p.screenId === s.screenId,
    ).nodes[0],
    scene = parent.slots.content[0].scene;
  const dx = 25 / zoom,
    dy = 15 / zoom,
    c = Math.cos(Math.PI / 6),
    sn = Math.sin(Math.PI / 6);
  expect(scene.x).toBeCloseTo(40 + c * dx + sn * dy, 3);
  expect(scene.y).toBeCloseTo(30 - sn * dx + c * dy, 3);
  expect(parent.scene.rotation).toBe(30);
});

test("click-only selection keeps the render epoch stable for the following Shift click", async ({
  page,
}) => {
  const s = await setup(page);
  const p = await s.center("-b");
  const epoch = () =>
    s.frame
      .locator("body")
      .evaluate(() => (window as any).__canvasInput.canvas.epoch);
  // Wait for the current complete snapshot, then an ordinary click must only
  // change selection. It has no transient position to reset or re-render.
  const before = await epoch();
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("selection")).toContainText(s.screenId + "-b");
  await page.evaluate(
    () =>
      new Promise<void>((ok) =>
        requestAnimationFrame(() => requestAnimationFrame(() => ok())),
      ),
  );
  expect(await epoch()).toBe(before);
  await page.keyboard.down("Shift");
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection")).toContainText("—");
  expect(await epoch()).toBe(before);
});
