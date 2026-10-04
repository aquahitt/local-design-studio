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
        throw new Error("Нужен JSON-объект свойств");
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
        Свойства JSON
        <textarea
          aria-label="Свойства JSON"
          value={draft.value}
          onChange={(e) => setDraft((d) => editDraft(d, e.target.value))}
          spellCheck={false}
        />
      </label>
      {draft.conflict && (
        <div role="status" className="notice">
          <strong>Документ изменился</strong>
          <p>
            Твой ввод сохранён. Базовая ревизия {draft.baseRevision}, актуальная{" "}
            {revision}.
          </p>
          <button onClick={() => setDraft((d) => rebaseDraft(d, revision))}>
            Сохранить мой ввод поверх новой ревизии
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="accent"
        disabled={!draft.dirty || draft.conflict}
        onClick={() => void apply()}
      >
        Применить свойства
      </button>
      <button onClick={() => setDraft(beginDraft(node.props, revision))}>
        Сбросить ввод
      </button>
    </section>
  );
}
