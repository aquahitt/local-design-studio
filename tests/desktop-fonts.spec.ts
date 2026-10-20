import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("desktop loads portable project font bytes in isolated preview and agent capture across reopen", async () => {
  test.setTimeout(90000);
  const temp = await mkdtemp(join(tmpdir(), "studio-desktop-font-")),
    root = join(temp, "project");
  await mkdir(root);
  const packaged = process.env.STUDIO_PACKAGED_EXECUTABLE;
  if (!packaged)
    execFileSync(process.execPath, ["scripts/desktop/build.mjs"], {
      stdio: "pipe",
    });
  const launch = () =>
    electron.launch({
      ...(packaged ? { executablePath: packaged } : { args: [resolve(".")] }),
      chromiumSandbox: process.platform === "linux",
      env: { ...process.env, STUDIO_USER_DATA: join(temp, "settings") },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    }, root);
    await page.getByLabel("Название проекта").fill("Portable font test");
    await page
      .getByRole("button", { name: "Создать проект", exact: true })
      .click();
    await expect(
      page.getByText("Portable font test", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Основы", exact: true }).click();
    await page
      .getByLabel("Импортировать шрифты", { exact: true })
      .setInputFiles(resolve("tests/fixtures/fonts/studio-fixture.ttf"));
    await expect(
      page.getByText("Шрифты добавлены в проект", { exact: true }),
    ).toBeVisible();
    const inserted = await page.evaluate(async () => {
      const session = await fetch("/api/session").then((r) => r.json()),
        headers = {
          Authorization: `Bearer ${session.token}`,
          "x-studio-ui-token": session.uiToken,
          "Content-Type": "application/json",
        };
      const project = await fetch("/api/project", { headers }).then((r) =>
          r.json(),
        ),
        font = project.fonts[0],
        pageId = project.pages[0].screenId;
      const response = await fetch("/api/operations", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          baseRevision: project.revision,
          operations: [
            {
              type: "insertNode",
              pageId,
              index: project.pages[0].nodes.length,
              node: {
                id: "portable-font-text",
                type: "SceneText",
                props: { text: "Привет World" },
                slots: {},
                scene: {
                  kind: "text",
                  x: 10,
                  y: 70,
                  width: 250,
                  height: 80,
                  fontSize: 24,
                  textStyle: {
                    fontId: font.id,
                    lineHeight: 32,
                    letterSpacing: 1,
                  },
                },
              },
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const next = await response.json();
      return { headers, pageId, font, revision: next.revision };
    });
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    const text = page
      .frameLocator(".page-stage iframe")
      .locator('[data-node-id="portable-font-text"] > div');
    await expect(text).toHaveCSS(
      "font-family",
      `StudioFont_${inserted.font.assetHash}_400_normal`,
    );
    await expect
      .poll(() =>
        text.evaluate((el) =>
          document.fonts.check(`400 24px ${getComputedStyle(el).fontFamily}`),
        ),
      )
      .toBe(true);
    const before = await readFile(join(root, "project.json"), "utf8");
    const rendered = await page.evaluate(
      async ({ headers, pageId, revision }) => {
        const r = await fetch("/api/render", {
          method: "POST",
          headers,
          body: JSON.stringify({ pageId, revision }),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      inserted,
    );
    expect(rendered.warnings).toEqual([]);
    expect(
      rendered.computedStyles.find(
        (row: { id: string }) => row.id === "portable-font-text",
      ).content["font-family"],
    ).toBe(`StudioFont_${inserted.font.assetHash}_400_normal`);
    expect(await readFile(join(root, "project.json"), "utf8")).toBe(before);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Portable font test", exact: false })
      .click();
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await expect(
      page
        .frameLocator(".page-stage iframe")
        .locator('[data-node-id="portable-font-text"] > div'),
    ).toHaveCSS(
      "font-family",
      `StudioFont_${inserted.font.assetHash}_400_normal`,
    );
    expect(await readFile(join(root, "project.json"), "utf8")).toBe(before);
  } finally {
    await app.close().catch(() => {});
    await rm(temp, { recursive: true, force: true });
  }
});
