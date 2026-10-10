import { translate } from "../src/studio/locales";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  utilityProcess,
  Menu,
} from "electron";
import { spawn } from "node:child_process";
import { desktopMcpArgs } from "./cli";
import { captureDesktopSnapshot } from "./render";
import type { DesktopLibraryBundle } from "./libraries";
import { join, resolve } from "node:path";
import {
  createDesktopHandler,
  STUDIO_ORIGIN,
  type DesktopSession,
} from "./protocol";
function startDesktop() {
  let nativeLocale: "ru" | "en" = "ru";
  const t = (source: string) => translate(nativeLocale, source);
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "studio",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
  if (process.env.STUDIO_USER_DATA)
    app.setPath("userData", resolve(process.env.STUDIO_USER_DATA));
  let win: BrowserWindow | undefined;
  let worker: Electron.UtilityProcess | undefined;
  let session:
    | (DesktopSession & {
        root: string;
        name: string;
        libraryBundle?: DesktopLibraryBundle;
        libraryError?: string;
      })
    | undefined;
  let stopping = false;
  let counter = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  function call(action: string, ...args: unknown[]): Promise<any> {
    if (!worker)
      return Promise.reject(
        new Error(t("Сервис остановлен. Перезапусти студию.")),
      );
    return new Promise((resolve, reject) => {
      const id = ++counter;
      const timer = ["recent", "status"].includes(action)
        ? setTimeout(() => {
            pending.delete(id);
            reject(
              new Error(t("Сервис не ответил вовремя. Перезапусти студию.")),
            );
          }, 20000)
        : undefined;
      pending.set(id, { resolve, reject, timer });
      worker!.postMessage({ id, action, args });
    });
  }
  function trusted(event: Electron.IpcMainInvokeEvent) {
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url !== STUDIO_ORIGIN + "/"
    )
      throw new Error("INVALID_DESKTOP_SENDER");
  }
  let transitions = Promise.resolve();
  const transition = <T>(task: () => Promise<T>) => {
    const next = transitions.then(task);
    transitions = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  function bind(channel: string, fn: (...args: any[]) => unknown) {
    ipcMain.handle("studio:" + channel, async (event, ...args) => {
      trusted(event);
      return transition(async () => fn(...args));
    });
  }
  function libraryResult() {
    const bundle = session?.libraryBundle;
    return bundle
      ? {
          metadata: bundle.metadata,
          bundleUrl: `studio://preview/library/${bundle.id}/library.js`,
          cssUrl: `studio://preview/library/${bundle.id}/library.css`,
        }
      : null;
  }
  function projectResult() {
    return session
      ? {
          root: session.root,
          name: session.name,
          library: libraryResult() ?? undefined,
          libraryError: session.libraryError,
        }
      : null;
  }
  async function open(root: string, create = false, name?: string) {
    session = await call("open", root, { create, name });
    return projectResult();
  }
  function createWindow() {
    win = new BrowserWindow({
      width: 1440,
      height: 980,
      minWidth: 900,
      minHeight: 650,
      title: "Local Design Studio",
      show: false,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
      },
    });
    win.once("ready-to-show", () => win!.show());
    win.webContents.on("will-navigate", (e, url) => {
      if (url !== STUDIO_ORIGIN + "/") e.preventDefault();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/github\.com\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    win.on("closed", () => {
      win = undefined;
    });
    void win.loadURL(STUDIO_ORIGIN + "/");
  }
  const lock = app.requestSingleInstanceLock();
  if (!lock) app.quit();
  else {
    app.on("second-instance", () => {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
    app
      .whenReady()
      .then(async () => {
        worker = utilityProcess.fork(
          join(__dirname, "worker.cjs"),
          [app.getPath("userData")],
          {
            serviceName: "Studio project service",
            stdio: "pipe",
            env: {
              ...process.env,
              STUDIO_LIBRARY_ROOT: "",
              STUDIO_PROJECT: "",
            },
          },
        );
        worker.stderr?.on("data", (chunk) => console.error(String(chunk)));
        worker.on("message", (message) => {
          if (message.renderId !== undefined) {
            void captureDesktopSnapshot(
              message.project,
              message.options,
              libraryResult() ?? undefined,
            ).then(
              (result) =>
                worker?.postMessage({ renderId: message.renderId, result }),
              (error) =>
                worker?.postMessage({
                  renderId: message.renderId,
                  error: error.message,
                }),
            );
            return;
          }
          const request = pending.get(message.id);
          if (!request) return;
          if (request.timer) clearTimeout(request.timer);
          pending.delete(message.id);
          if (message.error) request.reject(new Error(message.error));
          else request.resolve(message.result);
        });
        worker.on("exit", () => {
          worker = undefined;
          session = undefined;
          for (const value of pending.values()) {
            if (value.timer) clearTimeout(value.timer);
            value.reject(
              new Error(t("Сервис завершился. Перезапусти студию.")),
            );
          }
          pending.clear();
          if (!stopping && win)
            void dialog.showMessageBox(win, {
              type: "error",
              title: t("Сервис остановлен"),
              message: t(
                "Перезапусти студию. Сохранённые файлы проекта остаются на диске.",
              ),
            });
        });
        protocol.handle(
          "studio",
          createDesktopHandler(
            join(__dirname, "renderer"),
            () => session,
            fetch,
            () => session?.libraryBundle,
          ),
        );
        bind("locale", (locale: unknown) => {
          if (locale !== "ru" && locale !== "en")
            throw new Error("INVALID_LOCALE");
          nativeLocale = locale;
          setMenu();
          return null;
        });
        bind("recent", () => call("recent"));
        bind("status", projectResult);
        bind("library", libraryResult);
        bind("configureLibrary", async () => {
          if (!session) throw new Error("NO_PROJECT_OPEN");
          const selected = await dialog.showOpenDialog(win!, {
            title: t("Выбери папку React-библиотеки"),
            properties: ["openDirectory"],
          });
          if (selected.canceled) return null;
          const root = selected.filePaths[0];
          const confirmation = await dialog.showMessageBox(win!, {
            type: "warning",
            title: t("Доверять библиотеке?"),
            message: t(
              "Компоненты этой папки будут выполняться в изолированном превью.",
            ),
            detail:
              root +
              t(
                "\nПодключай только исходники, которым доверяешь. Разрешение сохранится для этого проекта в настройках приложения.",
              ),
            buttons: [t("Отмена"), t("Доверять и подключить")],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (confirmation.response !== 1) return null;
          session = await call("configureLibrary", root);
          return projectResult();
        });
        bind("clearLibrary", async () => {
          if (!session) throw new Error("NO_PROJECT_OPEN");
          session = await call("clearLibrary");
          return projectResult();
        });
        bind("open", async () => {
          const selected = await dialog.showOpenDialog(win!, {
            title: t("Открыть папку проекта"),
            properties: ["openDirectory"],
          });
          if (selected.canceled) return null;
          return open(selected.filePaths[0]);
        });
        bind("create", async (name: unknown) => {
          if (typeof name !== "string" || !name.trim() || name.length > 160)
            throw new Error(t("Укажи название проекта (до 160 символов)."));
          const selected = await dialog.showOpenDialog(win!, {
            title: t("Выбери пустую папку для нового проекта"),
            properties: ["openDirectory", "createDirectory"],
          });
          if (selected.canceled) return null;
          return open(selected.filePaths[0], true, name.trim());
        });
        bind("example", async () => {
          session = await call("example");
          return projectResult();
        });
        bind("reopen", async (root: unknown) => {
          if (typeof root !== "string") throw new Error("INVALID_PROJECT_PATH");
          const recent = await call("recent");
          if (!recent.some((p: any) => p.root === root))
            throw new Error(t("Выбери проект через «Открыть проект»."));
          return open(root);
        });
        bind("home", async () => {
          await call("close");
          session = undefined;
          return null;
        });
        function setMenu() {
          Menu.setApplicationMenu(
            Menu.buildFromTemplate([
              ...(process.platform === "darwin"
                ? [
                    {
                      label: app.name,
                      submenu: [
                        { role: "about" as const },
                        { type: "separator" as const },
                        { role: "quit" as const },
                      ],
                    },
                  ]
                : []),
              {
                label: t("Правка"),
                submenu: [
                  { role: "undo" },
                  { role: "redo" },
                  { type: "separator" },
                  { role: "cut" },
                  { role: "copy" },
                  { role: "paste" },
                  { role: "selectAll" },
                ],
              },
              {
                label: t("Окно"),
                submenu: [{ role: "minimize" }, { role: "close" }],
              },
            ]),
          );
        }
        setMenu();
        createWindow();
      })
      .catch(async (error) => {
        await dialog.showMessageBox({
          type: "error",
          message: t("Не удалось открыть студию"),
          detail: String(error),
        });
        app.quit();
      });
    app.on("activate", () => {
      if (!win && !stopping && worker) createWindow();
    });
    app.on("window-all-closed", () => app.quit());
    app.on("before-quit", (event) => {
      if (stopping) return;
      event.preventDefault();
      stopping = true;
      void transition(async () => {
        if (worker) await call("close");
      })
        .catch(console.error)
        .finally(() => {
          worker?.kill();
          app.quit();
        });
    });
  }
}
try {
  const mcpArgs = desktopMcpArgs(process.argv);
  if (mcpArgs) {
    const entry = join(__dirname, "mcp/studio-mcp.mjs").replace(
      /\.asar([\\/])/g,
      ".asar.unpacked$1",
    );
    const child = spawn(process.execPath, [entry, ...mcpArgs], {
      stdio: "inherit",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        STUDIO_LIBRARY_ROOT: "",
        STUDIO_PROJECT: "",
        STUDIO_AUTO_APPLY: "",
      },
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => child.kill(signal));
    child.on("error", (error) => {
      console.error(error.message);
      app.exit(1);
    });
    child.on("exit", (code) => app.exit(code ?? 1));
  } else startDesktop();
} catch (error) {
  console.error((error as Error).message);
  app.exit(2);
}
