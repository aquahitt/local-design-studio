import { CoreError } from "../core/project";
import type { RenderBounds } from "./render";

export const imageResourceWarningsExpression = `(() => {
  try { return JSON.parse(document.documentElement.dataset.studioPreviewImageWarnings ?? '[]'); }
  catch { return null; }
})()`;

/** Fail before rasterization; only canonical assets in this snapshot may enter diagnostics. */
export function assertImageResourcesReady(
  warnings: unknown,
  assets: readonly string[],
): void {
  if (!Array.isArray(warnings) || warnings.length > 1000)
    throw new CoreError("IMAGE_RESOURCE_UNAVAILABLE");
  const expected = new Set(assets);
  const unavailable: string[] = [];
  for (const warning of warnings) {
    if (
      !warning ||
      typeof warning !== "object" ||
      warning.code !== "PROJECT_IMAGE_UNAVAILABLE" ||
      typeof warning.asset !== "string" ||
      !/^assets\/[a-f0-9]{64}\.(png|svg)$/.test(warning.asset) ||
      !expected.has(warning.asset)
    )
      throw new CoreError("IMAGE_RESOURCE_UNAVAILABLE");
    unavailable.push(warning.asset);
  }
  if (unavailable.length) {
    const canonical = [...new Set(unavailable)].sort();
    throw new CoreError(
      "IMAGE_RESOURCE_UNAVAILABLE",
      canonical.join(", "),
      canonical[0],
    );
  }
}

/** The native render channel only extends its existing message with this one typed error. */
export function captureErrorReply(error: unknown): {
  error: string;
  errorCode?: "IMAGE_RESOURCE_UNAVAILABLE";
  imageAssets?: string[];
} {
  if (
    error instanceof CoreError &&
    error.code === "IMAGE_RESOURCE_UNAVAILABLE"
  ) {
    const detail = error.message.slice("IMAGE_RESOURCE_UNAVAILABLE: ".length);
    const imageAssets = detail
      .split(", ")
      .filter((asset) => /^assets\/[a-f0-9]{64}\.(png|svg)$/.test(asset))
      .slice(0, 1000);
    const safe = new CoreError(
      "IMAGE_RESOURCE_UNAVAILABLE",
      imageAssets.join(", "),
    );
    return {
      error: safe.message,
      errorCode: "IMAGE_RESOURCE_UNAVAILABLE",
      imageAssets,
    };
  }
  return { error: error instanceof Error ? error.message : "RENDER_FAILED" };
}

export function captureErrorFromReply(reply: {
  error?: unknown;
  errorCode?: unknown;
  imageAssets?: unknown;
}): Error {
  if (
    reply.errorCode === "IMAGE_RESOURCE_UNAVAILABLE" &&
    Array.isArray(reply.imageAssets) &&
    reply.imageAssets.length <= 1000 &&
    reply.imageAssets.every(
      (asset) =>
        typeof asset === "string" &&
        /^assets\/[a-f0-9]{64}\.(png|svg)$/.test(asset),
    )
  )
    return new CoreError(
      "IMAGE_RESOURCE_UNAVAILABLE",
      reply.imageAssets.join(", "),
      reply.imageAssets[0],
    );
  return new Error(
    typeof reply.error === "string" ? reply.error : "RENDER_FAILED",
  );
}

/** Raster allocation limits apply to output CSS pixels, not world coordinates. */
export const RASTER_LIMITS = { maxSide: 8192, maxPixels: 16_777_216 } as const;

export function captureRectangle(
  bound: Pick<RenderBounds, "x" | "y" | "width" | "height">,
) {
  if (
    ![bound.x, bound.y, bound.width, bound.height].every(Number.isFinite) ||
    bound.width <= 0 ||
    bound.height <= 0
  )
    throw new CoreError("NODE_NOT_VISIBLE");
  const width = Math.ceil(bound.width),
    height = Math.ceil(bound.height);
  if (
    width > RASTER_LIMITS.maxSide ||
    height > RASTER_LIMITS.maxSide ||
    width * height > RASTER_LIMITS.maxPixels
  )
    throw new CoreError(
      "RENDER_RASTER_LIMIT",
      "Capture exceeds 8192 pixels per side or 16777216 output pixels",
    );
  return { x: 0, y: 0, width, height, scale: 1 };
}

/** Native compositors allocate physical pixels before CSS-pixel normalization. */
export function validatePhysicalCapture(
  size: { width: number; height: number },
  pixelRatio: number,
): void {
  const width = Math.ceil(size.width * pixelRatio),
    height = Math.ceil(size.height * pixelRatio);
  if (
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0 ||
    !Number.isFinite(width * height) ||
    width > 16384 ||
    height > 16384 ||
    width * height > 67_108_864
  )
    throw new CoreError(
      "RENDER_RASTER_LIMIT",
      "Physical capture exceeds 16384 pixels per side or 67108864 pixels",
    );
}

/** Translate the disposable body without changing DOM ancestry or its flow size.
 * A new transform captures viewport-fixed/initial-containing-block positioned
 * descendants. Preserve their resolved insets first; transformed ancestors already
 * supply their own containing block and must remain untouched.
 */
export function translateCaptureExpression(
  bound: Pick<RenderBounds, "x" | "y">,
): string {
  return `(async () => {
    if (!document.getElementById('root')) throw new Error('RENDER_SURFACE_UNAVAILABLE');
    const body = document.body;
    const bodyStyle = getComputedStyle(body);
    const positioned = [...body.querySelectorAll('*')].flatMap(element => {
      if (!(element instanceof HTMLElement)) return [];
      const style = getComputedStyle(element);
      const viewportFixed = style.position === 'fixed' && element.offsetParent === null;
      const initialAbsolute = style.position === 'absolute' && element.offsetParent === body && bodyStyle.position === 'static';
      return viewportFixed || initialAbsolute ? [{element, left:style.left, top:style.top, width:style.width, height:style.height}] : [];
    });
    for (const {element,left,top,width,height} of positioned) {
      Object.assign(element.style, {left,top,width,height,right:'auto',bottom:'auto'});
    }
    body.style.translate = ${JSON.stringify(`${-bound.x}px ${-bound.y}px`)};
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.devicePixelRatio;
  })()`;
}

/** Match screenshot animation semantics: finite effects finish, infinite effects cancel.
 * This renderer is disposable; no running editor animation or document is changed.
 */
export const settleCaptureExpression = `(async () => {
  await document.fonts.ready;
  for (const animation of document.getAnimations()) {
    try {
      const timing = animation.effect?.getComputedTiming();
      if (!timing || !Number.isFinite(timing.endTime)) animation.cancel();
      else { animation.finish(); animation.pause(); }
    } catch { animation.cancel(); }
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
})()`;

export async function withCaptureTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new CoreError("RENDER_TIMEOUT")),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
