import { useContext, useEffect, useId, useRef, useState } from "react";
import type { ImageMapping, ImagePaint } from "../core/paint";
import type { Matrix } from "../core/scene";
import { validateFramePaint } from "../core/paint";
import { imageMappingMatrix } from "../core/image-paint";
import type { ImageAsset } from "../service/image-assets";
import { createImageResourceLoader } from "../library/image-resource-runtime";
import { Numeric, PendingNumbers } from "./PaintNumbers";
import { StudioSelect } from "./StudioSelect";
import { ImageCropEditor } from "./ImageCropEditor";
import { useI18n } from "./i18n";

export function ImagePaintFields({
  paint,
  width,
  height,
  scope,
  revision,
  assets,
  disabled,
  onChange,
  onImport,
}: {
  paint: ImagePaint;
  width: number;
  height: number;
  scope: string;
  revision: number;
  assets: ImageAsset[];
  disabled: boolean;
  onChange: (paint: ImagePaint) => void;
  onImport?: (file: File) => Promise<ImageAsset>;
}) {
  const { t } = useI18n();
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [crop, setCrop] = useState(false),
    [retry, setRetry] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const binding = JSON.stringify([scope, paint]);
  const latest = useRef({ binding, disabled, onChange });
  latest.current = { binding, disabled, onChange };
  const report = useContext(PendingNumbers),
    pendingId = useId();
  useEffect(() => {
    report(pendingId, busy);
    return () => report(pendingId, false);
  }, [busy, pendingId, report]);
  useEffect(() => {
    let live = true;
    const loader = createImageResourceLoader(document);
    setDimensions(null);
    setError("");
    void loader
      .load({ projectId: scope, revision, assets: [paint.asset] })
      .then((result) => {
        if (!live) return;
        const size = result.dimensions[paint.asset];
        if (size && !result.warnings.length) setDimensions(size);
        else
          setError("Изображение недоступно. Проверь файл в ресурсах проекта.");
      });
    return () => {
      live = false;
      loader.dispose();
    };
  }, [paint.asset, scope, revision, retry]);
  useEffect(() => {
    if (disabled) setCrop(false);
  }, [disabled]);
  useEffect(() => {
    setCrop(false);
  }, [scope, paint.asset]);
  function mapping(next: ImageMapping) {
    onChange({ ...paint, mapping: next });
  }
  function mode(next: ImageMapping["mode"]) {
    if (next === paint.mapping.mode) return;
    if (next === "cover" || next === "contain") {
      mapping({ mode: next, anchor: { x: 0.5, y: 0.5 } });
      return;
    }
    if (!dimensions) {
      setError("Дождись загрузки изображения перед кадрированием.");
      return;
    }
    try {
      const imageToFrame = imageMappingMatrix(paint.mapping, dimensions, {
        width,
        height,
      });
      const nextPaint: ImagePaint = {
        ...paint,
        mapping: { mode: next, imageToFrame },
      };
      validateFramePaint({ kind: "frame", fills: [nextPaint] }, "image");
      setError("");
      onChange(nextPaint);
    } catch {
      setError("Невозможно преобразовать изображение.");
    }
  }
  let validMatrix = false;
  try {
    validateFramePaint({ kind: "frame", fills: [paint] }, "image");
    validMatrix = true;
  } catch {
    /* Numeric drafts stay editable. */
  }
  const mapped =
    paint.mapping.mode === "crop" || paint.mapping.mode === "tile"
      ? paint.mapping.imageToFrame
      : null;
  return (
    <div className="image-paint-fields">
      <StudioSelect
        label={t("Изображение заливки")}
        value={paint.asset}
        disabled={disabled || busy}
        fallback={paint.asset}
        sections={[
          {
            label: "",
            options: assets
              .filter((asset) => !asset.missing && !asset.archived)
              .map((asset) => ({ value: asset.path, label: asset.name })),
          },
        ]}
        onChange={(asset) => onChange({ ...paint, asset })}
      />
      {onImport && (
        <label className="image-paint-import">
          {t("Импортировать изображение для заливки")}
          <input
            type="file"
            aria-label={t("Импортировать изображение для заливки")}
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            disabled={disabled || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const source = binding;
              setBusy(true);
              setError("");
              void onImport(file)
                .then((asset) => {
                  if (
                    mounted.current &&
                    latest.current.binding === source &&
                    !latest.current.disabled
                  )
                    latest.current.onChange({ ...paint, asset: asset.path });
                })
                .catch((error) => {
                  if (mounted.current && latest.current.binding === source)
                    setError((error as Error).message);
                })
                .finally(() => setBusy(false));
            }}
          />
        </label>
      )}
      <StudioSelect
        label={t("Размещение изображения")}
        value={paint.mapping.mode}
        disabled={disabled || busy}
        sections={[
          {
            label: "",
            options: [
              { value: "cover", label: t("Заполнить фрейм") },
              { value: "contain", label: t("Вписать целиком") },
              { value: "crop", label: t("Кадрировать") },
              { value: "tile", label: t("Повторять плиткой") },
            ],
          },
        ]}
        onChange={(value) => mode(value as ImageMapping["mode"])}
      />
      {(paint.mapping.mode === "cover" || paint.mapping.mode === "contain") && (
        <div className="paint-numbers">
          {(["x", "y"] as const).map((axis) => (
            <Numeric
              key={axis}
              label={t(
                axis === "x"
                  ? "Положение изображения X"
                  : "Положение изображения Y",
              )}
              value={
                (paint.mapping as Extract<ImageMapping, { anchor: unknown }>)
                  .anchor[axis]
              }
              disabled={disabled || busy}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => {
                if (
                  paint.mapping.mode === "cover" ||
                  paint.mapping.mode === "contain"
                )
                  mapping({
                    ...paint.mapping,
                    anchor: { ...paint.mapping.anchor, [axis]: value },
                  });
              }}
            />
          ))}
        </div>
      )}
      {mapped && (
        <>
          <button
            type="button"
            disabled={disabled || busy || !dimensions || !validMatrix}
            onClick={() => setCrop(true)}
          >
            {t("Открыть кадрирование")}
          </button>
          <button
            type="button"
            disabled={disabled || busy || !dimensions}
            onClick={() => {
              if (!dimensions) return;
              try {
                const imageToFrame = imageMappingMatrix(
                  { mode: "cover", anchor: { x: 0.5, y: 0.5 } },
                  dimensions,
                  { width, height },
                );
                const next = {
                  ...paint,
                  mapping: {
                    mode: paint.mapping.mode as "crop" | "tile",
                    imageToFrame,
                  },
                };
                validateFramePaint({ kind: "frame", fills: [next] }, "image");
                onChange(next);
                setError("");
              } catch {
                setError("Невозможно преобразовать изображение.");
              }
            }}
          >
            {t("Сбросить кадрирование")}
          </button>
          <details>
            <summary>{t("Матрица изображения UV → px")}</summary>
            <div className="paint-numbers">
              {(["a", "b", "c", "d", "x", "y"] as const).map((label, index) => (
                <Numeric
                  key={label}
                  label={t("Матрица изображения {0}", { 0: label })}
                  value={mapped[index]}
                  disabled={disabled || busy}
                  onChange={(value) => {
                    const matrix = [...mapped] as Matrix;
                    matrix[index] = value;
                    mapping({
                      mode: paint.mapping.mode as "crop" | "tile",
                      imageToFrame: matrix,
                    });
                  }}
                />
              ))}
            </div>
          </details>
          {crop && dimensions && validMatrix && (
            <ImageCropEditor
              asset={paint.asset}
              mode={paint.mapping.mode as "crop" | "tile"}
              matrix={mapped}
              width={width}
              height={height}
              disabled={disabled || busy}
              scope={scope + ":" + paint.id}
              onChange={(imageToFrame) =>
                mapping({
                  mode: paint.mapping.mode as "crop" | "tile",
                  imageToFrame,
                })
              }
              onClose={() => setCrop(false)}
            />
          )}
        </>
      )}
      {busy && <p role="status">{t("Обрабатываем изображения…")}</p>}
      {error && (
        <div>
          <p role="alert">{t(error)}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("Повторить загрузку изображения")}
          </button>
        </div>
      )}
    </div>
  );
}
