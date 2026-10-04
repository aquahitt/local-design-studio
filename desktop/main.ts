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
import { join, resolve } from "node:path";
import {
  createDesktopHandler,
  STUDIO_ORIGIN,
  type DesktopSession,
} from "./protocol";
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
let session: (DesktopSession & { root: string; name: string }) | undefined;
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
    return Promise.reject(new Error("Сервис остановлен. Перезапусти студию."));
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = ["recent", "status"].includes(action)
      ? setTimeout(() => {
          pending.delete(id);
          reject(new Error("Сервис не ответил вовремя. Перезапусти студию."));
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
async function open(root: string, create = false, name?: string) {
  session = await call("open", root, { create, name });
  return { root: session!.root, name: session!.name };
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
          env: { ...process.env, STUDIO_LIBRARY_ROOT: "", STUDIO_PROJECT: "" },
        },
      );
      worker.stderr?.on("data", (chunk) => console.error(String(chunk)));
      worker.on("message", (message) => {
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
          value.reject(new Error("Сервис завершился. Перезапусти студию."));
        }
        pending.clear();
        if (!stopping && win)
          void dialog.showMessageBox(win, {
            type: "error",
            title: "Сервис остановлен",
            message:
              "Перезапусти студию. Сохранённые файлы проекта остаются на диске.",
          });
      });
      protocol.handle(
        "studio",
        createDesktopHandler(join(__dirname, "renderer"), () => session),
      );
      bind("recent", () => call("recent"));
      bind("status", () =>
        session ? { root: session.root, name: session.name } : null,
      );
      bind("open", async () => {
        const selected = await dialog.showOpenDialog(win!, {
          title: "Открыть папку проекта",
          properties: ["openDirectory"],
        });
        if (selected.canceled) return null;
        return open(selected.filePaths[0]);
      });
      bind("create", async (name: unknown) => {
        if (typeof name !== "string" || !name.trim() || name.length > 160)
          throw new Error("Укажи название проекта (до 160 символов).");
        const selected = await dialog.showOpenDialog(win!, {
          title: "Выбери пустую папку для нового проекта",
          properties: ["openDirectory", "createDirectory"],
        });
        if (selected.canceled) return null;
        return open(selected.filePaths[0], true, name.trim());
      });
      bind("example", async () => {
        session = await call("example");
        return { root: session!.root, name: session!.name };
      });
      bind("reopen", async (root: unknown) => {
        if (typeof root !== "string") throw new Error("INVALID_PROJECT_PATH");
        const recent = await call("recent");
        if (!recent.some((p: any) => p.root === root))
          throw new Error("Выбери проект через «Открыть проект».");
        return open(root);
      });
      bind("home", async () => {
        await call("close");
        session = undefined;
        return null;
      });
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
            label: "Правка",
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
          { label: "Окно", submenu: [{ role: "minimize" }, { role: "close" }] },
        ]),
      );
      createWindow();
    })
    .catch(async (error) => {
      await dialog.showMessageBox({
        type: "error",
        message: "Не удалось открыть студию",
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
