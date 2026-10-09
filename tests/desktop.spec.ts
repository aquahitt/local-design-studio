import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { desktopRuntimeEnv, writeDesktopLibraryFixture, writeDesktopProjectFixture } from "./desktop-fixtures";
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
            chromiumSandbox: process.platform === "linux",
            env: { ...process.env, STUDIO_USER_DATA: join(temp, "settings") },
          }
        : {
            args: ["."],
            chromiumSandbox: process.platform === "linux",
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
    const bottom = await page.locator(".ds-nav-bottom").boundingBox();
    const viewportHeight = await page.evaluate(() => innerHeight);
    expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(viewportHeight);
    await page.getByLabel("Тема студии", { exact: true }).selectOption("dark");
    await expect(page.getByLabel("Тема проекта")).toHaveValue("light");
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await page
      .getByRole("button", { name: "Настройки устройства", exact: true })
      .click();
    await page.getByLabel("Тип устройства").selectOption("phone-pill");
    await expect(page.locator(".page-stage iframe")).toHaveCSS(
      "height",
      "756px",
    );
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(root, "project.json"), "utf8"))
            .pages[0].viewport.height,
      )
      .toBe(844);
    await page
      .getByRole("button", { name: "Управлять группами", exact: true })
      .click();
    await page.getByLabel("Название новой группы").fill("Desktop group");
    await page
      .getByRole("button", { name: "Создать группу", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Сохранить группы", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Управление группами" }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(root, "project.json"), "utf8"))
            .groups[0].name,
      )
      .toBe("Desktop group");
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
    await expect(
      page
        .frameLocator("iframe")
        .first()
        .getByText("Saved from desktop", { exact: true }),
    ).toBeVisible();
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
    const rendered = await page.evaluate(async () => {
      const session = await fetch("/api/session").then((response) => response.json());
      const headers = { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", "x-studio-ui-token": session.uiToken };
      const project = await fetch("/api/project", { headers }).then((response) => response.json());
      const response = await fetch("/api/render", { method: "POST", headers, body: JSON.stringify({ pageId: project.pages[0].screenId, revision: project.revision, viewport: { width: 390, height: 844 } }) });
      return { status: response.status, ...(await response.json()) };
    });
    expect(rendered.status).toBe(200);
    expect(rendered.mimeType).toBe("image/png");
    expect(rendered.data.length).toBeGreaterThan(100);
    expect(rendered.text).toContain("Saved from desktop");
    expect(rendered.bounds.some((bound: { id: string }) => bound.id === "demo-title")).toBe(true);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Desktop test", exact: false })
      .click();
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await page
      .getByRole("button", { name: "Настройки устройства", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Группа проекта", exact: true })
      .click();
    await expect(
      page
        .getByRole("listbox", { name: "Группа проекта", exact: true })
        .getByRole("option"),
    ).toContainText(["Все группы", "Без группы", "Desktop group"]);
    await page
      .getByLabel("Поиск: Группа проекта", { exact: true })
      .press("Escape");
    await expect(page.getByLabel("Тип устройства")).toHaveValue("phone-pill");
    await expect(page.getByLabel("Высота экрана")).toHaveValue("844");
    await expect(page.locator(".page-stage iframe")).toHaveCSS(
      "height",
      "756px",
    );
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


test("desktop installed MCP survives owner replacement, trusted library restart and offline review", async () => {
  test.setTimeout(150000);
  const temp = await mkdtemp(join(tmpdir(), "studio-installed-acceptance-"));
  const projectRoot = join(temp, "project");
  const libraryRoot = join(temp, "trusted-library");
  const settings = join(temp, "settings");
  const emptyPath = join(temp, "empty-path");
  const cwd = join(temp, "unrelated-cwd");
  await Promise.all([mkdir(projectRoot), mkdir(emptyPath), mkdir(cwd)]);
  await writeDesktopLibraryFixture(libraryRoot);
  await writeDesktopProjectFixture(projectRoot);
  const packaged = process.env.STUDIO_PACKAGED_EXECUTABLE;
  if (!packaged)
    execFileSync(process.execPath, ["scripts/desktop/build.mjs"], { stdio: "pipe" });
  const env = desktopRuntimeEnv(settings, emptyPath);
  const launch = () => electron.launch({
    ...(packaged ? { executablePath: packaged } : { args: [resolve(".")] }),
    chromiumSandbox: process.platform === "linux",
    cwd,
    env,
  });
  let app = await launch();
  const client = new Client({ name: "installed-acceptance", version: "1" });
  let standalone: Client | undefined;
  let connected = false;
  const offline = async () => app.evaluate(({ session }) => {
    // Block external Chromium requests, including screenshot windows. Loopback is local IO.
    (globalThis as any).__desktopExternalRequests = [];
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      (details, callback) => {
        const external = !["127.0.0.1", "localhost", "[::1]"].includes(new URL(details.url).hostname);
        if (external) (globalThis as any).__desktopExternalRequests.push(details.url);
        callback({ cancel: external });
      },
    );
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    expect(result.isError, content.find((item) => item.type === "text")?.text).not.toBe(true);
    return JSON.parse(content.find((item) => item.type === "text")!.text);
  };
  const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  try {
    await offline();
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, projectRoot);
    await page.getByRole("button", { name: "Открыть проект", exact: true }).click();
    await expect(page.getByText("Installed acceptance", { exact: true }).first()).toBeVisible();
    const executable = packaged ?? await app.evaluate(() => process.execPath);
    const helper = () => new StdioClientTransport({
      command: executable,
      args: [...(packaged ? [] : [resolve(".")]), "--studio-mcp", "--project", projectRoot],
      cwd,
      env,
      // Keep native bootstrap failures visible in cross-platform CI logs.
      stderr: "inherit",
    });
    await client.connect(helper());
    connected = true;
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("proposal_create");
    const initial = await call("project_read");
    const initialOwner = JSON.parse(await readFile(join(projectRoot, ".studio/connection.json"), "utf8"));
    const baseline = await call("components_list");
    expect(baseline.components.every((item: { libraryId: string }) => ["studio-ui", "builtin", "studio-example"].includes(item.libraryId))).toBe(true);
    expect(baseline.components.some((item: { libraryId: string }) => item.libraryId === "stroi-ui")).toBe(false);

    // Trust comes from the native operator confirmation, never from project.json.
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    }, libraryRoot);
    const beforeTrust = await readFile(join(projectRoot, "project.json"), "utf8");
    await page.getByRole("button", { name: "Подключить библиотеку", exact: true }).click();
    await expect(page.getByRole("button", { name: "Подключить библиотеку", exact: true })).toBeEnabled();
    expect(await readFile(join(projectRoot, "project.json"), "utf8")).toBe(beforeTrust);
    expect((await call("components_list", { libraryId: "stroi-ui" })).components).toHaveLength(0);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Подключить библиотеку", exact: true }).click();
    await expect(page.getByRole("button", { name: "Сменить библиотеку", exact: true })).toBeVisible();
    const libraryOwner = JSON.parse(await readFile(join(projectRoot, ".studio/connection.json"), "utf8"));
    expect(libraryOwner.url).not.toBe(initialOwner.url);
    expect(libraryOwner.token).not.toBe(initialOwner.token);
    // The same stdio client follows the changed owner/credentials (#58).
    const compact = await call("components_list", { libraryId: "stroi-ui", limit: 1 });
    expect(compact.components).toHaveLength(1);
    expect(compact.pagination.nextOffset).toBe(1);
    expect(Array.isArray(compact.components[0].fields)).toBe(true);
    expect(compact.components[0].defaultProps).toBeUndefined();
    const detail = await call("component_read", { libraryId: "stroi-ui", id: "Tabs" });
    expect(Object.keys(detail.fields).sort()).toEqual(["activationMode", "className", "size", "tabs", "triggerClassName", "value", "variant"].sort());
    const fixture = await call("component_read", { libraryId: "stroi-ui", id: "SegmentedControl" });
    expect(fixture.defaultProps.options.some((item: { code?: string }) => typeof item.code === "string")).toBe(true);
    const tabsProps = {
      value: "prices", variant: "pill", size: "sm", activationMode: "manual",
      className: "smoke-root", triggerClassName: "smoke-trigger",
      tabs: [
        { value: "photos", label: "Smoke photos", content: "Synthetic photos" },
        { value: "prices", label: "Smoke prices", content: "Synthetic prices" },
      ],
    };
    const tokens = Object.fromEntries(Array.from({ length: 139 }, (_, i) => [`smoke-token-${i}`, { type: "color", value: "#123456" }]));
    const proposal = await call("proposal_create", {
      description: "Installed agent review",
      batch: {
        requestId: "installed-agent-review", baseRevision: initial.revision,
        operations: [
          { type: "updateProps", nodeId: "demo-title", props: { children: "Installed MCP approved", variant: "body", tone: "primary" } },
          { type: "insertNode", pageId: initial.pages[0].screenId, index: 1, node: { id: "smoke-tabs", type: "Tabs", props: tabsProps, slots: {} } },
          { type: "insertNode", pageId: initial.pages[0].screenId, index: 2, node: { id: "smoke-options", type: "SegmentedControl", props: fixture.defaultProps, slots: {} } },
          { type: "setTokens", tokens },
        ],
      },
    });
    expect(proposal.status).toBe("pending");
    expect((await raw("proposal_apply", { id: proposal.id })).isError).toBe(true);
    expect(await readFile(join(projectRoot, "project.json"), "utf8")).toBe(beforeTrust);
    await page.getByRole("button", { name: "Предложения агента", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Installed agent review", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Подтвердить и применить", exact: true }).click();
    await expect.poll(async () => (await call("project_read")).revision).toBe(initial.revision + 1);
    await expect(page.getByTestId("save-status")).toContainText("Сохранено");
    const saved = await call("project_read");
    expect(saved.revision).toBe(initial.revision + 1);
    expect(Object.keys(saved.tokens)).toHaveLength(139);
    expect(saved.pages[0].nodes.find((node: { id: string }) => node.id === "smoke-options").props).toEqual(fixture.defaultProps);
    const pages = await call("pages_list");
    expect(pages.tokens).toBeUndefined();
    expect(JSON.stringify(pages).length).toBeLessThan(2000);
    expect((await call("document_read", { pageId: initial.pages[0].screenId })).tokens).toBeUndefined();
    // Executable props remain denied and errors retain their full path (#59).
    for (const field of ["onClick", "dangerouslySetInnerHTML"]) {
      const invalid = await raw("proposal_create", { batch: { requestId: "unsafe-" + field, baseRevision: saved.revision, operations: [{ type: "updateProps", nodeId: "demo-title", props: { [field]: "unsafe" } }] } });
      expect(invalid.isError).toBe(true);
      const error = JSON.parse((invalid.content as { text: string }[])[0].text);
      expect(error.error).toBe("EXECUTABLE_FIELD");
      expect(error.path).toBe(`pages[0].nodes[0].props.${field}`);
    }
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    const preview = page.frameLocator(".page-stage iframe");
    await expect(preview.getByRole("tab")).toHaveText(["Smoke photos", "Smoke prices"]);
    await expect(preview.getByRole("tabpanel")).toHaveText("Synthetic prices");
    await expect(preview.locator(".smoke-root")).toHaveAttribute("data-size", "sm");
    await expect(preview.locator(".smoke-root")).toHaveAttribute("data-activation", "manual");
    await expect(preview.getByRole("tab").first()).toHaveClass("smoke-trigger");
    await page.getByRole("button", { name: "Выделить smoke-tabs", exact: true }).click();
    await page.getByLabel("Свойства JSON").fill(JSON.stringify({ ...tabsProps, size: "md" }));
    await page.getByRole("button", { name: "Применить свойства", exact: true }).click();
    await expect(preview.locator(".smoke-root")).toHaveAttribute("data-size", "md");
    const current = await call("project_read");
    const rendered = await raw("document_render", { pageId: initial.pages[0].screenId, revision: current.revision, viewport: { width: 390, height: 600 } });
    expect(rendered.isError, JSON.stringify((rendered.content as { type: string; text?: string }[]).filter((item) => item.type === "text"))).not.toBe(true);
    const image = (rendered.content as { type: string; mimeType: string; data: string }[]).find((item) => item.type === "image")!;
    expect(image.mimeType).toBe("image/png");
    const png = Buffer.from(image.data, "base64");
    const renderMetadata = JSON.parse((rendered.content as { type: string; text: string }[]).find((item) => item.type === "text")!.text);
    expect(renderMetadata.viewport).toEqual({ width: 390, height: 600 });
    expect(renderMetadata.text).toContain("Installed MCP approved");
    expect(renderMetadata.warnings).toEqual([]);
    expect(renderMetadata.bounds.map((bound: { id: string }) => bound.id)).toContain("smoke-tabs");
    expect(png.readUInt32BE(16)).toBe(390);
    expect(png.readUInt32BE(20)).toBe(600);
    const cropped = await raw("document_render", { pageId: initial.pages[0].screenId, revision: current.revision, nodeId: "smoke-tabs", viewport: { width: 390, height: 600 } });
    expect(cropped.isError, JSON.stringify((cropped.content as { type: string; text?: string }[]).filter((item) => item.type === "text"))).not.toBe(true);
    const croppedContent = cropped.content as { type: string; text: string; data: string }[];
    const croppedMetadata = JSON.parse(croppedContent.find((item) => item.type === "text")!.text);
    const croppedBound = croppedMetadata.bounds.find((bound: { id: string }) => bound.id === "smoke-tabs");
    const croppedPng = Buffer.from(croppedContent.find((item) => item.type === "image")!.data, "base64");
    expect(croppedPng.readUInt32BE(16)).toBe(Math.ceil(croppedBound.width));
    expect(croppedPng.readUInt32BE(20)).toBe(Math.ceil(croppedBound.height));
    const handoff = await call("react_export", { pageId: initial.pages[0].screenId, revision: current.revision });
    expect(handoff.files["Screen.tsx"]).toContain("Installed MCP approved");
    expect(handoff.files["tokens.json"]).toBeDefined();
    const connection = await readFile(join(projectRoot, ".studio/connection.json"), "utf8");
    // A second installed MCP attaches to the same owner without replacing its credentials.
    standalone = new Client({ name: "second-installed-helper", version: "1" });
    await standalone.connect(helper());
    expect((await standalone.callTool({ name: "project_read", arguments: {} })).isError).not.toBe(true);
    expect(await readFile(join(projectRoot, ".studio/connection.json"), "utf8")).toBe(connection);
    await standalone.close();
    standalone = undefined;
    expect(await app.evaluate(() => (globalThis as any).__desktopExternalRequests)).toEqual([]);
    await app.close();
    const missing = await raw("project_read");
    expect(missing.isError).toBe(true);
    expect(JSON.parse((missing.content as { text: string }[])[0].text).error).toBe("OWNER_NOT_RUNNING");
    app = await launch();
    await offline();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Installed acceptance", exact: false }).click();
    await expect(page.getByRole("button", { name: "Сменить библиотеку", exact: true })).toBeVisible();
    // Neither restarting desktop nor its library compiler requires restarting the MCP client.
    expect((await call("project_read")).revision).toBe(current.revision);
    expect((await call("components_list", { libraryId: "stroi-ui" })).components.map((item: { id: string }) => item.id)).toContain("Tabs");
    await page.getByRole("button", { name: "Экраны", exact: true }).click();
    await expect(page.frameLocator(".page-stage iframe").locator(".smoke-root")).toHaveAttribute("data-size", "md");
    expect(await app.evaluate(() => (globalThis as any).__desktopExternalRequests)).toEqual([]);
    const document = await readFile(join(projectRoot, "project.json"), "utf8");
    const canonicalLibrary = await realpath(libraryRoot);
    expect(document).not.toContain(JSON.stringify(libraryRoot));
    expect(document).not.toContain(JSON.stringify(canonicalLibrary));
    const preferences = JSON.parse(await readFile(join(settings, "libraries.json"), "utf8"));
    expect(preferences[await realpath(projectRoot)]).toBe(canonicalLibrary);
  } finally {
    await standalone?.close();
    if (connected) await client.close();
    await app.close().catch(() => {});
    await rm(temp, { recursive: true, force: true });
  }
});
