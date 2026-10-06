import { DesktopProjects } from "./project-manager";
import { DesktopLibraries, type DesktopLibraryBundle } from "./libraries";
import { join } from "node:path";
import { existsSync } from "node:fs";
const binary = join(
  __dirname,
  "vendor/esbuild/bin",
  process.platform === "win32" ? "esbuild.exe" : "esbuild",
).replace(/\.asar([\\/])/g, ".asar.unpacked$1");
if (existsSync(binary)) process.env.ESBUILD_BINARY_PATH = binary;
const libraries = new DesktopLibraries(process.argv[2]);
let bundle: DesktopLibraryBundle | undefined;
let libraryError: string | undefined;
let stagedBundle: DesktopLibraryBundle | undefined;
let renderId = 0;
const renders = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const projects = new DesktopProjects(process.argv[2], async (root) => {
  libraryError = undefined;
  try {
    bundle = stagedBundle ?? (await libraries.load(root));
    stagedBundle = undefined;
  } catch (error) {
    bundle = undefined;
    libraryError = (error as Error).message;
  }
  return bundle ? [bundle.metadata] : [];
}, (project, options) => new Promise((resolve, reject) => {
  const id = ++renderId;
  const timer = setTimeout(() => { renders.delete(id); reject(new Error("RENDER_TIMEOUT")); }, 25000);
  renders.set(id, { resolve, reject, timer });
  process.parentPort!.postMessage({ renderId: id, project, options });
}));
function projectResult() {
  return projects.current
    ? { ...projects.current, libraryBundle: bundle, libraryError }
    : null;
}
if (!process.parentPort) throw new Error("DESKTOP_PARENT_REQUIRED");
let queue = Promise.resolve();
process.parentPort.on("message", ({ data }) => {
  if (data.renderId !== undefined) {
    const render = renders.get(data.renderId);
    if (render) { clearTimeout(render.timer); renders.delete(data.renderId); data.error ? render.reject(new Error(data.error)) : render.resolve(data.result); }
    return;
  }
  queue = queue.then(async () => {
    const { id, action, args = [] } = data;
    try {
      let result: unknown;
      if (action === "open") {
        await projects.open(args[0], args[1]);
        result = projectResult();
      } else if (action === "example") {
        await projects.example();
        result = projectResult();
      } else if (action === "configureLibrary" || action === "clearLibrary") {
        const current = projects.current;
        if (!current) throw new Error("NO_PROJECT_OPEN");
        // Only the trusted main process can send this action, after native confirmation.
        if (action === "configureLibrary")
          stagedBundle = await libraries.configure(current.root, args[0], true);
        else await libraries.clear(current.root);
        await projects.close();
        bundle = undefined;
        await projects.open(current.root);
        result = projectResult();
      } else if (action === "recent") result = await projects.recent();
      else if (action === "close") {
        await projects.close();
        bundle = undefined;
        libraryError = undefined;
        result = null;
      } else if (action === "status") result = projects.current ?? null;
      else throw new Error("UNKNOWN_ACTION");
      process.parentPort!.postMessage({ id, result });
    } catch (e) {
      process.parentPort!.postMessage({ id, error: (e as Error).message });
    }
  });
});
process.parentPort.postMessage({ ready: true });
