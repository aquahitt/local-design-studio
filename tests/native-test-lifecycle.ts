type NativeApp = {
  close(): Promise<void>;
  process(): {
    exitCode: number | null;
    signalCode: string | null;
    kill(signal: "SIGKILL"): boolean;
    once(event: "exit", listener: () => void): unknown;
    off(event: "exit", listener: () => void): unknown;
  };
};

export async function nativeDeadline<T>(stage: string, operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A forced stop is cleanup of this test's child, never a passing shutdown. */
export async function closeOwnedNativeApp(app: NativeApp, timeoutMs = 10000): Promise<void> {
  try {
    await nativeDeadline("native-app-close", () => app.close(), timeoutMs);
  } catch (error) {
    const child = app.process();
    if (child.exitCode === null && child.signalCode === null) {
      let exited!: () => void;
      const exit = new Promise<void>(resolve => { exited = resolve; });
      child.once("exit", exited);
      try {
        child.kill("SIGKILL");
        await nativeDeadline("native-owned-child-exit", () => exit, 3000);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Native shutdown and owned child cleanup failed");
      } finally {
        child.off("exit", exited);
      }
    }
    throw error;
  }
}

/** Preserve existing evidence before asking a possibly unresponsive native main. */
export async function finishNativeTest(options: {
  attach(): Promise<unknown>;
  diagnostics(): Promise<unknown>;
  closeClients(): Promise<unknown>;
  closeApp(): Promise<unknown>;
  removeFixture(): Promise<unknown>;
  timeoutMs?: number;
  primaryError?: unknown;
}): Promise<void> {
  const failures: unknown[] = [];
  // Total worst-case cleanup stays below Playwright's 60-second worker teardown.
  const budgets = { attach: 5000, diagnostics: 5000, clients: 10000, app: 15000, fixture: 5000 };
  for (const [stage, operation] of [
    ["attach", options.attach],
    ["diagnostics", options.diagnostics],
    ["clients", options.closeClients],
    ["app", options.closeApp],
    ["fixture", options.removeFixture],
  ] as const) {
    try {
      await nativeDeadline(`native-cleanup-${stage}`, operation, options.timeoutMs ?? budgets[stage]);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    if (options.primaryError !== undefined) failures.unshift(options.primaryError);
    throw new AggregateError(failures, "Native test cleanup failed");
  }
}
