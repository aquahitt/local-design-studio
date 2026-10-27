export type ImageResourceWarning = {
  code: "PROJECT_IMAGE_UNAVAILABLE";
  asset: string;
};
export type ImageResourceReadiness = {
  dimensions: Record<string, { width: number; height: number }>;
  warnings: ImageResourceWarning[];
};
export type ImageResourceInput = {
  projectId: string;
  revision: number;
  assets: readonly string[];
  baseURL?: string;
};
/** Closed factory: exported artifacts may copy its JS source without any module dependencies. */
export function createImageResourceLoader(
  owner: Document,
  options: {
    timeoutMs?: number;
    createImage?: () => HTMLImageElement;
  } = {},
) {
  type Dimensions = { width: number; height: number };
  type Entry = {
    promise: Promise<Dimensions | null>;
    revision: number;
    failed: boolean;
    stop: () => void;
  };
  const entries = new Map<string, Entry>();
  const consumers = new Set<() => void>();
  const decoders = new Set<() => void>();
  const canonical = /^assets\/[a-f0-9]{64}\.(png|svg)$/;
  let disposed = false;
  const empty = (): ImageResourceReadiness => ({
    dimensions: {},
    warnings: [],
  });
  const timeout =
    Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0
      ? Math.min(options.timeoutMs!, 10000)
      : 5000;
  function decode(url: string, revision: number): Entry {
    let stop = () => {};
    const entry: Entry = {
      promise: Promise.resolve(null),
      revision,
      failed: false,
      stop: () => stop(),
    };
    entry.promise = new Promise((resolve) => {
      let image: HTMLImageElement | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let done = false;
      const finish = (value: Dimensions | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        decoders.delete(stop);
        if (image) {
          image.onload = null;
          image.onerror = null;
        }
        image = null;
        entry.failed = value === null;
        resolve(value);
      };
      stop = () => finish(null);
      if (decoders.size >= 1000) decoders.values().next().value?.();
      decoders.add(stop);
      try {
        image = options.createImage
          ? options.createImage()
          : owner.createElement("img");
        const dimensions = () => {
          if (!image) return;
          const width = image.naturalWidth,
            height = image.naturalHeight;
          finish(
            Number.isFinite(width) &&
              Number.isFinite(height) &&
              width > 0 &&
              height > 0
              ? { width, height }
              : null,
          );
        };
        image.onerror = () => finish(null);
        image.onload = () => {
          if (typeof image?.decode !== "function") dimensions();
        };
        timer = setTimeout(() => finish(null), timeout);
        image.src = url;
        if (typeof image.decode === "function")
          void image.decode().then(dimensions, () => finish(null));
      } catch {
        finish(null);
      }
    });
    return entry;
  }
  function resolveAssetURL(asset: string, baseURL?: string): string | null {
    if (!canonical.test(asset)) return null;
    try {
      // Never document.baseURI: a library's <base> cannot redirect asset requests.
      const current = new URL(owner.location.href);
      const base = new URL(baseURL ?? "/", current);
      if (
        base.protocol !== current.protocol ||
        base.host !== current.host ||
        base.username ||
        base.password ||
        base.search ||
        base.hash
      )
        return null;
      return new URL(asset, base).href;
    } catch {
      return null;
    }
  }
  return {
    resolveAssetURL,
    async load(input: ImageResourceInput): Promise<ImageResourceReadiness> {
      if (disposed) return empty();
      const assets = [...new Set(input.assets)];
      // A valid scene can reference more resources than the on-disk asset budget.
      // Settle the barrier explicitly; throwing here would leave iframe/export readiness pending.
      if (assets.length > 1000)
        return {
          dimensions: {},
          warnings: assets
            .filter((asset) => canonical.test(asset))
            .slice(0, 1000)
            .map((asset) => ({
              code: "PROJECT_IMAGE_UNAVAILABLE" as const,
              asset,
            })),
        };
      let cancel = () => {};
      const cancelled = new Promise<null>((resolve) => {
        cancel = () => resolve(null);
      });
      consumers.add(cancel);
      const keys = new Set(
        assets
          .filter((asset) => resolveAssetURL(asset, input.baseURL))
          .map((asset) =>
            JSON.stringify([
              input.projectId,
              resolveAssetURL(asset, input.baseURL),
            ]),
          ),
      );
      // Keep only this snapshot's resources; in-flight consumers still own their entry promises.
      for (const key of entries.keys())
        if (!keys.has(key)) {
          entries.delete(key);
        }
      const work = Promise.all(
        assets.map(async (asset) => {
          const url = resolveAssetURL(asset, input.baseURL);
          if (!url) return { asset, value: null };
          const key = JSON.stringify([input.projectId, url]);
          let entry = entries.get(key);
          if (!entry || (entry.failed && entry.revision !== input.revision)) {
            entry = decode(url, input.revision);
            entries.set(key, entry);
          }
          return { asset, value: await entry.promise };
        }),
      );
      const rows = await Promise.race([work, cancelled]);
      consumers.delete(cancel);
      if (!rows || disposed) return empty();
      const result = empty();
      for (const { asset, value } of rows) {
        if (value) result.dimensions[asset] = value;
        else result.warnings.push({ code: "PROJECT_IMAGE_UNAVAILABLE", asset });
      }
      return result;
    },
    invalidate(asset?: string) {
      for (const [key, entry] of entries)
        if (!asset || (JSON.parse(key) as string[])[1].endsWith(`/${asset}`)) {
          entries.delete(key);
          entry.stop();
        }
    },
    cancel() {
      for (const cancel of consumers) cancel();
      consumers.clear();
    },
    dispose() {
      disposed = true;
      for (const cancel of consumers) cancel();
      consumers.clear();
      for (const stop of decoders) stop();
      decoders.clear();
      entries.clear();
    },
  };
}
