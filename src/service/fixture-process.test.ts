import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { stopFixtureProcess } from "../../tests/fixture-process";

function fixture() {
  return Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
  });
}
it("does not signal an already exited owned fixture", async () => {
  const child = fixture();
  child.exitCode = 0;
  expect(await stopFixtureProcess(child as unknown as ChildProcess)).toBe(
    "exited",
  );
  expect(child.kill).not.toHaveBeenCalled();
});
it("waits for graceful fixture exit and removes the fallback timer", async () => {
  vi.useFakeTimers();
  try {
    const child = fixture(),
      stopped = stopFixtureProcess(child as unknown as ChildProcess);
    child.emit("exit", 0, null);
    expect(await stopped).toBe("terminated");
    await vi.advanceTimersByTimeAsync(20000);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
  } finally {
    vi.useRealTimers();
  }
});
it("force kills only the owned fixture after grace, and still waits for its exit", async () => {
  vi.useFakeTimers();
  try {
    const child = fixture();
    let settled = false;
    const stopped = stopFixtureProcess(child as unknown as ChildProcess).then(
      (value) => {
        settled = true;
        return value;
      },
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(settled).toBe(false);
    child.emit("exit", null, "SIGKILL");
    expect(await stopped).toBe("killed");
    expect(child.listenerCount("exit")).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it("fails boundedly if the owned process does not exit even after SIGKILL", async () => {
  vi.useFakeTimers();
  try {
    const child = fixture(),
      stopped = stopFixtureProcess(child as unknown as ChildProcess);
    const assertion = expect(stopped).rejects.toThrow(
      "Fixture process did not exit after SIGKILL",
    );
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(child.listenerCount("exit")).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
