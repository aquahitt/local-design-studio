import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { finishNativeTest, closeOwnedNativeApp } from "../../tests/native-test-lifecycle";

describe("native test lifecycle", () => {
  it("attaches evidence before a stalled main process and still completes cleanup with failure", async () => {
    const order: string[] = [];
    const pending = new Promise<never>(() => {});
    const primaryError = new Error("primary assertion");
    const result = finishNativeTest({
      primaryError,
      attach: async () => { order.push("attach"); },
      diagnostics: async () => { order.push("evaluate"); return pending; },
      closeClients: async () => { order.push("clients"); },
      closeApp: async () => { order.push("close"); },
      removeFixture: async () => { order.push("remove"); },
      timeoutMs: 10,
    });
    await expect(result).rejects.toThrow("Native test cleanup failed");
    await expect(result).rejects.toMatchObject({ errors: [primaryError, expect.objectContaining({ message: "native-cleanup-diagnostics timed out" })] });
    expect(order).toEqual(["attach", "evaluate", "clients", "close", "remove"]);
  });

  it("kills only the owned child after close stalls and reports failed graceful shutdown", async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null as string | null });
    const kill = vi.fn(() => {
      child.signalCode = "SIGKILL";
      queueMicrotask(() => child.emit("exit"));
      return true;
    });
    const app = {
      close: () => new Promise<void>(() => {}),
      process: () => Object.assign(child, { kill }),
    };
    await expect(closeOwnedNativeApp(app, 10)).rejects.toThrow("native-app-close timed out");
    expect(kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("does not force a child that closed gracefully", async () => {
    const kill = vi.fn(() => true);
    await closeOwnedNativeApp({ close: async () => {}, process: () => Object.assign(new EventEmitter(), { kill, exitCode: 0, signalCode: null }) }, 10);
    expect(kill).not.toHaveBeenCalled();
  });
});
