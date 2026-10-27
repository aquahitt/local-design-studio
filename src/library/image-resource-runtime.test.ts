import { describe, expect, it, vi } from "vitest";
import { transform } from "esbuild";
import { createImageResourceLoader } from "./image-resource-runtime";
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
const asset = `assets/${"a".repeat(64)}.png`;
function fixture() {
  const images: {
    image: HTMLImageElement;
    decode: ReturnType<typeof deferred>;
  }[] = [];
  const owner = {
    location: { href: "http://localhost:5198/preview" },
  } as Document;
  const createImage = () => {
    const decode = deferred();
    const image = {
      naturalWidth: 240,
      naturalHeight: 120,
      onload: null,
      onerror: null,
      src: "",
      decode: () => decode.promise,
    } as unknown as HTMLImageElement;
    images.push({ image, decode });
    return image;
  };
  return {
    owner,
    images,
    createImage,
    request: { projectId: "p", revision: 1, assets: [asset] },
  };
}
describe("image resource barrier", () => {
  it("waits for real decoding and shares immutable success across revisions", async () => {
    const f = fixture(),
      loader = createImageResourceLoader(f.owner, {
        createImage: f.createImage,
      });
    let settled = false;
    const pending = loader.load(f.request).then((r) => {
      settled = true;
      return r;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(f.images[0].image.src).toBe(`http://localhost:5198/${asset}`);
    f.images[0].decode.resolve();
    expect(await pending).toEqual({
      dimensions: { [asset]: { width: 240, height: 120 } },
      warnings: [],
    });
    await loader.load({ ...f.request, revision: 2 });
    expect(f.images).toHaveLength(1);
  });
  it("retries failure only on a new revision or explicit invalidation", async () => {
    const f = fixture(),
      loader = createImageResourceLoader(f.owner, {
        createImage: f.createImage,
      });
    const pending = loader.load(f.request);
    f.images[0].decode.reject(new Error("decode"));
    expect((await pending).warnings).toEqual([
      { code: "PROJECT_IMAGE_UNAVAILABLE", asset },
    ]);
    await loader.load(f.request);
    expect(f.images).toHaveLength(1);
    const retry = loader.load({ ...f.request, revision: 2 });
    f.images[1].decode.resolve();
    expect((await retry).warnings).toEqual([]);
    loader.invalidate(asset);
    const again = loader.load(f.request);
    f.images[2].decode.resolve();
    await again;
  });
  it("cancels a consumer promptly without corrupting an in-flight shared decode", async () => {
    const f = fixture(),
      loader = createImageResourceLoader(f.owner, {
        createImage: f.createImage,
      });
    const stale = loader.load(f.request);
    loader.cancel();
    expect(await stale).toEqual({ dimensions: {}, warnings: [] });
    const current = loader.load(f.request);
    f.images[0].decode.resolve();
    expect((await current).dimensions[asset].width).toBe(240);
    expect(f.images).toHaveLength(1);
  });
  it("bounds timeout, releases image callbacks and safely settles dispose", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(),
        loader = createImageResourceLoader(f.owner, {
          createImage: f.createImage,
          timeoutMs: 20,
        });
      const pending = loader.load(f.request);
      await vi.advanceTimersByTimeAsync(20);
      expect((await pending).warnings).toHaveLength(1);
      expect(f.images[0].image.onload).toBeNull();
      expect(f.images[0].image.onerror).toBeNull();
      const second = loader.load({ ...f.request, revision: 2 });
      loader.dispose();
      expect(await second).toEqual({ dimensions: {}, warnings: [] });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects noncanonical paths and foreign base URLs without loading bytes", async () => {
    const f = fixture(),
      loader = createImageResourceLoader(f.owner, {
        createImage: f.createImage,
      });
    expect(
      (
        await loader.load({
          ...f.request,
          assets: ["https://evil.test/x", "../x"],
        })
      ).warnings,
    ).toHaveLength(2);
    expect(
      (await loader.load({ ...f.request, baseURL: "https://evil.test/" }))
        .warnings,
    ).toHaveLength(1);
    expect(f.images).toHaveLength(0);
  });
  it("isolates project/source identity and rejects invalid natural dimensions", async () => {
    const f = fixture(),
      loader = createImageResourceLoader(f.owner, {
        createImage: f.createImage,
      });
    const a = loader.load(f.request);
    f.images[0].decode.resolve();
    await a;
    const b = loader.load({
      ...f.request,
      projectId: "other",
      baseURL: "/export/",
    });
    expect(f.images[1].image.src).toBe(`http://localhost:5198/export/${asset}`);
    Object.assign(f.images[1].image, { naturalWidth: 0 });
    f.images[1].decode.resolve();
    expect((await b).warnings).toHaveLength(1);
  });
});

it("remains a closed factory after source copying and minification", async () => {
  const source = `globalThis.copiedFactory = (${createImageResourceLoader.toString()});`;
  const minified = await transform(source, { minify: true, target: "es2022" });
  const copied = new Function(
    `${minified.code}; return globalThis.copiedFactory;`,
  )() as typeof createImageResourceLoader;
  const f = fixture(),
    loader = copied(f.owner, { createImage: f.createImage });
  const pending = loader.load(f.request);
  f.images[0].decode.resolve();
  expect((await pending).dimensions[asset]).toEqual({
    width: 240,
    height: 120,
  });
});

it("disposes decoders evicted by a changed snapshot", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(),
      loader = createImageResourceLoader(f.owner, {
        createImage: f.createImage,
      });
    const first = loader.load(f.request);
    const second = loader.load({ ...f.request, projectId: "other" });
    loader.dispose();
    await Promise.all([first, second]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("resolves only canonical same-origin asset sources independently of document baseURI", () => {
  const f = fixture();
  Object.assign(f.owner, { baseURI: "https://foreign.test/" });
  const loader = createImageResourceLoader(f.owner);
  expect(loader.resolveAssetURL(asset)).toBe(`http://localhost:5198/${asset}`);
  expect(loader.resolveAssetURL(asset, "/export/")).toBe(
    `http://localhost:5198/export/${asset}`,
  );
  expect(loader.resolveAssetURL(asset, "https://foreign.test/")).toBeNull();
  expect(loader.resolveAssetURL("data:image/png;base64,bad")).toBeNull();
});

it("reports successful load in browsers without decode only after the load event", async () => {
  const f = fixture();
  const createImage = () => {
    const image = f.createImage();
    Object.assign(image, { decode: undefined });
    return image;
  };
  const loader = createImageResourceLoader(f.owner, { createImage });
  const pending = loader.load(f.request);
  let done = false;
  void pending.then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  f.images[0].image.onload?.call(f.images[0].image, new Event("load"));
  expect((await pending).dimensions[asset].height).toBe(120);
});

it("settles over-budget canonical image references with bounded diagnostics and no decoders", async () => {
  const f = fixture();
  const loader = createImageResourceLoader(f.owner, {
    createImage: f.createImage,
  });
  const assets = Array.from(
    { length: 1008 },
    (_, i) => `assets/${i.toString(16).padStart(64, "0")}.png`,
  );
  const result = await loader.load({ ...f.request, assets });
  expect(result.dimensions).toEqual({});
  expect(result.warnings).toEqual(
    assets
      .slice(0, 1000)
      .map((asset) => ({ code: "PROJECT_IMAGE_UNAVAILABLE", asset })),
  );
  expect(f.images).toHaveLength(0);
  expect(await loader.load({ ...f.request, assets })).toEqual(result);
  loader.dispose();
});
