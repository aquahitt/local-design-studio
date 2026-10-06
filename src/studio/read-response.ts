export async function readJsonResponse(response: Response, options: { signal?: AbortSignal; onProgress?: (received: number, total?: number) => void; maxBytes?: number } = {}): Promise<unknown> {
  if (!response.body) return response.json();
  const limit = options.maxBytes ?? 10 * 1024 * 1024;
  const declared = Number(response.headers.get("content-length"));
  const total = declared > 0 ? declared : undefined;
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  options.signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    options.signal?.throwIfAborted();
    if (total && total > limit) throw new Error("PROJECT_TOO_LARGE");
    while (true) {
      const { done, value } = await reader.read();
      options.signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error("PROJECT_TOO_LARGE");
      text += decoder.decode(value, { stream: true });
      options.onProgress?.(bytes, total);
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
