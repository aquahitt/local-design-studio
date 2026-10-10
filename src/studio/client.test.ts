import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioClient } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("cancellable session connection", () => {
  it("does not start a session request when already cancelled", async () => {
    const fetchSession = vi.fn(async () =>
      Response.json({ token: "test", uiToken: "test-ui" }),
    );
    vi.stubGlobal("fetch", fetchSession);
    const controller = new AbortController();
    controller.abort();

    await expect(StudioClient.connect(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchSession).not.toHaveBeenCalled();
  });

  it("aborts a pending session fetch before any project request", async () => {
    const requests: string[] = [];
    let sessionSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", (path: string, options?: RequestInit) => {
      requests.push(path);
      sessionSignal = options?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        sessionSignal?.addEventListener(
          "abort",
          () => reject(sessionSignal!.reason),
          { once: true },
        );
      });
    });
    const controller = new AbortController();
    const connected = StudioClient.connect(controller.signal);
    // Handle rejection even if the signal assertion fails before it is awaited.
    void connected.catch(() => {});
    controller.abort();

    expect(sessionSignal).toBe(controller.signal);
    await expect(connected).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toEqual(["/api/session"]);
  });
});
