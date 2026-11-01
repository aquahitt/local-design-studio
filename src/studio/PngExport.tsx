import { useEffect, useId, useRef, useState } from "react";
import type { Project, ProjectNode, ProjectPage } from "../core/project";
import type {
  CaptureBoundsMode,
  CaptureMode,
  RenderResult,
} from "../service/render";
import type { StudioClient } from "./client";
import { useI18n } from "./i18n";
import { StudioSelect } from "./StudioSelect";
import "./PngExport.css";

type CaptureContext = {
  projectId: string;
  revision: number;
  pageId: string;
  nodeId: string;
  boundsMode: CaptureBoundsMode;
  captureMode: CaptureMode;
};
type PreparedPng = {
  contextKey: string;
  url: string;
  width: number;
  height: number;
  filename: string;
  result: RenderResult;
};
const MAX_PNG_BYTES = 68_000_000;
const PNG_ERROR = "PNG_EXPORT_INVALID_RESULT";
function validBounds(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const box = value as Record<string, unknown>;
  return (
    ["x", "y", "width", "height"].every(
      (key) => typeof box[key] === "number" && Number.isFinite(box[key]),
    ) &&
    (box.width as number) > 0 &&
    (box.height as number) > 0
  );
}
/** Validate before allocating a blob. Visual bounds may be fractional; raster dimensions are integers. */
export function validateRenderPng(
  result: RenderResult,
  context: CaptureContext,
) {
  if (
    !result ||
    result.mimeType !== "image/png" ||
    result.revision !== context.revision ||
    result.pageId !== context.pageId ||
    result.nodeId !== context.nodeId ||
    result.boundsMode !== context.boundsMode ||
    result.captureMode !== context.captureMode ||
    !validBounds(result.captureBounds) ||
    !Number.isInteger(result.captureBounds?.width) ||
    !Number.isInteger(result.captureBounds?.height) ||
    (context.boundsMode === "visual" &&
      (!Array.isArray(result.visualBounds) ||
        result.visualBounds.filter((bound) => bound?.id === context.nodeId)
          .length !== 1 ||
        result.visualBounds.some(
          (bound) => typeof bound?.id !== "string" || !validBounds(bound),
        ) ||
        result.visualBoundsStatus !== "conservative" ||
        typeof result.visualBoundsPolicy !== "string" ||
        !result.visualBoundsPolicy.trim() ||
        result.visualBoundsPolicy.length > 1000)) ||
    !Array.isArray(result.warnings) ||
    typeof result.data !== "string" ||
    !result.data.length ||
    result.data.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 ||
    result.data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(result.data)
  )
    throw new Error(PNG_ERROR);
  let raw: string;
  try {
    raw = atob(result.data);
  } catch {
    throw new Error(PNG_ERROR);
  }
  if (raw.length < 33 || raw.length > MAX_PNG_BYTES) throw new Error(PNG_ERROR);
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  if (
    ![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    throw new Error(PNG_ERROR);
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16_777_216 ||
    width !== result.captureBounds?.width ||
    height !== result.captureBounds?.height
  )
    throw new Error(PNG_ERROR);
  return { bytes, width, height };
}
function decodePng(
  url: string,
  width: number,
  height: number,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    const done = (error?: Error) => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
      image.src = "";
      error ? reject(error) : resolve();
    };
    const abort = () => done(new DOMException("Aborted", "AbortError"));
    image.onload = () =>
      done(
        image.naturalWidth === width && image.naturalHeight === height
          ? undefined
          : new Error(PNG_ERROR),
      );
    image.onerror = () => done(new Error(PNG_ERROR));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}
function findNode(
  nodes: ProjectNode[],
  id: string | null,
): ProjectNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(Object.values(node.slots).flat(), id);
    if (child) return child;
  }
}
function filename(name: string, revision: number) {
  const stem =
    name
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "layer";
  return `${stem}-r${revision}.png`;
}
function errorCopy(error: unknown) {
  const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
  switch (code) {
    case "REVISION_CONFLICT":
      return "Документ изменился. Подготовь PNG заново.";
    case "NODE_NOT_FOUND":
    case "PAGE_NOT_FOUND":
    case "NODE_NOT_VISIBLE":
      return "Выбранный слой недоступен для снимка.";
    case "PROJECT_TOO_LARGE":
      return "Ответ с PNG слишком большой. Уменьши слой и повтори попытку.";
    case "RENDER_RASTER_LIMIT":
      return "PNG слишком большой. Уменьши слой или выбери геометрические границы.";
    case "IMAGE_RESOURCE_UNAVAILABLE":
      return "Не удалось загрузить изображения слоя. Проверь ресурсы проекта.";
    case "RENDER_UNAVAILABLE":
    case "RENDER_BROWSER_UNAVAILABLE":
      return "Сервис PNG недоступен. Проверь локальный renderer.";
    case "VISUAL_BOUNDS_UNSUPPORTED":
      return "Не удалось определить границы оформления этого слоя. Выбери геометрические границы.";
    case "ISOLATED_CAPTURE_UNSUPPORTED":
      return "Этот слой зависит от окружения. Выбери фрагмент сцены, чтобы сохранить его вид.";
    case "RENDER_TIMEOUT":
      return "Подготовка PNG заняла слишком много времени. Повтори попытку.";
    case PNG_ERROR:
      return "Сервис вернул некорректный PNG или неполные метаданные. Обнови локальную студию и повтори попытку.";
    default:
      return "Не удалось подготовить PNG. Повтори попытку.";
  }
}
export function PngExport({
  client,
  project,
  page,
  nodeId,
  disabled = false,
}: {
  client: StudioClient;
  project: Project;
  page: ProjectPage;
  nodeId: string | null;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const descriptionId = useId();
  const [boundsMode, setBoundsMode] = useState<CaptureBoundsMode>("visual");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("isolated");
  const [prepared, setPrepared] = useState<PreparedPng | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState<{
    received: number;
    total?: number;
  } | null>(null);
  const context: CaptureContext = {
    projectId: project.projectId,
    revision: project.revision,
    pageId: page.screenId,
    nodeId: nodeId ?? "",
    boundsMode,
    captureMode,
  };
  const contextKey = JSON.stringify([context, disabled, __STUDIO_DEMO__]);
  const latestKey = useRef(contextKey);
  latestKey.current = contextKey;
  const mounted = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const blobUrl = useRef<string | null>(null);
  const node = findNode(page.nodes, nodeId);
  const unavailable = disabled || __STUDIO_DEMO__ || !node;
  const ready =
    !unavailable && prepared?.contextKey === contextKey ? prepared : null;
  function clearBlob() {
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = null;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
      clearBlob();
    };
  }, []);
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    clearBlob();
    setPrepared(null);
    setBusy(false);
    setError("");
    setCancelled(false);
    setProgress(null);
  }, [contextKey, client]);
  async function prepare() {
    if (unavailable || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const requestKey = contextKey;
    const current = () =>
      mounted.current &&
      !controller.signal.aborted &&
      pending.current === controller &&
      latestKey.current === requestKey;
    clearBlob();
    setPrepared(null);
    setBusy(true);
    setError("");
    setCancelled(false);
    setProgress(null);
    let url: string | null = null;
    try {
      const result = await client.request<RenderResult>(
        "render",
        {
          pageId: context.pageId,
          revision: context.revision,
          nodeId: context.nodeId,
          boundsMode,
          captureMode,
        },
        false,
        {
          signal: controller.signal,
          onProgress: (received, total) => {
            if (current()) setProgress({ received, total });
          },
        },
      );
      if (!current()) return;
      const { bytes, width, height } = validateRenderPng(result, context);
      url = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: "image/png" }),
      );
      await decodePng(url, width, height, controller.signal);
      if (!current()) return;
      blobUrl.current = url;
      setPrepared({
        contextKey: requestKey,
        url,
        width,
        height,
        filename: filename(node?.name || node?.id || "layer", context.revision),
        result,
      });
      url = null;
    } catch (failure) {
      if (current()) setError(errorCopy(failure));
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (current()) {
        pending.current = null;
        setBusy(false);
        setProgress(null);
      }
    }
  }
  function cancel() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setProgress(null);
    setCancelled(true);
  }
  function download() {
    if (!ready || ready.contextKey !== latestKey.current || unavailable) return;
    const link = document.createElement("a");
    link.href = ready.url;
    link.download = ready.filename;
    link.click();
  }
  const boundsLabel =
    boundsMode === "visual" ? t("Всё оформление") : t("Геометрия");
  const captureLabel =
    captureMode === "isolated" ? t("Отдельный слой") : t("Фрагмент сцены");
  const warnings =
    ready?.result.warnings
      .filter((warning): warning is string => typeof warning === "string")
      .slice(0, 12) ?? [];
  return (
    <details className="panel png-export">
      <summary>{t("Экспорт PNG")}</summary>
      <p className="png-export-intro">
        {t("Подготовь снимок выбранного слоя, проверь результат и скачай PNG.")}
      </p>
      <div className="png-export-settings">
        <div>
          <span className="png-export-label">{t("Состав PNG")}</span>
          <StudioSelect
            label={t("Состав PNG")}
            value={captureMode}
            disabled={disabled || __STUDIO_DEMO__}
            sections={[
              {
                label: "",
                options: [
                  { value: "isolated", label: t("Отдельный слой") },
                  { value: "scene", label: t("Фрагмент сцены") },
                ],
              },
            ]}
            onChange={(value) => setCaptureMode(value as CaptureMode)}
          />
        </div>
        <div>
          <span className="png-export-label">{t("Границы PNG")}</span>
          <StudioSelect
            label={t("Границы PNG")}
            value={boundsMode}
            disabled={disabled || __STUDIO_DEMO__}
            sections={[
              {
                label: "",
                options: [
                  { value: "visual", label: t("Всё оформление") },
                  { value: "layout", label: t("Геометрия") },
                ],
              },
            ]}
            onChange={(value) => setBoundsMode(value as CaptureBoundsMode)}
          />
        </div>
      </div>
      <div id={descriptionId} className="png-export-explanation">
        <p>
          {captureMode === "isolated"
            ? t(
                "Выбранный слой и его дочерние слои на прозрачном фоне. Обрезка предков отключена; обрезка внутри выбранного слоя сохраняется.",
              )
            : t(
                "Фрагмент сцены в границах выбранного слоя: фон и соседние слои попадут в PNG. Обрезка предков сохраняется.",
              )}
        </p>
        <p>
          {boundsMode === "visual"
            ? t(
                "Границы включают обводки, тени и видимых потомков. Это консервативная область: по краям возможны прозрачные поля.",
              )
            : t(
                "Границы по геометрии слоя. Обводки, тени и другое оформление за её пределами могут обрезаться.",
              )}
        </p>
      </div>
      {disabled && (
        <p role="status">{t("Сначала примени или сбрось изменения слоя.")}</p>
      )}
      {!node && <p>{t("Выбери слой для экспорта PNG.")}</p>}
      {__STUDIO_DEMO__ && (
        <p>{t("Экспорт PNG доступен в локальной студии.")}</p>
      )}
      <div className="png-export-actions">
        <button
          type="button"
          aria-describedby={descriptionId}
          disabled={unavailable || busy}
          onClick={() => void prepare()}
        >
          {t("Подготовить PNG")}
        </button>
        {busy && (
          <button type="button" onClick={cancel}>
            {t("Отменить ожидание PNG")}
          </button>
        )}
      </div>
      {busy && (
        <div className="png-export-progress" role="status">
          <p>{t("Подготавливаем PNG…")}</p>
          <progress
            aria-label={t("Подготовка PNG")}
            {...(progress?.total
              ? { max: progress.total, value: progress.received }
              : {})}
          />
          <small>
            {progress
              ? t("Получено {0} КБ", { 0: Math.ceil(progress.received / 1024) })
              : t("Ожидаем снимок локального renderer.")}
          </small>
        </div>
      )}
      {cancelled && (
        <p role="status">
          {t("Ожидание отменено. Сервис может ещё завершать снимок.")}
        </p>
      )}
      {error && <p role="alert">{t(error)}</p>}
      {ready && (
        <div className="png-export-result">
          <div className="png-export-checkerboard">
            <img
              src={ready.url}
              width={ready.width}
              height={ready.height}
              alt={t("Предпросмотр PNG выбранного слоя")}
            />
          </div>
          <p className="png-export-metadata">
            {t("{0} × {1} px · ревизия {2}", {
              0: ready.width,
              1: ready.height,
              2: ready.result.revision,
            })}
            <br />
            {captureLabel} · {boundsLabel}
          </p>
          {warnings.length > 0 && (
            <div className="png-export-warnings">
              <p>{t("Предупреждения снимка")}</p>
              <ul>
                {warnings.map((warning, index) => (
                  <li key={index}>{warning.slice(0, 500)}</li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" onClick={download}>
            {t("Скачать PNG")}
          </button>
        </div>
      )}
    </details>
  );
}
