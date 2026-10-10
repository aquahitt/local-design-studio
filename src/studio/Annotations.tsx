import { useI18n } from "./i18n";
import { useState } from "react";
import type { Project, ProjectPage } from "../core/project";
import type { Operation } from "../core/operations";
import { readAnnotations, type ProjectAnnotation } from "../core/annotations";

export function Annotations({
  project,
  page,
  nodeId,
  disabled,
  mutate,
  onVariant,
}: {
  project: Project;
  page: ProjectPage;
  nodeId: string | null;
  disabled: boolean;
  mutate: (
    operations: Operation[],
    description: string,
    revision?: number,
  ) => Promise<void>;
  onVariant: (id: string) => void;
}) {
  const { t } = useI18n();

  const [text, setText] = useState(""),
    [decision, setDecision] = useState("");
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false),
    [variantName, setVariantName] = useState("");
  const rows = readAnnotations(
    project,
    showAll ? { limit: 500 } : { pageId: page.screenId, limit: 500 },
  );
  async function run(work: () => Promise<void>) {
    if (disabled || busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const blocked = disabled || busy;
  const conflict = draftRevision !== null && draftRevision !== project.revision;
  function edit(value: string, field: "text" | "decision") {
    if (draftRevision === null) setDraftRevision(project.revision);
    (field === "text" ? setText : setDecision)(value);
  }
  return (
    <details className="panel annotations">
      <summary>
        {t("Комментарии и варианты ·")} {rows.pagination.total}
      </summary>
      {page.provenance && (
        <p>
          {t("Вариант экрана")} {page.provenance.sourcePageId}
          {t(", ревизия")} {page.provenance.sourceRevision}
        </p>
      )}
      <label>
        {t("Комментарий")}
        <textarea
          aria-label={t("Новый комментарий")}
          value={text}
          onChange={(e) => edit(e.target.value, "text")}
        />
      </label>
      <label>
        {t("Обоснование решения")}
        <textarea
          aria-label={t("Обоснование решения")}
          value={decision}
          onChange={(e) => edit(e.target.value, "decision")}
        />
      </label>
      <p>
        {nodeId
          ? t("Привязка к слою {0}", { 0: nodeId })
          : t("Привязка к экрану {0}", { 0: page.name })}
      </p>
      {conflict && (
        <p role="status">
          {t("Документ изменился. Ввод сохранён.")}{" "}
          <button onClick={() => setDraftRevision(project.revision)}>
            {t("Использовать актуальную ревизию")}
          </button>
        </p>
      )}
      <button
        disabled={blocked || !text.trim() || conflict}
        onClick={() =>
          void run(async () => {
            const annotation: ProjectAnnotation = {
              id: crypto.randomUUID(),
              pageId: page.screenId,
              ...(nodeId ? { nodeId } : {}),
              text: text.trim(),
              ...(decision.trim() ? { decision: decision.trim() } : {}),
              status: "open",
              createdAt: new Date().toISOString(),
            };
            await mutate(
              [
                {
                  type: "setAnnotations",
                  annotations: [...(project.annotations ?? []), annotation],
                },
              ],
              t("Добавить комментарий"),
              draftRevision ?? project.revision,
            );
            setText("");
            setDecision("");
            setDraftRevision(null);
          })
        }
      >
        {t("Добавить комментарий")}
      </button>
      <label>
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
        />
        {t("Все комментарии проекта")}
      </label>
      <ul>
        {rows.annotations.map((row) => (
          <li key={row.id}>
            <p>{row.text}</p>
            {row.decision && (
              <p>
                {t("Решение:")} {row.decision}
              </p>
            )}
            <small>
              {row.status === "resolved" ? t("Решён") : t("Открыт")}
              {row.orphaned ? t(" · привязка удалена") : ""} ·{" "}
              {new Date(row.createdAt).toLocaleString("ru")}
            </small>
            <button
              disabled={blocked}
              onClick={() =>
                void run(() =>
                  mutate(
                    [
                      {
                        type: "setAnnotations",
                        annotations: (project.annotations ?? []).map(
                          (annotation) =>
                            annotation.id === row.id
                              ? {
                                  ...annotation,
                                  status:
                                    row.status === "open" ? "resolved" : "open",
                                }
                              : annotation,
                        ),
                      },
                    ],
                    t("Изменить статус комментария"),
                  ),
                )
              }
            >
              {row.status === "open" ? t("Решить") : t("Открыть снова")}
            </button>
          </li>
        ))}
      </ul>
      {rows.pagination.truncated && (
        <p>
          {t("Показаны первые 500 комментариев. Остальные доступны через MCP.")}
        </p>
      )}
      <label>
        {t("Название варианта")}
        <input
          aria-label={t("Название варианта экрана")}
          value={variantName}
          onChange={(e) => setVariantName(e.target.value)}
        />
      </label>
      <button
        disabled={blocked || !variantName.trim()}
        onClick={() =>
          void run(async () => {
            const id = crypto.randomUUID();
            await mutate(
              [
                {
                  type: "duplicatePage",
                  pageId: page.screenId,
                  newPageId: id,
                  name: variantName.trim(),
                },
              ],
              t("Создать вариант экрана"),
            );
            setVariantName("");
            onVariant(id);
          })
        }
      >
        {t("Создать вариант экрана")}
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
