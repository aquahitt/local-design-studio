import { useEffect, useRef, useState } from "react";
import type { Project } from "../core/project";
import type { Operation } from "../core/operations";
import {
  getTransformFrame,
  transformFramePivot,
  resizeSceneLayer,
  resizeSceneLayers,
  scaleSceneLayersInBasis,
  rotateSceneLayers,
} from "../core/affine-geometry";
import type { Point } from "../core/scene";
import { StudioSelect } from "./StudioSelect";
import { useI18n } from "./i18n";
import {
  linkedTransformValues,
  parseTransformNumber,
  transformSnapshotMatches,
  transformSelectionMatches,
} from "./transformDraft";
import "./TransformControls.css";

type Mode = "resize" | "scale" | "rotate";
type Values = {
  width: string;
  height: string;
  x: string;
  y: string;
  angle: string;
};
type Snapshot = {
  project: Project;
  projectId: string;
  revision: number;
  pageId: string;
  selectedIds: string[];
};
const anchorNames = [
  "Сверху слева",
  "Сверху по центру",
  "Сверху справа",
  "Слева по центру",
  "По центру",
  "Справа по центру",
  "Снизу слева",
  "Снизу по центру",
  "Снизу справа",
];
const anchorPoint = (value: string): Point => ({
  x: (Number(value) % 3) / 2,
  y: Math.floor(Number(value) / 3) / 2,
});
function frameResult(project: Project, ids: string[]) {
  try {
    return { frame: getTransformFrame(project, ids), error: "" };
  } catch (error) {
    return {
      frame: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
function initialValues(
  frame: ReturnType<typeof getTransformFrame> | undefined,
): Values {
  const size = frame?.roots.length === 1 ? frame.roots[0] : frame?.bounds;
  return {
    width: String(size?.width ?? ""),
    height: String(size?.height ?? ""),
    x: "100",
    y: "100",
    angle: "0",
  };
}
export function TransformControls({
  project,
  pageId,
  selectedIds,
  disabled = false,
  onApply,
  onDirty,
}: {
  project: Project;
  pageId: string;
  selectedIds: string[];
  disabled?: boolean;
  onApply: (
    operations: Operation[],
    description: string,
    baseRevision: number,
  ) => Promise<void>;
  onDirty?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const lastSizeField = useRef<"width" | "height">("width");
  const [mode, setMode] = useState<Mode>("resize"),
    [anchor, setAnchor] = useState("0"),
    [linked, setLinked] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [draft, setDraft] = useState<Values>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = {
    projectId: project.projectId,
    revision: project.revision,
    pageId,
    selectedIds,
  };
  const source = snapshot?.project ?? project,
    ids = snapshot?.selectedIds ?? selectedIds;
  const { frame, error: frameError } = frameResult(source, ids),
    values = draft ?? initialValues(frame);
  const conflict = !!snapshot && !transformSnapshotMatches(snapshot, current);
  const selectionChanged =
    !!snapshot && !transformSelectionMatches(snapshot, current);
  useEffect(() => {
    onDirty?.(!!draft);
  }, [!!draft, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  function capture() {
    if (!snapshot)
      setSnapshot({
        ...current,
        selectedIds: [...selectedIds],
        project: structuredClone(project),
      });
  }
  function edit(field: keyof Values, raw: string) {
    if (field === "width" || field === "height") lastSizeField.current = field;
    capture();
    setError("");
    setDraft((previous) => {
      const next = { ...(previous ?? values), [field]: raw };
      if (
        linked &&
        mode === "resize" &&
        (field === "width" || field === "height")
      ) {
        const size = frame?.roots.length === 1 ? frame.roots[0] : frame?.bounds;
        if (size) Object.assign(next, linkedTransformValues(field, raw, size));
      } else if (linked && mode === "scale" && (field === "x" || field === "y"))
        next[field === "x" ? "y" : "x"] = raw;
      return next;
    });
  }
  function reset() {
    setSnapshot(undefined);
    setDraft(undefined);
    setError("");
  }
  function rebase() {
    if (!snapshot || !transformSelectionMatches(snapshot, current)) {
      setError(
        t(
          "Выбраны другие слои или проект. Сбросьте черновик перед новым преобразованием.",
        ),
      );
      return;
    }
    const latest = frameResult(project, selectedIds);
    if (!latest.frame || latest.frame.pageId !== pageId) {
      setError(t("Выделение недоступно. Сбросьте черновик и выберите слои."));
      return;
    }
    if (mode === "resize" && linked) {
      const size =
        latest.frame.roots.length === 1
          ? latest.frame.roots[0]
          : latest.frame.bounds;
      setDraft((previous) =>
        previous
          ? {
              ...previous,
              ...linkedTransformValues(
                lastSizeField.current,
                previous[lastSizeField.current],
                size,
              ),
            }
          : previous,
      );
    }
    setSnapshot({
      ...current,
      selectedIds: [...selectedIds],
      project: structuredClone(project),
    });
    setError("");
  }
  const numeric =
    mode === "resize"
      ? [
          parseTransformNumber(values.width),
          parseTransformNumber(values.height),
        ]
      : mode === "scale"
        ? [parseTransformNumber(values.x), parseTransformNumber(values.y)]
        : [parseTransformNumber(values.angle)];
  const valid = numeric.every(
    (value) => value !== undefined && (mode === "rotate" || value > 0),
  );
  const unavailable =
    disabled || busy || !frame || frame.pageId !== (snapshot?.pageId ?? pageId);
  async function apply(flip?: "x" | "y") {
    if (unavailable || conflict || (!flip && !valid) || !frame) return;
    setBusy(true);
    setError("");
    try {
      const point = anchorPoint(anchor),
        pivot = transformFramePivot(frame, point);
      let operations: Operation[];
      const basis =
        frame.roots.length === 1
          ? (frame.roots[0].world.slice(0, 4) as [
              number,
              number,
              number,
              number,
            ])
          : ([1, 0, 0, 1] as [number, number, number, number]);
      if (flip)
        operations = scaleSceneLayersInBasis(
          source,
          ids,
          flip === "x" ? -1 : 1,
          flip === "y" ? -1 : 1,
          pivot,
          basis,
        );
      else if (mode === "resize")
        operations =
          frame.roots.length === 1
            ? resizeSceneLayer(
                source,
                frame.rootIds[0],
                numeric[0]!,
                numeric[1]!,
                point,
              )
            : resizeSceneLayers(
                source,
                ids,
                numeric[0]! / frame.bounds.width,
                numeric[1]! / frame.bounds.height,
                pivot,
              );
      else if (mode === "scale")
        operations = scaleSceneLayersInBasis(
          source,
          ids,
          numeric[0]! / 100,
          numeric[1]! / 100,
          pivot,
          basis,
        );
      else operations = rotateSceneLayers(source, ids, numeric[0]!, pivot);
      if (operations.length)
        await onApply(
          operations,
          t(
            flip
              ? flip === "x"
                ? "Отразить по X"
                : "Отразить по Y"
              : mode === "resize"
                ? "Изменить размер слоёв"
                : mode === "scale"
                  ? "Масштабировать слои"
                  : "Повернуть слои",
          ),
          snapshot?.revision ?? project.revision,
        );
      reset();
    } catch (cause) {
      setError(
        t("Преобразование не применено: {0}", {
          0: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      setBusy(false);
    }
  }
  if (!selectedIds.length && !draft) return null;
  return (
    <details className="transform-controls">
      <summary>
        {t("Преобразования")}
        {draft && (
          <span className="transform-draft-mark"> · {t("Черновик")}</span>
        )}
      </summary>
      <div className="transform-controls-body">
        <div
          className="transform-modes"
          role="group"
          aria-label={t("Инструмент преобразования")}
        >
          {(["resize", "scale", "rotate"] as Mode[]).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={mode === value}
              disabled={busy || !!draft}
              onClick={() => {
                setMode(value);
                setLinked(value === "scale");
                setAnchor(value === "resize" ? "0" : "4");
                setError("");
              }}
            >
              {t(
                value === "resize"
                  ? "Размер"
                  : value === "scale"
                    ? "Масштаб"
                    : "Поворот",
              )}
            </button>
          ))}
        </div>
        <p className="transform-help">
          {t(
            mode === "resize"
              ? frame?.roots.length === 1
                ? "Размер контейнера; содержимое перестраивается."
                : "Размер мировых границ выделения; содержимое перестраивается."
              : mode === "scale"
                ? "Относительный масштаб вместе с содержимым, текстом и векторами."
                : "Относительный поворот; наклон и отражение сохраняются.",
          )}
        </p>
        <fieldset disabled={unavailable}>
          <legend className="transform-visually-hidden">
            {t("Параметры преобразования")}
          </legend>
          <div className="transform-numbers">
            {(mode === "resize"
              ? ["width", "height"]
              : mode === "scale"
                ? ["x", "y"]
                : ["angle"]
            ).map((key) => {
              const field = key as keyof Values;
              return (
                <label key={field}>
                  {t(
                    field === "width"
                      ? frame?.roots.length === 1
                        ? "Ширина контейнера, px"
                        : "Ширина выделения, px"
                      : field === "height"
                        ? frame?.roots.length === 1
                          ? "Высота контейнера, px"
                          : "Высота выделения, px"
                        : field === "x"
                          ? "Масштаб X, %"
                          : field === "y"
                            ? "Масштаб Y, %"
                            : "Поворот, °",
                  )}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={values[field]}
                    aria-invalid={
                      parseTransformNumber(values[field]) === undefined ||
                      (field !== "angle" &&
                        (parseTransformNumber(values[field]) ?? 0) <= 0)
                    }
                    onChange={(event) => edit(field, event.target.value)}
                  />
                </label>
              );
            })}
          </div>
          {mode !== "rotate" && (
            <label className="transform-lock">
              <input
                type="checkbox"
                checked={linked}
                disabled={!!draft}
                onChange={(event) => setLinked(event.target.checked)}
              />
              {t("Сохранять пропорции")}
            </label>
          )}
          <StudioSelect
            label={t("Опорная точка")}
            value={anchor}
            sections={[
              {
                label: "",
                options: anchorNames.map((label, index) => ({
                  value: String(index),
                  label: t(label),
                })),
              },
            ]}
            disabled={unavailable || !!draft}
            onChange={setAnchor}
          />
        </fieldset>
        {frame && (
          <p className="transform-bounds">
            {t("Мировые границы: {0} × {1} px", {
              0: Math.round(frame.bounds.width * 100) / 100,
              1: Math.round(frame.bounds.height * 100) / 100,
            })}
          </p>
        )}
        {conflict && (
          <div className="transform-conflict" role="status">
            <p>
              {t(
                "Проект или выделение изменились. Черновик сохранён. Проверьте новые исходные данные перед повторным применением.",
              )}
            </p>
            {selectionChanged && (
              <p>
                {t(
                  "Выбраны другие слои или проект. Сбросьте черновик перед новым преобразованием.",
                )}
              </p>
            )}
            <button
              type="button"
              disabled={disabled || busy || selectionChanged}
              onClick={rebase}
            >
              {t("Пересчитать от текущего выделения")}
            </button>
          </div>
        )}
        {(error || frameError) && (
          <p role="alert">
            {error ||
              t("Выделение недоступно для преобразования: {0}", {
                0: frameError,
              })}
          </p>
        )}
        <div className="transform-actions">
          <button
            type="button"
            disabled={unavailable || conflict || !valid}
            onClick={() => void apply()}
          >
            {t("Применить преобразование")}
          </button>
          <button type="button" disabled={busy || !draft} onClick={reset}>
            {t("Сбросить черновик")}
          </button>
        </div>
        <div className="transform-actions">
          <button
            type="button"
            disabled={unavailable || conflict || !!draft}
            onClick={() => void apply("x")}
          >
            {t("Отразить по X")}
          </button>
          <button
            type="button"
            disabled={unavailable || conflict || !!draft}
            onClick={() => void apply("y")}
          >
            {t("Отразить по Y")}
          </button>
        </div>
      </div>
    </details>
  );
}
