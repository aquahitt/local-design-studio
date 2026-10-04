import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
test("desktop creates, saves, reopens disk project and isolates preview", async () => {
  const temp = await mkdtemp(join(tmpdir(), "studio-desktop-e2e-"));
  const root = join(temp, "project");
  await mkdir(root);
  if (!process.env.STUDIO_PACKAGED_EXECUTABLE)
    execFileSync(process.execPath, ["scripts/desktop/build.mjs"], {
      stdio: "pipe",
    });
  const launch = () =>
    electron.launch(
      process.env.STUDIO_PACKAGED_EXECUTABLE
        ? {
            executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE,
            env: { ...process.env, STUDIO_USER_DATA: join(temp, "settings") },
          }
        : {
            args: ["."],
            env: { ...process.env, STUDIO_USER_DATA: join(temp, "settings") },
          },
    );
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Твои проекты — на твоём компьютере" }),
    ).toBeVisible();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    }, root);
    await page.getByLabel("Название проекта").fill("Desktop test");
    await page
      .getByRole("button", { name: "Создать проект", exact: true })
      .click();
    await expect(
      page.getByText("Desktop test", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.frameLocator("iframe").first().getByRole("button").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await page
      .getByRole("button", { name: "Выделить demo-title", exact: true })
      .click();
    const props = page.getByLabel("Свойства JSON");
    await props.fill('{"text":"Saved from desktop","size":24}');
    await page.getByRole("button", { name: "Применить свойства" }).click();
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(root, "project.json"), "utf8"))
            .pages[0].nodes[0].props.text,
      )
      .toBe("Saved from desktop");
    const iframe = page.frames().find((f) => f.url().includes("/preview"))!;
    expect(await iframe.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
    expect(
      await iframe.evaluate(() => typeof (window as any).studioDesktop),
    ).toBe("undefined");
    expect(
      await iframe.evaluate(() => {
        try {
          return typeof (parent as any).studioDesktop;
        } catch {
          return "blocked";
        }
      }),
    ).toBe("blocked");
    expect(
      await iframe.evaluate(() => fetch("/api/session").then((r) => r.status)),
    ).toBe(403);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Desktop test", exact: false })
      .click();
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await page
      .getByRole("button", { name: "Выделить demo-title", exact: true })
      .click();
    await expect
      .poll(() => page.getByLabel("Свойства JSON").inputValue())
      .toContain("Saved from desktop");
    await page.getByRole("button", { name: "Все проекты" }).click();
    await expect(
      page.getByRole("heading", { name: "Твои проекты — на твоём компьютере" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/desktop-launcher.png" });
    await app.evaluate(
      ({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [root],
        });
      },
      join(temp, "missing"),
    );
    await page
      .getByRole("button", { name: "Открыть проект", exact: true })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
  } finally {
    await app.close();
    await rm(temp, { recursive: true, force: true });
  }
});
