import type { ChildProcess } from "node:child_process";

/** Cleanup for a caller-owned temporary fixture, not a product shutdown gate.
 * Never consider a sent signal proof of exit; boundedly await the exit event. */
export async function stopFixtureProcess(
  child: ChildProcess,
): Promise<"exited" | "terminated" | "killed"> {
  if (child.exitCode !== null || child.signalCode !== null) return "exited";
  return new Promise((resolve, reject) => {
    let forced = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(graceTimer);
      if (killTimer) clearTimeout(killTimer);
      child.removeListener("exit", exited);
    };
    const exited = () => {
      cleanup();
      resolve(forced ? "killed" : "terminated");
    };
    const graceTimer = setTimeout(() => {
      forced = true;
      killTimer = setTimeout(() => {
        cleanup();
        reject(new Error("Fixture process did not exit after SIGKILL"));
      }, 5000);
      child.kill("SIGKILL");
    }, 10000);
    child.once("exit", exited);
    child.kill("SIGTERM");
  });
}
