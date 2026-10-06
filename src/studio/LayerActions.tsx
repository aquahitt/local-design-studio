import { useI18n } from "./i18n";
import { useEffect, useState } from "react";
import type { Project, ProjectPage, ProjectNode } from "../core/project";
import type { Operation } from "../core/operations";
import {
  copyLayers,
  pasteLayers,
  duplicateLayers,
  layerCommandOperations,
  type LayerClipboard,
} from "../core/layer-commands";
import { useStudioShortcuts } from "./shortcuts";
import { StudioSelect } from "./StudioSelect";

const CLIPBOARD = "studio-layer-clipboard-v1";
export function LayerActions({
  project,
  page,
  selectedIds,
  disabled,
  mutate,
  onSelection,
  onDirty,
}: {
  project: Project;
  page: ProjectPage;
  selectedIds: string[];
  disabled: boolean;
  mutate: (
    operations: Operation[],
    description: string,
    revision?: number,
  ) => Promise<void>;
  onSelection: (ids: string[]) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();

  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [destinationPage, setDestinationPage] = useState(page.screenId),
    [parent, setParent] = useState("");
  const [definition, setDefinition] = useState("");
  const [definitionDraft, setDefinitionDraft] = useState<{
    id: string;
    revision: number;
    text: string;
    original: string;
  } | null>(null);
  useEffect(() => {
    setDestinationPage(page.screenId);
    setParent("");
  }, [page.screenId]);
  const target =
    project.pages.find((p) => p.screenId === destinationPage) ?? page;
  function all(nodes: ProjectNode[]): ProjectNode[] {
    return nodes.flatMap((node) => [
      node,
      ...Object.values(node.slots).flatMap(all),
    ]);
  }
  const frames = all(target.nodes).filter(
    (node) => node.scene?.kind === "frame" && !node.locked,
  );
  async function run(work: () => Promise<void>) {
    if (busy || disabled) return;
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
  const definitionDirty = Boolean(
    definitionDraft && definitionDraft.text !== definitionDraft.original,
  );
  useEffect(() => {
    onDirty?.(definitionDirty);
    return () => onDirty?.(false);
  }, [definitionDirty, onDirty]);
  const blocked = disabled || busy || definitionDirty;
  const selectionEnabled = () =>
    !blocked && !definitionDirty && selectedIds.length > 0;
  const duplicate = () =>
    run(async () => {
      const result = duplicateLayers(project, selectedIds);
      await mutate(result.operations, t("Дублировать слои"));
      onSelection(Object.values(result.idMap));
    });
  const copy = () =>
    run(async () => {
      localStorage.setItem(
        CLIPBOARD,
        JSON.stringify(copyLayers(project, selectedIds)),
      );
    });
  const remove = () =>
    run(async () => {
      await mutate(
        layerCommandOperations(project, selectedIds, { type: "delete" }),
        t("Удалить слои"),
      );
      onSelection([]);
    });
  useStudioShortcuts([
    {
      id: "duplicate",
      shortcut: "Mod+D",
      enabled: selectionEnabled,
      run: duplicate,
    },
    { id: "copy", shortcut: "Mod+C", enabled: selectionEnabled, run: copy },
    {
      id: "paste",
      shortcut: "Mod+V",
      enabled: () => !blocked && !definitionDirty,
      run: () => run(paste),
    },
    {
      id: "delete",
      shortcut: "Delete",
      enabled: selectionEnabled,
      run: remove,
    },
    {
      id: "delete-backspace",
      shortcut: "Backspace",
      enabled: selectionEnabled,
      run: remove,
    },
  ]);
  const command = (type: "hidden" | "locked", value: boolean) =>
    run(() =>
      mutate(
        layerCommandOperations(project, selectedIds, { type, value }),
        value
          ? t("Включить {0}", { 0: type })
          : t("Выключить {0}", { 0: type }),
      ),
    );
  function add(kind: "frame" | "text" | "vector") {
    return run(async () => {
      const id = crypto.randomUUID();
      const node: ProjectNode = {
        id,
        type:
          kind === "frame"
            ? "SceneFrame"
            : kind === "text"
              ? "SceneText"
              : "SceneVector",
        name: kind === "frame" ? "Фрейм" : kind === "text" ? "Текст" : "Вектор",
        props: kind === "text" ? { text: "Новый текст" } : {},
        slots: kind === "frame" ? { content: [] } : {},
        scene: {
          kind,
          x: 24,
          y: 24,
          width: kind === "frame" ? 300 : 160,
          height: kind === "frame" ? 240 : 60,
          ...(kind === "frame"
            ? { fill: "#ffffff" }
            : kind === "text"
              ? { fill: "#17202c", fontSize: 20 }
              : { path: "M0 0L160 60", stroke: "#4673e8", strokeWidth: 2 }),
        },
      };
      await mutate(
        [
          {
            type: "insertNode",
            pageId: page.screenId,
            index: page.nodes.length,
            node,
          },
        ],
        t("Добавить ") + node.name,
      );
      onSelection([id]);
    });
  }
  async function paste() {
    const text = localStorage.getItem(CLIPBOARD);
    if (!text) throw new Error(t("Сначала скопируй слои."));
    const clipboard = JSON.parse(text) as LayerClipboard;
    const targetFrame = frames.find((frame) => frame.id === parent),
      slot = targetFrame && Object.keys(targetFrame.slots)[0];
    const result = pasteLayers(project, clipboard, {
      pageId: target.screenId,
      ...(targetFrame ? { parentId: targetFrame.id, slot } : {}),
      index: targetFrame
        ? targetFrame.slots[slot!].length
        : target.nodes.length,
    });
    await mutate(result.operations, t("Вставить слои"));
    onSelection(
      result.operations
        .filter((op) => op.type === "insertNode")
        .map((op) => op.node.id),
    );
    if (result.diagnostics.length)
      setError(
        t("Отсутствуют ресурсы: ") +
          result.diagnostics.map((d) => d.asset).join(", "),
      );
  }
  async function define() {
    const name = prompt(t("Название компонента"), t("Новый компонент"));
    if (!name?.trim()) return;
    const copied = copyLayers(project, selectedIds).nodes;
    function fresh(nodes: ProjectNode[]) {
      for (const node of nodes) {
        node.id = crypto.randomUUID();
        Object.values(node.slots).forEach(fresh);
      }
    }
    fresh(copied);
    if (copied.length === 1 && copied[0].scene) {
      copied[0].scene.x = 0;
      copied[0].scene.y = 0;
    }
    const id = crypto.randomUUID();
    await mutate(
      [
        {
          type: "setDesignComponents",
          definitions: [
            ...(project.designComponents ?? []),
            { id, name: name.trim(), version: 1, nodes: copied },
          ],
        },
      ],
      t("Создать определение компонента"),
    );
    setDefinition(id);
  }
  return (
    <section className="panel layer-actions" aria-label={t("Команды слоёв")}>
      <div className="layer-toolbar">
        <button disabled={blocked} onClick={() => void add("frame")}>
          {t("Фрейм +")}
        </button>
        <button disabled={blocked} onClick={() => void add("text")}>
          {t("Текст +")}
        </button>
        <button disabled={blocked} onClick={() => void add("vector")}>
          {t("Вектор +")}
        </button>
        <button
          disabled={blocked || !selectedIds.length}
          aria-keyshortcuts="Control+D Meta+D"
          onClick={() => void duplicate()}
        >
          {t("Дублировать")}
        </button>
        <button
          disabled={blocked || !selectedIds.length}
          aria-keyshortcuts="Control+C Meta+C"
          onClick={() => void copy()}
        >
          {t("Копировать")}
        </button>
        <button
          disabled={blocked}
          aria-keyshortcuts="Control+V Meta+V"
          onClick={() => void run(paste)}
        >
          {t("Вставить")}
        </button>
        <button
          disabled={blocked || !selectedIds.length}
          onClick={() => void command("hidden", true)}
        >
          {t("Скрыть")}
        </button>
        <button
          disabled={blocked || !selectedIds.length}
          onClick={() => void command("hidden", false)}
        >
          {t("Показать")}
        </button>
        <button
          disabled={blocked || !selectedIds.length}
          onClick={() => void command("locked", true)}
        >
          {t("Заблокировать")}
        </button>
        <button
          disabled={blocked || !selectedIds.length}
          onClick={() => void command("locked", false)}
        >
          {t("Разблокировать")}
        </button>
        <button
          disabled={blocked || !selectedIds.length}
          aria-keyshortcuts="Delete Backspace"
          onClick={() => void remove()}
        >
          {t("Удалить выбранные")}
        </button>
      </div>
      <div className="layer-toolbar">
        <StudioSelect
          label={t("Экран назначения")}
          value={target.screenId}
          disabled={blocked}
          onChange={(id) => {
            setDestinationPage(id);
            setParent("");
          }}
          sections={[
            {
              label: "",
              options: project.pages.map((p) => ({
                value: p.screenId,
                label: p.name,
              })),
            },
          ]}
        />
        <StudioSelect
          label={t("Фрейм назначения")}
          value={parent}
          disabled={blocked}
          onChange={setParent}
          sections={[
            {
              label: "",
              options: [
                { value: "", label: t("Корень экрана") },
                ...frames.map((node) => ({
                  value: node.id,
                  label: node.name ?? node.id,
                })),
              ],
            },
          ]}
        />
        <button
          disabled={blocked || !selectedIds.length}
          onClick={() =>
            void run(async () => {
              const roots = copyLayers(project, selectedIds).nodes;
              const frame = frames.find((node) => node.id === parent),
                slot = frame && Object.keys(frame.slots)[0];
              let index = frame
                ? frame.slots[slot!].length
                : target.nodes.length;
              const sourceList = frame ? frame.slots[slot!] : target.nodes;
              index -= roots.filter((node) =>
                sourceList.some((current) => current.id === node.id),
              ).length;
              await mutate(
                roots.map((node, offset) => ({
                  type: "moveNode",
                  nodeId: node.id,
                  pageId: target.screenId,
                  ...(frame ? { parentId: frame.id, slot } : {}),
                  index: index + offset,
                })),
                t("Перенести слои"),
              );
            })
          }
        >
          {t("Перенести")}
        </button>
      </div>
      <details>
        <summary>{t("Компоненты дизайна")}</summary>
        <div className="layer-toolbar">
          <button
            disabled={blocked || !selectedIds.length}
            onClick={() => void run(define)}
          >
            {t("Создать из выбранного")}
          </button>
          <StudioSelect
            label={t("Определение компонента")}
            value={definition}
            fallback={t("Выбери компонент")}
            disabled={blocked}
            onChange={setDefinition}
            sections={[
              {
                label: "",
                options: (project.designComponents ?? []).map((d) => ({
                  value: d.id,
                  label: d.name,
                })),
              },
            ]}
          />
          <button
            disabled={blocked || !definition}
            onClick={() =>
              void run(async () => {
                const id = crypto.randomUUID();
                await mutate(
                  [
                    {
                      type: "insertNode",
                      pageId: page.screenId,
                      index: page.nodes.length,
                      node: {
                        id,
                        type: "DesignInstance",
                        props: {},
                        slots: {},
                        instance: { definitionId: definition },
                        scene: {
                          kind: "component",
                          x: 24,
                          y: 24,
                          width: 320,
                          height: 240,
                        },
                      },
                    },
                  ],
                  t("Добавить экземпляр"),
                );
                onSelection([id]);
              })
            }
          >
            {t("Экземпляр +")}
          </button>
          <button
            disabled={blocked || !definition}
            onClick={() => {
              const current = project.designComponents?.find(
                (d) => d.id === definition,
              );
              if (!current) return;
              setDefinitionDraft({
                id: current.id,
                revision: project.revision,
                text: JSON.stringify(current, null, 2),
                original: JSON.stringify(current, null, 2),
              });
            }}
          >
            {t("Изменить определение")}
          </button>
        </div>
      </details>
      {definitionDraft && (
        <section className="inspector" aria-label={t("Редактор определения")}>
          <label>
            {t("Определение, варианты и свойства")}
            <textarea
              aria-label={t("Определение компонента JSON")}
              rows={14}
              value={definitionDraft.text}
              onChange={(event) =>
                setDefinitionDraft({
                  ...definitionDraft,
                  text: event.target.value,
                })
              }
            />
          </label>
          {definitionDraft.revision !== project.revision && (
            <p role="status">
              {t("Документ изменился. Ввод сохранён.")}{" "}
              <button
                onClick={() =>
                  setDefinitionDraft({
                    ...definitionDraft,
                    revision: project.revision,
                  })
                }
              >
                {t("Использовать актуальную ревизию")}
              </button>
            </p>
          )}
          <button
            disabled={
              disabled || busy || definitionDraft.revision !== project.revision
            }
            onClick={() =>
              void run(async () => {
                const next = JSON.parse(definitionDraft.text);
                if (next.id !== definitionDraft.id)
                  throw new Error(t("Идентификатор определения менять нельзя"));
                await mutate(
                  [
                    {
                      type: "setDesignComponents",
                      definitions: (project.designComponents ?? []).map(
                        (row) => (row.id === definitionDraft.id ? next : row),
                      ),
                    },
                  ],
                  t("Обновить определение компонента"),
                  definitionDraft.revision,
                );
                setDefinitionDraft(null);
              })
            }
          >
            {t("Сохранить определение")}
          </button>
          <button disabled={busy} onClick={() => setDefinitionDraft(null)}>
            {t("Закрыть определение")}
          </button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
