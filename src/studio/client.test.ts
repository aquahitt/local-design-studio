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

    await expect(StudioClient.connect(controller.signal)).rejects.toMatchObject(
      {
        name: "AbortError",
      },
    );
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

describe("bounded PNG response transport", () => {
  it("accepts PNG JSON above the project limit without raising the project limit", async () => {
    const payload = { data: "A".repeat(11 * 1024 * 1024) };
    vi.stubGlobal("fetch", async () => Response.json(payload));
    const client = new StudioClient("test", "test-ui");
    await expect(client.request("render", {})).resolves.toEqual(payload);
    await expect(client.request("project")).rejects.toThrow(
      "PROJECT_TOO_LARGE",
    );
  });

  it("cancels render responses that exceed the finite PNG budget", async () => {
    let cancelled = false;
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-length": String(101 * 1024 * 1024) } },
        ),
    );
    await expect(
      new StudioClient("test", "test-ui").request("render", {}),
    ).rejects.toThrow("PROJECT_TOO_LARGE");
    expect(cancelled).toBe(true);
  });
});
