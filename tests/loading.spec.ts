import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseProject } from "../src/core/project";
import { ProjectStore } from "../src/core/store";

test.skip(!!process.env.STUDIO_LIBRARY_ROOT, "Generic fixture suite");

async function startFixture(root: string) {
  const url = "http://127.0.0.1:5231";
  const child = spawn(
    process.execPath,
    [resolve("node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5231", "--strictPort"],
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
  child.stdout?.on("data", (chunk) => {
    output = (output + chunk).slice(-6000);
  });
  child.stderr?.on("data", (chunk) => {
    output = (output + chunk).slice(-6000);
  });
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null)
        throw new Error(`Fixture server stopped: ${output}`);
      return fetch(url + "/api/session")
        .then((response) => response.ok)
        .catch(() => false);
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
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}

for (const pendingPath of ["session", "project"] as const) {
  test(`cancel pending ${pendingPath}, retry and preserve the source project`, async ({ page }) => {
    test.setTimeout(60000);
    const root = await mkdtemp(join(tmpdir(), "studio-loading-"));
    const source = parseProject({
      schemaVersion: 2,
      projectId: "loading-fixture",
      name: "Исходный проект",
      revision: 7,
      library: { id: "builtin", version: "1" },
      theme: "light",
      tokens: {},
      pages: [{
        screenId: "home",
        name: "Исходный экран",
        viewport: { width: 800 },
        nodes: [{
          id: "intro",
          type: "Text",
          props: { text: "Сохранённый текст" },
          slots: {},
        }],
      }],
    });
    const owner = await ProjectStore.open(root, { initialProject: source });
    await owner.close();
    await mkdir(join(root, "assets"), { recursive: true });
    await mkdir(join(root, "fixtures"), { recursive: true });
    await writeFile(join(root, "assets", "source.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(root, "fixtures", "source.json"), '{"text":"Локальные данные"}\n');
    const paths = ["project.json", "assets/source.svg", "fixtures/source.json"];
    const snapshot = () => Promise.all(paths.map((path) => readFile(join(root, path))));
    const before = await snapshot();
    let server: Awaited<ReturnType<typeof startFixture>> | undefined;
    let release = () => {};
    try {
      server = await startFixture(root);
      let entered = () => {};
      const intercepted = new Promise<void>((resolveEntered) => {
        entered = resolveEntered;
      });
      const held = new Promise<void>((resolveHeld) => {
        release = resolveHeld;
      });
      let attempts = 0;
      let projectReads = 0;
      let operations = 0;
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path === "/api/project") projectReads++;
        if (path === "/api/operations" && request.method() === "POST") operations++;
      });
      await page.route(`**/api/${pendingPath}`, async (route) => {
        if (++attempts === 1) {
          entered();
          await held;
        }
        await route.continue().catch(() => {}); // The cancelled request may already be gone.
      });
      await page.goto(server.url);
      await intercepted;
      await page.getByRole("button", { name: "Отменить загрузку", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Загрузка отменена. Файлы проекта сохранены.");
      await expect(page.getByRole("button", { name: "Повторить загрузку", exact: true })).toBeVisible();
      expect(projectReads).toBe(pendingPath === "session" ? 0 : 1);
      expect(operations).toBe(0);
      expect(await snapshot()).toEqual(before);

      // Retry succeeds while the cancelled response is still held; releasing it
      // afterwards must not replace the accepted project or show a stale error.
      await page.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Библиотека компонентов", exact: true })).toBeVisible();
      release();
      await page.unrouteAll({ behavior: "wait" });
      await expect(page.getByTestId("save-status")).toContainText("ревизия 7");
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(operations).toBe(0);
      expect(await snapshot()).toEqual(before);
      expect(JSON.parse((await readFile(join(root, "project.json"), "utf8"))).revision).toBe(7);
    } finally {
      release();
      await page.close();
      if (server) await stopFixture(server.child);
      await rm(root, { recursive: true, force: true });
    }
  });
}
