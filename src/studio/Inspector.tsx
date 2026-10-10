import { useI18n } from "./i18n";
import { useEffect, useState } from "react";
import type { ProjectNode } from "../core/project";
import { beginDraft, editDraft, receiveDraft, rebaseDraft } from "./draft";
export function Inspector({
  node,
  revision,
  onApply,
  onDirty,
}: {
  node: ProjectNode;
  revision: number;
  onApply: (
    props: Record<string, unknown>,
    baseRevision: number,
  ) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useI18n();

  const [draft, setDraft] = useState(() => beginDraft(node.props, revision));
  const [error, setError] = useState("");
  useEffect(
    () => setDraft((d) => receiveDraft(d, node.props, revision)),
    [node.props, revision],
  );
  useEffect(() => {
    onDirty(draft.dirty);
    return () => onDirty(false);
  }, [draft.dirty, onDirty]);
  async function apply() {
    try {
      const props = JSON.parse(draft.value);
      if (!props || Array.isArray(props) || typeof props !== "object")
        throw new Error(t("Нужен JSON-объект свойств"));
      await onApply(props, draft.baseRevision);
      setDraft(beginDraft(props, draft.baseRevision + 1));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="inspector">
      <h3>{node.type}</h3>
      <p className="mono">{node.id}</p>
      <label>
        {t("Свойства JSON")}
        <textarea
          aria-label={t("Свойства JSON")}
          value={draft.value}
          onChange={(e) => setDraft((d) => editDraft(d, e.target.value))}
          spellCheck={false}
        />
      </label>
      {draft.conflict && (
        <div role="status" className="notice">
          <strong>{t("Документ изменился")}</strong>
          <p>
            {t("Твой ввод сохранён. Базовая ревизия")} {draft.baseRevision}
            {t(", актуальная")} {revision}.
          </p>
          <button onClick={() => setDraft((d) => rebaseDraft(d, revision))}>
            {t("Сохранить мой ввод поверх новой ревизии")}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="accent"
        disabled={!draft.dirty || draft.conflict}
        onClick={() => void apply()}
      >
        {t("Применить свойства")}
      </button>
      <button onClick={() => setDraft(beginDraft(node.props, revision))}>
        {t("Сбросить ввод")}
      </button>
    </section>
  );
}
