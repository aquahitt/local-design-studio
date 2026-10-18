import { useI18n } from "./i18n";
import { useEffect, useState } from "react";
import type { Project, ProjectNode } from "../core/project";
import type { Operation } from "../core/operations";
import { beginDraft, editDraft, receiveDraft, rebaseDraft } from "./draft";
import { StudioSelect } from "./StudioSelect";
import { PaintFields, isRenderableFramePaintDraft } from "./PaintFields";
import { validateFramePaint } from "../core/paint";
/** Guard only values consumed by controls; canonical validation still owns writes. */
function isRenderableLayerDraft(value: unknown): boolean {
  const object = (input: unknown): input is Record<string, unknown> =>
    !!input && typeof input === "object" && !Array.isArray(input);
  if (!object(value)) return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (value.scene !== undefined) {
    if (!object(value.scene)) return false;
    const scene = value.scene;
    for (const key of ["kind", "fill", "stroke", "path"])
      if (scene[key] !== undefined && typeof scene[key] !== "string")
        return false;
    for (const key of [
      "x",
      "y",
      "width",
      "height",
      "rotation",
      "opacity",
      "fontSize",
      "radius",
      "strokeWidth",
    ])
      if (
        scene[key] !== undefined &&
        (typeof scene[key] !== "number" || !Number.isFinite(scene[key]))
      )
        return false;
    if (scene.clip !== undefined && typeof scene.clip !== "boolean")
      return false;
  }
  if (value.instance !== undefined) {
    if (!object(value.instance)) return false;
    for (const key of ["definitionId", "variant"])
      if (
        value.instance[key] !== undefined &&
        typeof value.instance[key] !== "string"
      )
        return false;
  }
  return true;
}

export function NodeLayoutInspector({
  node,
  project,
  onDirty,
  onApply,
  disabled,
}: {
  node: ProjectNode;
  project: Project;
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
  onApply: (
    operations: Operation[],
    description: string,
    revision?: number,
  ) => Promise<void>;
}) {
  const { t } = useI18n();

  const data = {
    name: node.name ?? node.type,
    ...(node.scene ? { scene: node.scene } : {}),
    ...(node.instance ? { instance: node.instance } : {}),
  };
  const [draft, setDraft] = useState(() => beginDraft(data, project.revision)),
    [error, setError] = useState(""),
    [pendingPaint, setPendingPaint] = useState(false);
  useEffect(
    () =>
      setDraft((current) => {
        // An unfinished numeric token is still user input. Preserve its source
        // revision even when the canonical JSON has not changed yet.
        if (pendingPaint || current.conflict)
          return {
            ...current,
            conflict:
              current.conflict || project.revision !== current.baseRevision,
          };
        return receiveDraft(current, data, project.revision);
      }),
    [node, project.revision, pendingPaint],
  );
  useEffect(() => {
    onDirty(draft.dirty || draft.conflict || pendingPaint);
    return () => onDirty(false);
  }, [draft.dirty, draft.conflict, pendingPaint, onDirty]);
  let value: typeof data;
  let validationError = "";
  try {
    value = JSON.parse(draft.value);
    if (!isRenderableLayerDraft(value)) throw new Error("Invalid layer fields");
  } catch {
    value = data;
    validationError = t("Исправьте параметры слоя в JSON.");
  }
  if (value.scene) {
    try {
      validateFramePaint(value.scene, "scene");
      if (
        value.scene.kind === "frame" &&
        !isRenderableFramePaintDraft(value.scene)
      )
        throw new Error("Invalid frame paint draft");
    } catch (e) {
      validationError =
        t("Исправьте заливки или тени в JSON либо в полях ниже.") +
        " " +
        (e as Error).message;
    }
  }
  function change(field: string, next: unknown) {
    setError("");
    setDraft((current) =>
      editDraft(current, JSON.stringify({ ...value, [field]: next }, null, 2)),
    );
  }
  async function apply() {
    try {
      if (validationError || pendingPaint) return;
      const next = JSON.parse(draft.value),
        operations: Operation[] = [
          {
            type: "setNodeMetadata",
            nodeId: node.id,
            name: next.name,
            ...(next.scene ? { scene: next.scene } : {}),
          },
        ];
      if (next.instance)
        operations.push({
          type: "setInstance",
          nodeId: node.id,
          instance: next.instance,
        });
      await onApply(operations, t("Изменить слой"), draft.baseRevision);
      setDraft(beginDraft(next, draft.baseRevision + 1));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="inspector layout-inspector">
      <h3>{t("Слой и геометрия")}</h3>
      <label>
        {t("Название слоя")}
        <input
          aria-label={t("Название слоя")}
          disabled={disabled || node.locked}
          value={value.name ?? data.name}
          onChange={(e) => change("name", e.target.value)}
        />
      </label>
      {value.scene && (
        <div className="geometry-fields">
          {(
            [
              "x",
              "y",
              "width",
              "height",
              "rotation",
              "opacity",
              "fontSize",
              "radius",
            ] as const
          ).map((field) => (
            <label key={field}>
              {
                {
                  x: "X",
                  y: "Y",
                  width: t("Ширина слоя"),
                  height: t("Высота слоя"),
                  rotation: t("Поворот"),
                  opacity: t("Прозрачность"),
                  fontSize: t("Размер текста"),
                  radius: t("Радиус"),
                }[field]
              }
              <input
                type="number"
                aria-label={
                  {
                    x: t("X слоя"),
                    y: t("Y слоя"),
                    width: t("Ширина слоя"),
                    height: t("Высота слоя"),
                    rotation: t("Поворот слоя"),
                    opacity: t("Прозрачность слоя"),
                    fontSize: t("Размер текста слоя"),
                    radius: t("Радиус слоя"),
                  }[field]
                }
                disabled={disabled || node.locked}
                value={value.scene?.[field] ?? (field === "opacity" ? 1 : 0)}
                onChange={(e) =>
                  change("scene", {
                    ...value.scene,
                    [field]: Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
      {value.scene?.kind === "frame" &&
        isRenderableFramePaintDraft(value.scene) && (
          <PaintFields
            scene={value.scene}
            disabled={disabled || !!node.locked}
            onChange={(scene) => change("scene", scene)}
            onPendingChange={setPendingPaint}
          />
        )}
      <label>
        {t("Параметры слоя JSON")}
        <textarea
          aria-label={t("Параметры слоя JSON")}
          disabled={disabled || node.locked}
          value={draft.value}
          onChange={(e) => {
            setDraft((current) => editDraft(current, e.target.value));
            setError("");
          }}
        />
      </label>
      {value.instance && (
        <>
          <StudioSelect
            label={t("Вариант экземпляра")}
            value={value.instance.variant ?? ""}
            disabled={disabled || node.locked}
            onChange={(variant) => {
              const { variant: _old, ...rest } = value.instance!;
              change("instance", { ...rest, ...(variant ? { variant } : {}) });
            }}
            sections={[
              {
                label: "",
                options: [
                  { value: "", label: t("Базовый") },
                  ...Object.keys(
                    project.designComponents?.find(
                      (d) => d.id === value.instance?.definitionId,
                    )?.variants ?? {},
                  ).map((variant) => ({ value: variant, label: variant })),
                ],
              },
            ]}
          />
          <button
            disabled={disabled || node.locked || draft.dirty}
            onClick={() =>
              void onApply(
                [{ type: "detachInstance", nodeId: node.id }],
                t("Отсоединить экземпляр"),
              ).catch((e) => setError(e.message))
            }
          >
            {t("Отсоединить экземпляр")}
          </button>
        </>
      )}
      {draft.conflict && (
        <p role="status">
          {t("Документ изменился. Ввод сохранён.")}{" "}
          <button
            onClick={() => setDraft((d) => rebaseDraft(d, project.revision))}
          >
            {t("Использовать актуальную ревизию")}
          </button>
        </p>
      )}
      {(validationError || error) && (
        <p role="alert">{validationError || error}</p>
      )}
      <button
        disabled={
          disabled ||
          node.locked ||
          !draft.dirty ||
          draft.conflict ||
          !!error ||
          !!validationError ||
          pendingPaint
        }
        onClick={() => void apply()}
      >
        {t("Применить слой")}
      </button>
      <button
        onClick={() => {
          setDraft(beginDraft(data, project.revision));
          setError("");
        }}
      >
        {t("Сбросить слой")}
      </button>
    </section>
  );
}
