import { DesktopProjects } from "./project-manager";
const projects = new DesktopProjects(process.argv[2]);
if (!process.parentPort) throw new Error("DESKTOP_PARENT_REQUIRED");
let queue = Promise.resolve();
process.parentPort.on("message", ({ data }) => {
  queue = queue.then(async () => {
    const { id, action, args = [] } = data;
    try {
      let result: unknown;
      if (action === "open") result = await projects.open(args[0], args[1]);
      else if (action === "example") result = await projects.example();
      else if (action === "recent") result = await projects.recent();
      else if (action === "close") {
        await projects.close();
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
