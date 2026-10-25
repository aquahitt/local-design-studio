import { expect, test, type Page } from "@playwright/test";
import { selectStudioOption } from "./select-helpers";

async function setup(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/");
  const fixture = await page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "x-studio-ui-token": session.uiToken,
      "Content-Type": "application/json",
    };
    const before = await fetch("/api/project", { headers }).then((r) =>
      r.json(),
    );
    const id = "pointer-transform-" + crypto.randomUUID();
    const response = await fetch("/api/operations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: before.revision,
        operations: [
          {
            type: "addPage",
            page: {
              screenId: id,
              name: id,
              viewport: { width: 800, height: 600 },
              nodes: [
                {
                  id: id + "-root",
                  type: "SceneFrame",
                  props: {},
                  scene: {
                    kind: "frame",
                    x: 100,
                    y: 80,
                    width: 200,
                    height: 120,
                    fill: "#dddddd",
                  },
                  slots: {
                    content: [
                      {
                        id: id + "-text",
                        type: "SceneText",
                        props: { text: "Pointer transform" },
                        slots: {},
                        scene: {
                          kind: "text",
                          x: 10,
                          y: 10,
                          width: 160,
                          height: 60,
                          fontSize: 20,
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return {
      id,
      headers,
      origin: location.origin,
      revision: (await response.json()).revision,
      beforeIds: before.pages.map((p: { screenId: string }) => p.screenId),
    };
  });
  const headers = {
    ...fixture.headers,
    Origin: fixture.origin,
    Connection: "close",
  };
  const read = () =>
    fetch(fixture.origin + "/api/project", { headers }).then((r) => r.json());
  const batch = async (operations: unknown[]) => {
    const p = await read();
    const response = await fetch(fixture.origin + "/api/operations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: p.revision,
        operations,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  const cleanup = async () => {
    const current = await read();
    const own = current.pages.find((p: any) => p.screenId === fixture.id);
    if (own) {
      const unlock: unknown[] = [];
      const walk = (nodes: any[]) =>
        nodes.forEach((n) => {
          if (n.locked)
            unlock.push({
              type: "setNodeMetadata",
              nodeId: n.id,
              locked: false,
            });
          Object.values(n.slots).forEach((children) => walk(children as any[]));
        });
      walk(own.nodes);
      if (unlock.length) await batch(unlock);
      const restored = await batch([
        { type: "removePage", pageId: fixture.id },
      ]);
      expect(restored.pages.map((p: any) => p.screenId)).toEqual(
        fixture.beforeIds,
      );
    }
  };
  const open = async () => {
    await expect(page.getByTestId("save-status")).toContainText(
      "ревизия " + (await read()).revision,
    );
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await selectStudioOption(page, "Экран", fixture.id);
    const edit = page.getByRole("button", {
      name: "Редактирование холста",
      exact: true,
    });
    if ((await edit.getAttribute("aria-pressed")) !== "true")
      await edit.click();
    await page
      .getByRole("button", {
        name: "Выделить " + fixture.id + "-root",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Масштаб 100%", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Свободный холст", exact: true }),
    ).toHaveAttribute("data-zoom", "1");
    await expect(page.locator('[data-transform-handle="se"]')).toBeVisible();
    const expectedRevision = (await read()).revision;
    const canvas = page.getByRole("region", {
      name: "Свободный холст",
      exact: true,
    });
    const frame = page.frameLocator(`iframe[title="Холст ${fixture.id}"]`);
    await expect
      .poll(async () => {
        const context = await page.evaluate(
          async (headers) =>
            (await fetch("/api/context", { headers }).then((r) => r.json()))
              .context,
          fixture.headers,
        );
        const displayed = await canvas.evaluate((element) => ({
          zoom: Number(element.getAttribute("data-zoom")),
          panX: Number(element.getAttribute("data-pan-x")),
          panY: Number(element.getAttribute("data-pan-y")),
        }));
        const camera = context?.camera;
        if (
          context?.pageId !== fixture.id ||
          context.revision !== expectedRevision ||
          camera?.transient !== false ||
          camera.revision !== expectedRevision ||
          camera.view.zoom !== displayed.zoom ||
          camera.view.panX !== displayed.panX ||
          camera.view.panY !== displayed.panY
        )
          return false;
        for (const suffix of ["-root", "-text"]) {
          const id = fixture.id + suffix;
          const measured = context.bounds?.[id];
          const box = await frame
            .locator(`[data-node-id="${id}"]`)
            .boundingBox();
          if (
            !camera.bounds.some((b: { id: string }) => b.id === id) ||
            !measured ||
            !box ||
            !(["x", "y", "width", "height"] as const).every(
              (key) => Math.abs(box[key] - measured[key]) < 1,
            )
          )
            return false;
        }
        return true;
      })
      .toBe(true);
  };
  const node = async () =>
    (await read()).pages.find((p: any) => p.screenId === fixture.id).nodes[0];
  const handlePoint = async (handle = "se") => {
    const locator = page.locator(`[data-transform-handle="${handle}"]`);
    await locator.scrollIntoViewIfNeeded();
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const start = async () => {
    const point = await handlePoint();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    return point;
  };
  const undo = async () => {
    const rev = (await read()).revision;
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await expect.poll(async () => (await read()).revision).toBe(rev + 1);
  };
  return {
    ...fixture,
    read,
    node,
    batch,
    cleanup,
    open,
    handlePoint,
    start,
    undo,
  };
}

test("a delayed click pick survives the next tool shortcut without changing the document", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await f.open();
    const before = await f.read();
    await page.evaluate((title) => {
      const iframe = [...document.querySelectorAll("iframe")].find(
        (element) => element.title === title,
      )!;
      const capture = (event: MessageEvent) => {
        if (
          event.source !== iframe.contentWindow ||
          event.origin !== location.origin ||
          event.data?.type !== "studio-preview-picked"
        )
          return;
        event.stopImmediatePropagation();
        (window as any).__heldPointerPick = {
          data: event.data,
          origin: event.origin,
          source: event.source,
        };
        window.removeEventListener("message", capture, true);
      };
      window.addEventListener("message", capture, true);
    }, `Холст ${f.id}`);
    const text = page
      .frameLocator(`iframe[title="Холст ${f.id}"]`)
      .locator(`[data-node-id="${f.id}-text"]`);
    const box = (await text.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__heldPointerPick?.data.id),
      )
      .toBe(f.id + "-text");
    await page.keyboard.press("k");
    await page.evaluate(() => {
      const held = (window as any).__heldPointerPick;
      window.dispatchEvent(new MessageEvent("message", held));
      delete (window as any).__heldPointerPick;
    });
    await expect(page.getByTestId("selection")).toContainText(f.id + "-text");
    await expect(
      page.getByRole("button", {
        name: "Масштабирование содержимого",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await f.read()).toEqual(before);
  } finally {
    await f.cleanup();
  }
});

test("a flow node selects without a move warning and only warns after a real drag", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await f.batch([
      {
        type: "insertNode",
        pageId: f.id,
        index: 1,
        node: {
          id: f.id + "-flow",
          type: "Text",
          props: { text: "Legacy flow text" },
          slots: {},
        },
      },
    ]);
    await f.open();
    const before = await f.read();
    const flow = page
      .frameLocator(`iframe[title="Холст ${f.id}"]`)
      .locator(`[data-node-id="${f.id}-flow"]`);
    const box = (await flow.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId("selection")).toContainText(f.id + "-flow");
    await expect(page.locator(".canvas-editor").getByRole("alert")).toHaveCount(
      0,
    );
    await expect(page.locator("[data-transform-handle]")).toHaveCount(0);
    expect(await f.read()).toEqual(before);
    const fresh = (await flow.boundingBox())!;
    await page.mouse.move(
      fresh.x + fresh.width / 2,
      fresh.y + fresh.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      fresh.x + fresh.width / 2 + 15,
      fresh.y + fresh.height / 2,
      { steps: 3 },
    );
    await page.mouse.up();
    await expect(
      page.locator(".canvas-editor").getByRole("alert"),
    ).toContainText("Этот слой нельзя переместить на холсте.");
    expect(await f.read()).toEqual(before);
  } finally {
    await page.mouse.up().catch(() => {});
    await f.cleanup();
  }
});

test("pointer Resize and Scale preview without writes, commit once, undo and reopen", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await f.open();
    const original = await f.node();
    await page.screenshot({
      path: test.info().outputPath("canvas-transforms-ru-light.png"),
      fullPage: true,
    });
    const preview = page.frameLocator(`iframe[title="Холст ${f.id}"]`);
    const root = preview.locator(`[data-node-id="${f.id}-root"]`);
    const child = preview.locator(`[data-node-id="${f.id}-text"]`);
    const start = await f.start();
    await page.mouse.move(start.x + 40, start.y + 20, { steps: 3 });
    await expect(root).toHaveCSS("width", "240px");
    expect((await f.read()).revision).toBe(f.revision);
    await page.mouse.up();
    await expect
      .poll(async () => (await f.read()).revision)
      .toBe(f.revision + 1);
    expect((await f.node()).scene).toMatchObject({ width: 240, height: 140 });
    expect((await f.node()).slots.content[0]).toEqual(
      original.slots.content[0],
    );
    await f.undo();
    expect(await f.node()).toEqual(original);
    await page
      .getByRole("button", { name: "Масштабирование содержимого", exact: true })
      .click();
    const rev = (await f.read()).revision;
    const scale = await f.start();
    await page.mouse.move(scale.x + 40, scale.y + 20, { steps: 3 });
    await expect(root).toHaveCSS(
      "transform",
      "matrix(1.2, 0, 0, 1.16667, 0, 0)",
    );
    await expect(child.locator(":scope > div")).toHaveCSS("font-size", "20px");
    await expect
      .poll(async () => (await child.boundingBox())!.width)
      .toBeCloseTo(192, 5);
    expect((await f.read()).revision).toBe(rev);
    await page.mouse.up();
    await expect.poll(async () => (await f.read()).revision).toBe(rev + 1);
    const scaled = await f.node();
    expect(scaled.scene.width).toBe(200);
    expect(scaled.scene.height).toBe(120);
    expect(scaled.scene.linearTransform[0]).toBeCloseTo(1.2, 8);
    expect(scaled.scene.linearTransform[3]).toBeCloseTo(1 + 20 / 120, 8);
    await page.reload();
    await f.open();
    expect(await f.node()).toEqual(scaled);
    await f.undo();
    expect(await f.node()).toEqual(original);
  } finally {
    await page.mouse.up().catch(() => {});
    await f.cleanup();
  }
});

test("Escape, invalid final pointer and external revision cancel the captured transform", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await f.open();
    const original = await f.node();
    let p = await f.start();
    await page.mouse.move(p.x + 40, p.y + 20);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect((await f.read()).revision).toBe(f.revision);
    expect(await f.node()).toEqual(original);
    p = await f.start();
    await page.mouse.move(p.x + 40, p.y + 20);
    await page.mouse.move(p.x - 210, p.y);
    await page.mouse.up();
    await expect(page.getByRole("alert")).toContainText(
      "Преобразование недопустимо",
    );
    expect((await f.read()).revision).toBe(f.revision);
    expect(await f.node()).toEqual(original);
    p = await f.start();
    await page.mouse.move(p.x + 40, p.y + 20);
    const updated = await f.batch([
      {
        type: "updateProps",
        nodeId: f.id + "-text",
        props: { text: "External edit" },
      },
    ]);
    await expect(page.getByTestId("save-status")).toContainText(
      "ревизия " + updated.revision,
    );
    await page.mouse.up();
    expect((await f.read()).revision).toBe(updated.revision);
    expect((await f.node()).scene).toEqual(original.scene);
    expect((await f.node()).slots.content[0].props.text).toBe("External edit");
  } finally {
    await page.mouse.up().catch(() => {});
    await f.cleanup();
  }
});

test("rotation snaps with Shift and keyboard tools expose numeric controls in English dark theme", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await f.open();
    const original = await f.node();
    const p = await f.handlePoint("rotate");
    // Rotation stem starts 28 CSS px above the top edge; pivot is frame centre.
    const rootBox = (await page
      .frameLocator(`iframe[title="Холст ${f.id}"]`)
      .locator(`[data-node-id="${f.id}-root"]`)
      .boundingBox())!;
    const center = {
      x: rootBox.x + rootBox.width / 2,
      y: rootBox.y + rootBox.height / 2,
    };
    const angle = (31 * Math.PI) / 180;
    const dx = p.x - center.x,
      dy = p.y - center.y;
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down("Shift");
    await page.mouse.down();
    await page.mouse.move(
      center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      center.y + dx * Math.sin(angle) + dy * Math.cos(angle),
      { steps: 5 },
    );
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expect
      .poll(async () => (await f.read()).revision)
      .toBe(f.revision + 1);
    const matrix = (await f.node()).scene.linearTransform;
    expect((Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI).toBeCloseTo(
      30,
      6,
    );
    await f.undo();
    expect(await f.node()).toEqual(original);
    await page.getByLabel("Тема студии", { exact: true }).selectOption("dark");
    await page.getByLabel("Язык студии", { exact: true }).selectOption("en");
    const canvas = page.getByRole("region", {
      name: "Free canvas",
      exact: true,
    });
    await canvas.focus();
    await page.keyboard.press("k");
    await expect(
      page.getByRole("button", { name: "Scale content", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("v");
    await expect(
      page.getByRole("button", { name: "Resize selection", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
      await canvas.dispatchEvent("keydown", {
        key: "k",
        code: "KeyK",
        [modifier]: true,
      });
      await expect(
        page.getByRole("button", { name: "Resize selection", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await canvas.dispatchEvent("keydown", { key: "л", code: "KeyK" });
    await expect(
      page.getByRole("button", { name: "Scale content", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await canvas.dispatchEvent("keydown", { key: "м", code: "KeyV" });
    await expect(
      page.getByRole("button", { name: "Resize selection", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: test.info().outputPath("canvas-transforms-en-dark.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Numeric transform controls", exact: true })
      .click();
    await expect(page.locator(".transform-controls")).toHaveAttribute(
      "open",
      "",
    );
    await expect(page.locator(".transform-controls summary")).toBeFocused();
    await expect(
      page.getByLabel("Container width, px", { exact: true }),
    ).toHaveValue("200");
    await expect(page.locator('[data-studio-theme="dark"]')).toBeVisible();
  } finally {
    await page.keyboard.up("Shift").catch(() => {});
    await page.mouse.up().catch(() => {});
    await f.cleanup();
  }
});

test("middle button on handles and repeated Space preserve camera pan without document writes", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await f.open();
    const original = await f.read();
    const canvas = page.getByRole("region", {
      name: "Свободный холст",
      exact: true,
    });
    const pan = async () => Number(await canvas.getAttribute("data-pan-x"));
    const beforeMiddle = await pan();
    const p = await f.handlePoint();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(p.x + 30, p.y + 10);
    await page.mouse.up({ button: "middle" });
    await expect.poll(pan).toBeCloseTo(beforeMiddle + 30, 5);
    const beforeSpace = await pan();
    const box = (await canvas.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await canvas.focus();
    await page.keyboard.down("Space");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y);
    await canvas.dispatchEvent("keydown", {
      key: " ",
      code: "Space",
      repeat: true,
    });
    await page.mouse.move(start.x + 40, start.y);
    await page.mouse.up();
    await page.keyboard.up("Space");
    await expect.poll(pan).toBeCloseTo(beforeSpace + 40, 5);
    expect(await f.read()).toEqual(original);
  } finally {
    await page.keyboard.up("Space").catch(() => {});
    await page.mouse.up({ button: "middle" }).catch(() => {});
    await page.mouse.up().catch(() => {});
    await f.cleanup();
  }
});

test("transparent canvas preserves the dark studio background across iframe color schemes", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await f.open();
    await page.getByLabel("Тема студии", { exact: true }).selectOption("dark");
    const canvas = page.getByRole("region", {
      name: "Свободный холст",
      exact: true,
    });
    const inner = page.frameLocator(`iframe[title="Холст ${f.id}"]`);
    await expect(inner.locator("html")).toHaveAttribute(
      "data-studio-preview-revision",
      String((await f.read()).revision),
    );
    await expect(inner.locator("html")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(inner.locator("body")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    const sample = async (image: Buffer) =>
      page.evaluate(async (base64) => {
        const bitmap = await createImageBitmap(
          await (await fetch("data:image/png;base64," + base64)).blob(),
        );
        const target = document.createElement("canvas");
        target.width = bitmap.width;
        target.height = bitmap.height;
        const ctx = target.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const pixel = [...ctx.getImageData(11, 13, 1, 1).data];
        bitmap.close();
        return pixel;
      }, image.toString("base64"));
    const image = await canvas.screenshot({
      path: test.info().outputPath("dark-canvas-transparent.png"),
    });
    const background = await canvas.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const rgb = background.match(/\d+/g)!.slice(0, 3).map(Number);
    expect(await sample(image)).toEqual([...rgb, 255]);
  } finally {
    await f.cleanup();
  }
});
