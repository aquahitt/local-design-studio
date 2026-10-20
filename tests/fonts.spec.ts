import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { Project } from "../src/core/project";
import { selectStudioOption } from "./select-helpers";
const ownedFonts = new Set<string>();
const file = resolve("tests/fixtures/fonts/studio-fixture.ttf");
async function read(page: Page): Promise<Project> {
  return page.evaluate(async () => {
    const s = await fetch("/api/session").then((r) => r.json());
    return fetch("/api/project", {
      headers: { Authorization: `Bearer ${s.token}` },
    }).then((r) => r.json());
  });
}
test("imports a project font, applies exact face and px typography, retains malformed JSON and reopens after undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Основы", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Шрифты проекта", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Импортировать шрифты").setInputFiles([file, file]);
  await expect(
    page.getByRole("status").filter({ hasText: "Шрифты добавлены в проект" }),
  ).toBeVisible();
  const imported = await read(page);
  expect(imported.fonts).toHaveLength(1);
  expect(imported.fonts![0].family).toBe("Studio Fixture Mono");
  ownedFonts.add(imported.fonts![0].id);
  const ids = await page.evaluate(async () => {
    const s = await fetch("/api/session").then((r) => r.json());
    const h = {
      Authorization: `Bearer ${s.token}`,
      "x-studio-ui-token": s.uiToken,
      "Content-Type": "application/json",
    };
    const p = await fetch("/api/project", { headers: h }).then((r) => r.json());
    const id = "font-text-" + crypto.randomUUID();
    const screenId = "font-page-" + crypto.randomUUID();
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: p.revision,
        operations: [
          {
            type: "addPage",
            page: {
              screenId,
              name: screenId,
              viewport: { width: 390, height: 600 },
              nodes: [
                {
                  id,
                  type: "SceneText",
                  name: "Font test",
                  props: { text: "Шрифт проекта Aa 123" },
                  slots: {},
                  scene: {
                    kind: "text",
                    x: 30,
                    y: 30,
                    width: 300,
                    height: 80,
                    fontSize: 24,
                  },
                },
              ],
            },
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return { id, screenId };
  });
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", ids.screenId);
  await page
    .getByRole("button", { name: `Выделить ${ids.id}`, exact: true })
    .click();
  const inspector = page.locator(".layout-inspector");
  await selectStudioOption(
    page,
    "Шрифт текста",
    `${imported.fonts![0].name} · 400 normal`,
  );
  await inspector.getByLabel("Интерлиньяж, px", { exact: true }).fill("32");
  await inspector.getByLabel("Трекинг, px", { exact: true }).fill("-");
  await expect(
    inspector.getByRole("button", { name: "Применить слой", exact: true }),
  ).toBeDisabled();
  await inspector.getByLabel("Трекинг, px", { exact: true }).fill("1.5");
  await inspector
    .getByRole("button", { name: "Применить слой", exact: true })
    .click();
  await expect
    .poll(async () => {
      const p = await read(page);
      return p.pages.find((p) => p.screenId === ids.screenId)?.nodes[0].scene
        ?.textStyle;
    })
    .toEqual({
      fontId: imported.fonts![0].id,
      lineHeight: 32,
      letterSpacing: 1.5,
    });
  const rendered = page
    .frameLocator(".page-stage iframe")
    .locator(`[data-node-id="${ids.id}"]`);
  await expect
    .poll(() =>
      rendered.evaluate((element) => {
        const style = getComputedStyle(element.firstElementChild!);
        return {
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          loaded: [...document.fonts].some(
            (face) =>
              face.family === style.fontFamily && face.status === "loaded",
          ),
        };
      }),
    )
    .toEqual({ lineHeight: "32px", letterSpacing: "1.5px", loaded: true });
  const json = inspector.getByLabel("Параметры слоя JSON", { exact: true });
  const valid = await json.inputValue();
  const bad = JSON.parse(valid);
  bad.scene.textStyle = { fontId: { toString: null } };
  await json.fill(JSON.stringify(bad));
  await expect(
    inspector.getByRole("button", { name: "Применить слой", exact: true }),
  ).toBeDisabled();
  await expect(json).toHaveValue(JSON.stringify(bad));
  await json.fill(valid);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await expect
    .poll(async () => {
      const p = await read(page);
      return (
        p.pages.find((p) => p.screenId === ids.screenId)?.nodes[0].scene
          ?.textStyle ?? null
      );
    })
    .toBeNull();
  await page.reload();
  expect((await read(page)).fonts).toEqual(imported.fonts);
});

test("font import preserves its starting revision when the document changes during upload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Основы", exact: true }).click();
  const before = await read(page);
  let uploaded!: () => void, release!: () => void;
  const hasUploaded = new Promise<void>((resolve) => (uploaded = resolve)),
    hold = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/fonts", async (route) => {
    const response = await route.fetch();
    uploaded();
    await hold;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByLabel("Импортировать шрифты")
      .setInputFiles(resolve("tests/fixtures/fonts/studio-fixture.woff2"));
    await hasUploaded;
    await page.evaluate(async () => {
      const s = await fetch("/api/session").then((r) => r.json());
      const h = {
        Authorization: `Bearer ${s.token}`,
        "x-studio-ui-token": s.uiToken,
        "Content-Type": "application/json",
      };
      const p = await fetch("/api/project", { headers: h }).then((r) =>
        r.json(),
      );
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          baseRevision: p.revision,
          operations: [
            {
              type: "addPage",
              page: {
                screenId: "font-page-concurrent-" + crypto.randomUUID(),
                name: "Concurrent font import edit",
                viewport: { width: 390, height: 600 },
                nodes: [],
              },
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    });
    release();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Документ изменился во время импорта." }),
    ).toBeVisible();
    expect((await read(page)).fonts).toEqual(before.fonts);
  } finally {
    release();
    await page.unroute("**/api/fonts");
  }
});

test("English dark font controls stay accessible and reject oversized imports locally", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("local-design-studio:locale", "en");
    localStorage.setItem("local-design-studio:interface-theme", "dark");
  });
  await page.goto("/");
  await expect(page.getByLabel("Studio theme", { exact: true })).toHaveValue(
    "dark",
  );
  await page.getByRole("button", { name: "Foundations", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Project fonts", exact: true }),
  ).toBeVisible();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/fonts")) requests.push(request.url());
  });
  await page.getByLabel("Import fonts").setInputFiles({
    name: "oversized.ttf",
    mimeType: "font/ttf",
    buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
  });
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Up to 128 files, each no larger than 8 MiB." }),
  ).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByLabel("Import fonts").setInputFiles({name:"broken.ttf",mimeType:"font/ttf",buffer:Buffer.from([0,1,2])});
  await expect(page.getByRole("alert")).toContainText("Could not read the font. Choose another TTF, OTF, WOFF or WOFF2 file.");
  expect(requests).toHaveLength(1);
  await page.getByLabel("Import fonts").focus();
  await expect(page.getByLabel("Import fonts")).toBeFocused();
});

test("unfinished typography numbers survive concurrent revisions and require explicit draft rebase", async ({
  page,
}) => {
  await page.goto("/");
  const fixture = await page.evaluate(async () => {
    const s = await fetch("/api/session").then((r) => r.json());
    const h = {
      Authorization: `Bearer ${s.token}`,
      "x-studio-ui-token": s.uiToken,
      "Content-Type": "application/json",
    };
    const p = await fetch("/api/project", { headers: h }).then((r) => r.json());
    const id = "font-conflict-text-" + crypto.randomUUID(),
      screenId = "font-conflict-page-" + crypto.randomUUID();
    const r = await fetch("/api/operations", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: p.revision,
        operations: [
          {
            type: "addPage",
            page: {
              screenId,
              name: screenId,
              viewport: { width: 390, height: 600 },
              nodes: [
                {
                  id,
                  type: "SceneText",
                  props: { text: "Незавершённый ввод" },
                  slots: {},
                  scene: { kind: "text", x: 20, y: 20, width: 250, height: 80 },
                },
              ],
            },
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    return { id, screenId };
  });
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", fixture.screenId);
  await page
    .getByRole("button", { name: `Выделить ${fixture.id}`, exact: true })
    .click();
  const inspector = page.locator(".layout-inspector"),
    height = inspector.getByLabel("Интерлиньяж, px", { exact: true });
  await height.fill("1e");
  await page.evaluate(async (screenId) => {
    const s = await fetch("/api/session").then((r) => r.json());
    const h = {
      Authorization: `Bearer ${s.token}`,
      "x-studio-ui-token": s.uiToken,
      "Content-Type": "application/json",
    };
    const p = await fetch("/api/project", { headers: h }).then((r) => r.json());
    const r = await fetch("/api/operations", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: p.revision,
        operations: [
          {
            type: "renamePage",
            pageId: screenId,
            name: "Concurrent typography edit",
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(await r.text());
  }, fixture.screenId);
  await expect(
    inspector
      .getByRole("status")
      .filter({ hasText: "Документ изменился. Ввод сохранён." }),
  ).toBeVisible();
  await expect(height).toHaveValue("1e");
  await height.fill("28");
  await expect(
    inspector.getByRole("button", { name: "Применить слой", exact: true }),
  ).toBeDisabled();
  await inspector
    .getByRole("button", {
      name: "Использовать актуальную ревизию",
      exact: true,
    })
    .click();
  await inspector
    .getByRole("button", { name: "Применить слой", exact: true })
    .click();
  await expect
    .poll(async () => {
      const p = await read(page);
      return p.pages.find((p) => p.screenId === fixture.screenId)?.nodes[0]
        .scene?.textStyle?.lineHeight;
    })
    .toBe(28);
});

test.afterEach(async ({ page }) => {
  const ids = [...ownedFonts];
  ownedFonts.clear();
  if (!page.url().startsWith("http://127.0.0.1:")) return;
  await page.evaluate(async (fontIds) => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "x-studio-ui-token": session.uiToken,
      "Content-Type": "application/json",
    };
    const project: Project = await fetch("/api/project", { headers }).then(
      (r) => r.json(),
    );
    const operations = [
      ...project.pages
        .filter(
          (p) =>
            p.screenId.startsWith("font-page-") ||
            p.screenId.startsWith("font-conflict-page-"),
        )
        .map((p) => ({ type: "removePage", pageId: p.screenId })),
      ...fontIds
        .filter((id) => project.fonts?.some((f) => f.id === id))
        .map((id) => ({ type: "removeProjectFont", fontId: id })),
    ];
    if (!operations.length) return;
    const response = await fetch("/api/operations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: project.revision,
        operations,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, ids);
});

test("font proposals show affected page preview and metadata warnings before and after approval", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Основы", exact: true }).click();
  await page.getByLabel("Импортировать шрифты").setInputFiles(file);
  await expect(
    page.getByText("Шрифты добавлены в проект", { exact: true }),
  ).toBeVisible();
  const font = (await read(page)).fonts![0];
  ownedFonts.add(font.id);
  const fixture = await page.evaluate(async (font) => {
    const session = await fetch("/api/session").then((r) => r.json()),
      headers = {
        Authorization: `Bearer ${session.token}`,
        "x-studio-ui-token": session.uiToken,
        "Content-Type": "application/json",
      };
    const project = await fetch("/api/project", { headers }).then((r) =>
        r.json(),
      ),
      screenId = "font-page-" + crypto.randomUUID();
    const response = await fetch("/api/operations", {
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
              name: screenId,
              viewport: { width: 390, height: 300 },
              nodes: [
                {
                  id: screenId + "-text",
                  name: "Proposal font text",
                  type: "SceneText",
                  props: { text: "Привет World" },
                  slots: {},
                  scene: {
                    kind: "text",
                    x: 20,
                    y: 20,
                    width: 300,
                    height: 80,
                    fontSize: 24,
                    textStyle: { fontId: font.id },
                  },
                },
              ],
            },
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const baseline = await response.json();
    const r = await fetch("/api/proposals", {
      method: "POST",
      headers,
      body: JSON.stringify({
        description: "Font mismatch preview",
        batch: {
          requestId: crypto.randomUUID(),
          baseRevision: baseline.revision,
          operations: [
            {
              type: "updateProjectFont",
              fontId: font.id,
              font: { ...font, weight: 700 },
            },
          ],
        },
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    return { proposal: await r.json(), baseline, screenId };
  }, font);
  await page
    .getByRole("button", { name: "Предложения агента", exact: true })
    .click();
  const card = page
    .locator(".proposal-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Font mismatch preview",
        exact: true,
      }),
    });
  const preview = card.getByTestId("proposal-preview-" + fixture.proposal.id);
  await expect(preview.locator(".proposal-comparison iframe")).toHaveCount(2);
  await expect(preview.locator(".proposal-font-changes")).toContainText(
    "400 normal",
  );
  await expect(preview.locator(".proposal-font-changes")).toContainText(
    "700 normal",
  );
  await expect(
    preview
      .getByRole("status")
      .filter({ hasText: "Не удалось загрузить шрифт проекта" }),
  ).toBeVisible();
  expect(await read(page)).toEqual(fixture.baseline);
  await card
    .getByRole("button", { name: "Подтвердить и применить", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await read(page)).fonts?.find((f) => f.id === font.id)?.weight,
    )
    .toBe(700);
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", fixture.screenId);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Не удалось загрузить шрифт проекта" }),
  ).toBeVisible();
});
