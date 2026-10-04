import { contextBridge, ipcRenderer } from "electron";
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("studioDesktop", {
    recent: () => ipcRenderer.invoke("studio:recent"),
    create: (name: string) => ipcRenderer.invoke("studio:create", name),
    open: () => ipcRenderer.invoke("studio:open"),
    example: () => ipcRenderer.invoke("studio:example"),
    reopen: (root: string) => ipcRenderer.invoke("studio:reopen", root),
    home: () => ipcRenderer.invoke("studio:home"),
    status: () => ipcRenderer.invoke("studio:status"),
  });
}
