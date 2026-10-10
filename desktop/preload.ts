import { contextBridge, ipcRenderer } from "electron";
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("studioDesktop", {
    setLocale: (locale: "ru" | "en") =>
      ipcRenderer.invoke("studio:locale", locale),
    recent: () => ipcRenderer.invoke("studio:recent"),
    create: (name: string) => ipcRenderer.invoke("studio:create", name),
    open: () => ipcRenderer.invoke("studio:open"),
    example: () => ipcRenderer.invoke("studio:example"),
    reopen: (root: string) => ipcRenderer.invoke("studio:reopen", root),
    home: () => ipcRenderer.invoke("studio:home"),
    library: () => ipcRenderer.invoke("studio:library"),
    configureLibrary: () => ipcRenderer.invoke("studio:configureLibrary"),
    clearLibrary: () => ipcRenderer.invoke("studio:clearLibrary"),
    status: () => ipcRenderer.invoke("studio:status"),
  });
}
