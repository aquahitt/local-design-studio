import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { Project } from "../../src/core/project";
import { translate } from "../../src/studio/locales";
import { STUDIO_THEME_KEY } from "../../src/studio/DesignSystem";
import { STUDIO_LOCALE_KEY } from "../../src/studio/i18n";

// Reach controls through the real tab order: locator.focus()/press() would hide
// unreachable controls and focus traps in this end-to-end keyboard scenario.
async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let count = 0; count < 180; count++) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      await expect(target).toBeFocused();
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Control is unreachable by Tab: ${await target.ariaSnapshot()}`);
}

async function activate(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press("Enter");
}

async function replaceText(page: Page, target: Locator, value: string) {
  await tabTo(page, target);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(value);
}

async function audit(page: Page, state: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations, state).toEqual([]);
}

// This server owns only a fresh fixture. A real process restart checks disk
// persistence rather than treating page.reload() as an application restart.
async function startFixture(projectRoot: string) {
  const url = "http://127.0.0.1:5230";
  const child = spawn(
    process.execPath,
    [resolve("node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5230", "--strictPort"],
    {
      cwd: process.cwd(),
      env: { ...process.env, STUDIO_PROJECT: projectRoot, STUDIO_LIBRARY_ROOT: "", VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => { output = (output + chunk).slice(-6000); });
  child.stderr?.on("data", (chunk) => { output = (output + chunk).slice(-6000); });
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error(`Fixture server stopped: ${output}`);
      return fetch(url + "/api/session").then((response) => response.ok).catch(() => false);
    }, { timeout: 20000 }).toBe(true);
    return { child, url };
  } catch (error) {
    await stopFixture(child);
    throw error;
  }
}

async function stopFixture(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveStop, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Fixture server did not stop within 10 seconds"));
    }, 10000);
    child.once("exit", () => { clearTimeout(timer); resolveStop(); });
    child.kill("SIGTERM");
  });
}

for (const locale of ["ru", "en"] as const) {
  test(`${locale}: Tab-only create, edit, dialog, proposal, export and process restart`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const projectRoot = await mkdtemp(join(tmpdir(), "studio-a11y-keyboard-"));
    let server = await startFixture(projectRoot);
    const t = (source: string) => translate(locale, source);
    const button = (source: string) => page.getByRole("button", { name: t(source), exact: true });
    const projectFile = () => readFile(join(projectRoot, "project.json"), "utf8").then((json) => JSON.parse(json) as Project);
    try {
      await page.goto(server.url);
      await expect(page.getByRole("button", { name: "Управлять группами", exact: true })).toBeVisible();
      if (locale === "en") {
        await tabTo(page, page.getByLabel("Язык студии", { exact: true }));
        // Native select type-ahead selects the English option without opening
        // the platform popup (headless macOS does not operate that popup).
        await page.keyboard.press("e");
        await page.keyboard.press("Tab");
      }
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const originalName = (await projectFile()).name;
      await audit(page, `${locale} catalog/light`);

      const groups = page.getByRole("combobox", { name: t("Группа проекта"), exact: true });
      await activate(page, groups);
      const search = page.getByRole("combobox", { name: t("Поиск: {0}").replace("{0}", t("Группа проекта")), exact: true });
      await expect(search).toBeFocused();
      await page.keyboard.press("End");
      await expect(search).toHaveAttribute("aria-activedescendant", /.+-\d+$/);
      await page.keyboard.press("Escape");
      await expect(groups).toBeFocused();

      const manage = button("Управлять группами");
      await activate(page, manage);
      const dialog = page.getByRole("dialog", { name: t("Управление группами"), exact: true });
      await expect(dialog).toBeVisible();
      for (let count = 0; count < 12; count++) {
        await page.keyboard.press("Tab");
        // Native modal dialogs permit Tab to enter browser chrome, but never
        // another control in the background document.
        const focusState = await dialog.evaluate((element) =>
          !document.hasFocus() || element.contains(document.activeElement),
        );
        expect(focusState).toBe(true);
      }
      await audit(page, `${locale} group dialog`);
      await tabTo(page, page.getByRole("button", { name: t("Закрыть группы"), exact: true }));
      await page.keyboard.press("Escape");
      await expect(manage).toBeFocused();

      await activate(page, manage);
      const groupName = `Keyboard group ${locale}`;
      await replaceText(page, page.getByLabel(t("Название новой группы"), { exact: true }), groupName);
      await activate(page, button("Создать группу"));
      await replaceText(page, page.getByLabel(t("Название группы"), { exact: true }), groupName + " edited");
      await activate(page, button("Сохранить группы"));
      await expect(dialog).not.toBeVisible();
      await expect(manage).toBeFocused();
      await expect.poll(async () => (await projectFile()).groups?.map((group) => group.name)).toContain(groupName + " edited");

      await activate(page, button("Экраны"));
      await activate(page, button("Экран +"));
      await expect(page.getByTestId("save-status")).toContainText(t("Сохранено локально · ревизия"));
      await expect(page.locator(".layer-row")).toHaveCount(0);
      await activate(page, button("Текст +"));
      await expect(page.locator(".layer-row")).toHaveCount(1);
      await expect(page.getByTestId("save-status")).toContainText(t("Сохранено локально · ревизия"));
      const layer = page.locator(".layer-row").getByRole("button");
      await activate(page, layer);
      await expect(layer).toHaveAttribute("aria-pressed", "true");
      const properties = page.getByLabel(t("Свойства JSON"), { exact: true });
      const editedText = `Keyboard edit ${locale} — русский текст`;
      await replaceText(page, properties, JSON.stringify({ text: editedText }));
      // A native Backspace in the inspector must edit text, not remove the layer.
      await page.keyboard.press("End");
      await page.keyboard.press("Backspace");
      await expect(page.locator(".layer-row")).toHaveCount(1);
      await page.keyboard.insertText("}");
      await activate(page, button("Применить свойства"));
      await expect(button("Применить свойства")).toBeDisabled();
      await expect(page.getByTestId("save-status")).toContainText(t("Сохранено локально · ревизия"));
      await expect.poll(async () => JSON.stringify((await projectFile()).pages)).toContain(editedText);
      await audit(page, `${locale} selected layer/inspector/light`);

      const saved = await projectFile();
      const node = saved.pages.flatMap((projectPage) => projectPage.nodes).find((item) => item.props.text === editedText)!;
      expect(node).toBeDefined();
      const proposalText = `Keyboard proposal ${locale}`;
      // Agents create proposals via the service; all human approval actions below
      // use the keyboard, with no direct API approval or document writes.
      await page.evaluate(async ({ nodeId, revision, proposalText }) => {
        const session = await fetch("/api/session").then((response) => response.json());
        const response = await fetch("/api/proposals", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ description: proposalText, batch: { requestId: crypto.randomUUID(), baseRevision: revision, author: "agent", operations: [{ type: "updateProps", nodeId, props: { text: proposalText } }] } }),
        });
        if (!response.ok) throw new Error(`Proposal creation failed: ${response.status}`);
      }, { nodeId: node.id, revision: saved.revision, proposalText });
      await activate(page, button("Предложения агента"));
      await expect(page.getByRole("heading", { name: proposalText, exact: true })).toBeVisible();
      await audit(page, `${locale} pending proposal/light`);
      await activate(page, button("Подтвердить и применить"));
      await expect(page.locator(".proposal-card")).toHaveCount(0);
      await expect.poll(async () => JSON.stringify((await projectFile()).pages)).toContain(proposalText);

      const projectDownload = page.waitForEvent("download");
      await activate(page, button("Экспорт проекта ↗"));
      const downloaded = await projectDownload;
      const exported = JSON.parse(await readFile((await downloaded.path())!, "utf8")) as Project;
      expect(exported).toEqual(await projectFile());
      expect(exported.name).toBe(originalName);

      await activate(page, button("Экраны"));
      const layerAgain = page.getByRole("button", { name: t("Выделить ") + node.id, exact: true });
      await activate(page, layerAgain);
      await activate(page, page.locator("summary").filter({ hasText: t("Inspect и экспорт React") }));
      await activate(page, button("Подготовить экспорт экрана"));
      await expect(button("Скачать React ZIP")).toBeVisible();
      const zipDownload = page.waitForEvent("download");
      await activate(page, button("Скачать React ZIP"));
      const zip = await zipDownload;
      const files = unzipSync(await readFile((await zip.path())!));
      expect(Object.keys(files)).toEqual(expect.arrayContaining(["Screen.tsx", "Runtime.tsx", "manifest.json", "README.md"]));
      expect(strFromU8(files["Screen.tsx"])).toContain(proposalText);

      const persisted = await projectFile();
      await page.goto("about:blank");
      await stopFixture(server.child);
      server = await startFixture(projectRoot);
      await page.goto(server.url);
      await expect(page.getByLabel(t("Язык студии"), { exact: true })).toHaveValue(locale);
      expect(await projectFile()).toEqual(persisted);
      await activate(page, button("Экраны"));
      const screen = page.getByRole("combobox", { name: t("Экран"), exact: true });
      await activate(page, screen);
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await expect(screen).toBeFocused();
      await activate(page, layerAgain);
      await expect(properties).toContainText(proposalText);
      await audit(page, `${locale} reopened persisted layer/light`);
      await testInfo.attach("keyboard-audit", { body: JSON.stringify({ locale, browser: page.context().browser()?.version(), projectRevision: persisted.revision, processRestart: true, screenReader: "not run" }, null, 2), contentType: "application/json" });
    } finally {
      await page.goto("about:blank");
      await stopFixture(server.child);
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
}

// Theme and locale are fixture setup here, not evidence of native-select
// keyboard behavior. macOS headless Chromium does not drive its OS popup.
for (const locale of ["ru", "en"] as const) {
  test(`${locale}: dark contrast audit of catalog, modal and handoff`, async ({ page }) => {
    await page.addInitScript(({ themeKey, localeKey, locale }) => {
      localStorage.setItem(themeKey, "dark");
      localStorage.setItem(localeKey, locale);
    }, { themeKey: STUDIO_THEME_KEY, localeKey: STUDIO_LOCALE_KEY, locale });
    const t = (source: string) => translate(locale, source);
    const button = (source: string) => page.getByRole("button", { name: t(source), exact: true });
    await page.goto("/");
    await expect(button("Управлять группами")).toBeVisible();
    await expect(page.getByLabel(t("Тема студии"), { exact: true })).toHaveValue("dark");
    await audit(page, `${locale} catalog/dark`);
    await activate(page, button("Управлять группами"));
    await expect(page.getByRole("dialog", { name: t("Управление группами"), exact: true })).toBeVisible();
    await audit(page, `${locale} group dialog/dark`);
    await page.keyboard.press("Escape");
    await activate(page, button("Экраны"));
    await activate(page, page.locator(".layer-row").first().getByRole("button"));
    await activate(page, page.locator("summary").filter({ hasText: t("Inspect и экспорт React") }));
    await activate(page, button("Подготовить экспорт экрана"));
    await expect(button("Скачать React ZIP")).toBeVisible();
    await audit(page, `${locale} selected layer/inspector/handoff/dark`);
  });
}
