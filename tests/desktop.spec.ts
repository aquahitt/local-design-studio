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
    // Edit geometry crosses the isolated preview origin through the bounded bridge.
    const beforeCamera = await readFile(join(root, "project.json"), "utf8");
    await page.getByRole("button", {name:"Редактирование холста",exact:true}).click();
    const canvas = page.getByRole("region", {name:"Свободный холст",exact:true});
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const canvasNode = page.frameLocator(".page-stage iframe").locator('[data-node-id="demo-title"]');
    await expect(canvasNode).toBeVisible();
    const nodeBox = (await canvasNode.boundingBox())!;
    await page.mouse.click(nodeBox.x+nodeBox.width/2,nodeBox.y+nodeBox.height/2);
    await expect(page.getByTestId("selection")).toContainText("demo-title");
    await expect(canvas.locator('..').getByRole('alert')).toHaveCount(0);
    await expect.poll(()=>page.evaluate(async()=>{
      const session=await fetch('/api/session').then(r=>r.json());
      const result=await fetch('/api/context',{headers:{Authorization:`Bearer ${session.token}`}}).then(r=>r.json());
      return result.context?.surfaceMode==='edit' && result.context?.camera?.revision===result.context?.revision && result.context?.camera?.bounds.some((b:{id:string})=>b.id==='demo-title');
    }),{timeout:10000}).toBe(true);
    const pan=Number(await canvas.getAttribute('data-pan-x'));
    await canvas.dispatchEvent('wheel',{deltaX:45,deltaY:0});
    await expect.poll(async()=>Number(await canvas.getAttribute('data-pan-x'))).toBeCloseTo(pan-45);
    expect(await readFile(join(root,"project.json"),"utf8")).toBe(beforeCamera);
    await page.getByRole("button", {name:"Просмотр экрана",exact:true}).click();
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


test("desktop installed MCP survives owner replacement, trusted library restart and offline review", async ({}, testInfo) => {
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
  let captureDiagnostics = "";
  const launch = async () => {
    const launched = await electron.launch({
    ...(packaged ? { executablePath: packaged } : { args: [resolve(".")] }),
    chromiumSandbox: process.platform === "linux",
    cwd,
    env: {...env, STUDIO_CAPTURE_DIAGNOSTICS: "1"},
  });
    launched.on("console", async message => {
      if (!message.text().startsWith("Studio capture")) return;
      const values = await Promise.all(message.args().map(argument => argument.jsonValue().catch(() => "[closed]")));
      captureDiagnostics = (captureDiagnostics + values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ") + "\n").slice(-12000);
    });
    launched.process().stderr?.on("data", chunk => {
      captureDiagnostics = (captureDiagnostics + String(chunk)).slice(-12000);
    });
    return launched;
  };
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
          { type: "insertNode", pageId: initial.pages[0].screenId, index: 3, node: {
            id: "smoke-painted-frame", type: "SceneFrame", props: {}, slots: {},
            scene: { kind: "frame", x: 230, y: 380, width: 100, height: 100,
              fill: "#00ff00", stroke: "#123456", strokeWidth: 4,
              fills: [{ id: "desktop-gradient", kind: "linear", angle: 90, stops: [
                { offset: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
                { offset: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
              ] }],
              shadows: [{ id: "desktop-shadow", kind: "outer", x: 0, y: 4,
                blur: 0, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.5 } }],
            },
          } },
          ...[
            [-550.25, -400.5],
            [6000.25, 7000.5],
          ].map(([x, y], i) => ({
            type: "insertNode",
            pageId: initial.pages[0].screenId,
            index: 4 + i,
            node: {
              id: "remote-capture-" + i,
              type: "SceneFrame",
              props: {},
              slots: {},
              scene: {
                kind: "frame",
                x,
                y,
                width: 80.5,
                height: 60.25,
                fill: "#ff0000",
              },
            },
          })),
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
    // Reproduce a busy/hidden compositor deterministically: the previous 100ms
    // snapshot resend cancelled both readiness frames forever at this cadence.
    await app.evaluate(({ app }) => {
      (globalThis as any).__slowSnapshotFramesInstalled = 0;
      app.on("web-contents-created", (_event, contents) => {
        contents.once("dom-ready", () => {
          if (contents.getURL() !== "studio://preview/preview") return;
          void contents.executeJavaScript(`(() => {
            const viewportGuard = document.createElement("style");
            viewportGuard.textContent = '@media (max-width:100px){[data-node-id^="remote-capture-"]{background:rgb(0,255,0)!important}}';
            document.head.append(viewportGuard);
            const request = window.requestAnimationFrame.bind(window);
            const cancel = window.cancelAnimationFrame.bind(window);
            const pending = new Map();
            let nextId = 0;
            window.requestAnimationFrame = callback => {
              const id = ++nextId;
              const timer = setTimeout(() => {
                const nativeId = request(time => { pending.delete(id); callback(time); });
                pending.set(id, { nativeId });
              }, 220);
              pending.set(id, { timer });
              return id;
            };
            window.cancelAnimationFrame = id => {
              const entry = pending.get(id);
              if (!entry) return;
              if (entry.timer !== undefined) clearTimeout(entry.timer);
              if (entry.nativeId !== undefined) cancel(entry.nativeId);
              pending.delete(id);
            };
          })()`).then(() => { (globalThis as any).__slowSnapshotFramesInstalled++; });
        });
      });
    });
    const rendered = await raw("document_render", { pageId: initial.pages[0].screenId, revision: current.revision, viewport: { width: 390, height: 600 } });
    expect(rendered.isError, JSON.stringify((rendered.content as { type: string; text?: string }[]).filter((item) => item.type === "text"))).not.toBe(true);
    const image = (rendered.content as { type: string; mimeType: string; data: string }[]).find((item) => item.type === "image")!;
    expect(image.mimeType).toBe("image/png");
    const png = Buffer.from(image.data, "base64");
    const renderMetadata = JSON.parse((rendered.content as { type: string; text: string }[]).find((item) => item.type === "text")!.text);
    expect(await app.evaluate(() => (globalThis as any).__slowSnapshotFramesInstalled)).toBe(1);
    expect(await app.evaluate(() => (globalThis as any).__studioCaptureDiagnostics?.some((row: {stage:string}) => row.stage === "complete"))).toBe(true);
    expect(renderMetadata.viewport).toEqual({ width: 390, height: 600 });
    expect(renderMetadata.text).toContain("Installed MCP approved");
    expect(renderMetadata.warnings).toEqual([]);
    expect(renderMetadata.bounds.map((bound: { id: string }) => bound.id)).toContain("smoke-tabs");
    expect(png.readUInt32BE(16)).toBe(390);
    expect(png.readUInt32BE(20)).toBe(600);
    const paintStyles = renderMetadata.computedStyles.find((row: { id: string }) => row.id === "smoke-painted-frame").layout;
    expect(paintStyles["background-image"]).toContain("linear-gradient(90deg");
    expect(paintStyles["box-shadow"]).toContain("inset");
    expect(paintStyles["box-shadow"]).toContain("0px 4px");
    // Decode the actual native screenshot in the renderer. The center must be
    // purple from red/blue paint, rather than the old green legacy fill.
    const paintPixel = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = "data:image/png;base64," + data;
      await image.decode();
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(300, 450, 1, 1).data);
    }, image.data);
    expect(paintPixel[0]).toBeGreaterThanOrEqual(124);
    expect(paintPixel[0]).toBeLessThanOrEqual(130);
    expect(paintPixel[1]).toBe(0);
    expect(paintPixel[2]).toBeGreaterThanOrEqual(124);
    expect(paintPixel[2]).toBeLessThanOrEqual(130);
    expect(paintPixel[3]).toBe(255);

    const cropped = await raw("document_render", { pageId: initial.pages[0].screenId, revision: current.revision, nodeId: "smoke-tabs", viewport: { width: 390, height: 600 } });
    expect(cropped.isError, JSON.stringify((cropped.content as { type: string; text?: string }[]).filter((item) => item.type === "text"))).not.toBe(true);
    const croppedContent = cropped.content as { type: string; text: string; data: string }[];
    const croppedMetadata = JSON.parse(croppedContent.find((item) => item.type === "text")!.text);
    const croppedBound = croppedMetadata.bounds.find((bound: { id: string }) => bound.id === "smoke-tabs");
    const croppedPng = Buffer.from(croppedContent.find((item) => item.type === "image")!.data, "base64");
    expect(croppedPng.readUInt32BE(16)).toBe(Math.ceil(croppedBound.width));
    expect(croppedPng.readUInt32BE(20)).toBe(Math.ceil(croppedBound.height));
    for (let i = 0; i < 2; i++) {
      const remote = await raw("document_render", {
        pageId: initial.pages[0].screenId,
        revision: current.revision,
        nodeId: "remote-capture-" + i,
        viewport: { width: 390, height: 600 },
      });
      expect(remote.isError, JSON.stringify(remote.content)).not.toBe(true);
      const content = remote.content as {
        type: string;
        text: string;
        data: string;
      }[];
      const metadata = JSON.parse(
        content.find((item) => item.type === "text")!.text,
      );
      const bound = metadata.bounds.find(
        (row: { id: string }) => row.id === "remote-capture-" + i,
      );
      expect(bound.x).toBeCloseTo((i ? 6000.25 : -550.25) + 20);
      expect(bound.y).toBeCloseTo((i ? 7000.5 : -400.5) + 20);
      expect(metadata.viewport).toEqual({ width: 390, height: 600 });
      const pixels = await page.evaluate(
        async (data) => {
          const image = new Image();
          image.src = "data:image/png;base64," + data;
          await image.decode();
          const canvas = globalThis.document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          return {
            width: image.naturalWidth,
            height: image.naturalHeight,
            center: Array.from(context.getImageData(40, 30, 1, 1).data),
          };
        },
        content.find((item) => item.type === "image")!.data,
      );
      expect(pixels).toEqual({
        width: 81,
        height: 61,
        center: [255, 0, 0, 255],
      });
    }
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
    const stages = await app.evaluate(() => (globalThis as any).__studioCaptureDiagnostics ?? []).catch(() => []);
    if (stages.length) console.error("Studio capture stages:", JSON.stringify(stages));
    await testInfo.attach("desktop-capture-diagnostics", {body: captureDiagnostics,contentType:"text/plain"});
    if (testInfo.status !== testInfo.expectedStatus) console.error(captureDiagnostics);

    await standalone?.close();
    if (connected) await client.close();
    await app.close().catch(() => {});
    await rm(temp, { recursive: true, force: true });
  }
});
