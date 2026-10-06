import { describe, expect, it } from "vitest";
import { readJsonResponse } from "./read-response";
describe("bounded cancellable project read", () => {
  it("decodes split UTF-8 and reports received bytes", async () => {
    const bytes = new TextEncoder().encode('{"name":"Экран"}');
    const progress: number[] = [];
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 11)); controller.enqueue(bytes.slice(11)); controller.close(); } }));
    expect(await readJsonResponse(response, { onProgress: (received) => progress.push(received) })).toEqual({ name: "Экран" });
    expect(progress).toEqual([11, bytes.length]);
  });
  it("cancels oversized response instead of parsing it", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } }));
    await expect(readJsonResponse(response, { maxBytes: 10 })).rejects.toThrow("PROJECT_TOO_LARGE");
    expect(cancelled).toBe(true);
  });
  it("abort stops a pending stream", async () => {
    const controller = new AbortController();
    const response = new Response(new ReadableStream());
    const pending = readJsonResponse(response, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
