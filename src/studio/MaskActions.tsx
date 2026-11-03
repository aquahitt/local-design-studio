import { useEffect, useRef, useState } from "react";
import {
  CoreError,
  type Project,
  type ProjectNode,
  type ProjectPage,
} from "../core/project";
import { applyBatch, type Operation } from "../core/operations";
import { wrapMaskGroup, unwrapMaskGroup } from "../core/mask-groups";
import { definitionNodes, resolveSceneNodes } from "../core/design-components";
import { compileMaskSource } from "../core/mask-source";
import { serializeMaskSVG } from "../core/mask-svg";
import { hasLockedSceneDescendant } from "../core/scene-locks";
import { StudioSelect } from "./StudioSelect";
import { useI18n } from "./i18n";
import "./MaskActions.css";
type Mode = "alpha" | "luminance";
type Scope = {
  key: string;
  projectId: string;
  pageId: string;
  kind: "create" | "edit";
  groupId?: string;
  ids: string[];
  choices: { value: string; label: string }[];
  sourceId: string;
  mode: Mode;
};
type Draft = {
  scope: Scope;
  baseRevision: number;
  sourceId: string;
  mode: Mode;
};
function message(error: unknown): string {
  const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
  switch (code) {
    case "INVALID_MASK_SELECTION":
    case "INSUFFICIENT_SELECTION":
      return "Выбери соседние слои одного контейнера.";
    case "NODE_NOT_SCENE":
      return "Для маски нужны слои с геометрией на холсте.";
    case "NODE_LOCKED":
      return "Сначала разблокируй слои маски.";
    case "MASK_GROUP_COMPOSITING":
      return "У группы изменена прозрачность. Сними маску с сохранением группы.";
    case "MASK_SOURCE_UNSUPPORTED":
    case "MASK_IMAGE_UNAVAILABLE":
      return "Пока поддерживаются фреймы и векторы без текста и изображений.";
    case "REVISION_CONFLICT":
      return "Документ изменился. Обнови основу маски или сбрось изменения.";
    default:
      return "Не удалось изменить маску.";
  }
}
export function MaskActions({
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
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false);
  const projectId = useRef(project.projectId);
  projectId.current = project.projectId;
  const nodes = definitionNodes(page.nodes),
    ids = [...new Set(selectedIds)],
    single = ids.length === 1 ? nodes.get(ids[0]) : undefined;
  const group = single?.scene?.kind === "mask" ? single : undefined;
  const key = JSON.stringify([
    project.projectId,
    page.screenId,
    [...ids].sort(),
  ]);
  const options = (rows: ProjectNode[]) =>
    rows
      .filter(
        (node) =>
          node.maskSource ||
          node.instance ||
          node.scene?.kind === "frame" ||
          node.scene?.kind === "vector",
      )
      .map((node) => ({ value: node.id, label: node.name ?? node.id }));
  const live: Scope | undefined = group
    ? {
        key,
        projectId: project.projectId,
        pageId: page.screenId,
        kind: "edit",
        groupId: group.id,
        ids,
        choices: options(group.slots.children),
        sourceId: group.slots.children.find((node) => node.maskSource)!.id,
        mode: group.scene!.maskMode!,
      }
    : ids.length >= 2
      ? {
          key,
          projectId: project.projectId,
          pageId: page.screenId,
          kind: "create",
          ids,
          choices: options(
            ids.flatMap((id) => {
              const node = nodes.get(id);
              return node ? [node] : [];
            }),
          ),
          sourceId:
            ids.find((id) => {
              const node = nodes.get(id);
              return (
                node?.instance ||
                ["frame", "vector"].includes(node?.scene?.kind ?? "")
              );
            }) ?? ids[0],
          mode: "alpha",
        }
      : undefined;
  const scope = draft?.scope ?? live;
  const compatible =
    !!live &&
    !!scope &&
    live.key === scope.key &&
    live.kind === scope.kind &&
    live.groupId === scope.groupId;
  const conflict =
    !!draft && (!compatible || draft.baseRevision !== project.revision);
  const currentGroup = scope?.groupId ? nodes.get(scope.groupId) : undefined;
  const lockedIds = new Set<string>();
  function locks(rows: ProjectNode[], inherited = false) {
    for (const node of rows) {
      const locked = inherited || !!node.locked;
      if (locked) lockedIds.add(node.id);
      for (const children of Object.values(node.slots)) locks(children, locked);
    }
  }
  locks(page.nodes);
  const locked =
    !!scope &&
    scope.ids.some((id) => {
      const node = nodes.get(id);
      return (
        lockedIds.has(id) || (!!node && hasLockedSceneDescendant(project, node))
      );
    });
  const sourceId = draft?.sourceId ?? scope?.sourceId ?? "",
    mode = draft?.mode ?? scope?.mode ?? "alpha";
  useEffect(() => {
    onDirty(!!draft || busy);
    return () => onDirty(false);
  }, [draft, busy, onDirty]);
  useEffect(() => {
    if (!draft) setOpen(!!group);
  }, [key]);
  const change = (field: "sourceId" | "mode", value: string) => {
    if (!scope || disabled || busy || locked) return;
    const next: Draft = {
      scope,
      baseRevision: draft?.baseRevision ?? project.revision,
      sourceId,
      mode,
      [field]: value,
    };
    setDraft(
      next.baseRevision === project.revision &&
        compatible &&
        next.sourceId === scope.sourceId &&
        next.mode === scope.mode
        ? null
        : next,
    );
    setError("");
  };
  const validateSource = (next: Project, id: string) => {
    const rows = resolveSceneNodes(
        next,
        next.pages.find((row) => row.screenId === scope!.pageId)!.nodes,
      ),
      mask = definitionNodes(rows).get(id)!;
    const diagnostic = serializeMaskSVG(compileMaskSource(next, mask))
      .diagnostics[0];
    if (diagnostic) throw new CoreError(diagnostic.code);
  };
  const run = async (
    operations: Operation[],
    description: string,
    nextSelection?: string[],
    revision = project.revision,
  ) => {
    if (disabled || busy || locked) return;
    setBusy(true);
    setError("");
    try {
      await mutate(operations, description, revision);
      if (projectId.current === scope?.projectId) {
        setDraft(null);
        if (nextSelection) onSelection(nextSelection);
      }
    } catch (failure) {
      setError(t(message(failure)));
    } finally {
      setBusy(false);
    }
  };
  async function apply() {
    if (!scope || conflict || disabled || busy || locked) return;
    try {
      const revision = draft?.baseRevision ?? project.revision;
      if (scope.kind === "create") {
        const id = crypto.randomUUID(),
          operations = wrapMaskGroup(project, scope.ids, sourceId, id, mode);
        const insertion = operations[0];
        if (insertion.type === "insertNode") insertion.node.name = t("Маска");
        validateSource(
          applyBatch(project, {
            requestId: "mask-preflight",
            baseRevision: revision,
            operations,
          }),
          id,
        );
        await run(operations, t("Создать маску"), [id], revision);
      } else {
        const operations: Operation[] = [];
        if (
          currentGroup?.slots.children.find((node) => node.maskSource)?.id !==
          sourceId
        )
          operations.push({
            type: "setMaskSource",
            nodeId: scope.groupId!,
            sourceNodeId: sourceId,
          });
        if (currentGroup?.scene?.maskMode !== mode)
          operations.push({
            type: "setNodeMetadata",
            nodeId: scope.groupId!,
            scene: { maskMode: mode },
          });
        if (!operations.length) {
          setDraft(null);
          return;
        }
        const next = applyBatch(project, {
          requestId: "mask-preflight",
          baseRevision: revision,
          operations,
        });
        if (operations.some((operation) => operation.type === "setMaskSource"))
          validateSource(next, scope.groupId!);
        await run(operations, t("Изменить маску"), undefined, revision);
      }
    } catch (failure) {
      setError(t(message(failure)));
    }
  }
  const reset = () => {
    setDraft(null);
    setError("");
  };
  const rebase = () => {
    if (!draft || !live || !compatible) return;
    if (
      live.kind === "edit" &&
      !currentGroup?.slots.children.some((node) => node.id === draft.sourceId)
    )
      return;
    try {
      if (live.kind === "create")
        wrapMaskGroup(
          project,
          live.ids,
          draft.sourceId,
          "mask-preflight-" + crypto.randomUUID(),
          draft.mode,
        );
      setDraft({ ...draft, scope: live, baseRevision: project.revision });
      setError("");
    } catch (failure) {
      setError(t(message(failure)));
    }
  };
  let unwrapError = "";
  if (currentGroup?.scene?.kind === "mask")
    try {
      unwrapMaskGroup(project, currentGroup.id);
    } catch (failure) {
      unwrapError = t(message(failure));
    }
  if (!scope) {
    const parent = single?.maskSource
      ? [...nodes.values()].find(
          (node) =>
            node.scene?.kind === "mask" &&
            node.slots.children.some((child) => child.id === single.id),
        )
      : undefined;
    return parent ? (
      <div className="mask-actions">
        <span>{t("Источник маски")}</span>
        <p>{t("Сначала сними маску или выбери другой источник.")}</p>{" "}
        <button
          disabled={disabled || busy}
          onClick={() => onSelection([parent.id])}
        >
          {t("Настроить маску")}
        </button>
      </div>
    ) : null;
  }
  const blocked = disabled || busy || locked;
  return (
    <div className="mask-actions">
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          {t("Маска")}
          {draft ? " · " + t("Есть изменения") : ""}
        </summary>
        <p className="mask-actions-hint">
          {t("Пока поддерживаются фреймы и векторы без текста и изображений.")}
        </p>
        {locked && (
          <p className="mask-actions-hint">
            {t("Сначала разблокируй слои маски.")}
          </p>
        )}
        <div className="mask-actions-fields">
          <StudioSelect
            label={t("Источник маски")}
            value={sourceId}
            disabled={blocked || !scope.choices.length}
            onChange={(id) => change("sourceId", id)}
            sections={[{ label: t("Слои"), options: scope.choices }]}
          />
          <StudioSelect
            label={t("Режим маски")}
            value={mode}
            disabled={blocked}
            onChange={(value) => change("mode", value)}
            sections={[
              {
                label: "",
                options: [
                  { value: "alpha", label: t("По прозрачности (alpha)") },
                  { value: "luminance", label: t("По яркости (luminance)") },
                ],
              },
            ]}
          />
        </div>
        {conflict && (
          <div role="alert">
            <p>
              {t(
                "Документ изменился. Обнови основу маски или сбрось изменения.",
              )}
            </p>
            <button disabled={blocked || !compatible} onClick={rebase}>
              {t("Обновить основу маски")}
            </button>
          </div>
        )}
        <div className="mask-actions-buttons">
          <button
            disabled={
              blocked ||
              conflict ||
              !scope.choices.length ||
              (scope.kind === "edit" && !draft)
            }
            onClick={() => void apply()}
          >
            {t(scope.kind === "create" ? "Создать маску" : "Применить маску")}
          </button>
          {draft && (
            <button disabled={busy} onClick={reset}>
              {t("Сбросить изменения маски")}
            </button>
          )}
          {scope.kind === "edit" && (
            <>
              <button
                disabled={blocked || !!draft}
                onClick={() =>
                  void run(
                    [{ type: "removeMask", nodeId: scope.groupId! }],
                    t("Снять маску"),
                  )
                }
              >
                {t("Снять маску")}
              </button>
              <button
                disabled={blocked || !!draft || !!unwrapError}
                title={unwrapError || undefined}
                onClick={() => {
                  try {
                    void run(
                      unwrapMaskGroup(project, scope.groupId!),
                      t("Разгруппировать маску"),
                      currentGroup!.slots.children.map((node) => node.id),
                    );
                  } catch (failure) {
                    setError(t(message(failure)));
                  }
                }}
              >
                {t("Разгруппировать маску")}
              </button>
              <button
                disabled={blocked || !!draft}
                onClick={() => onSelection([sourceId])}
              >
                {t("Редактировать источник")}
              </button>
            </>
          )}
        </div>
        {unwrapError && scope.kind === "edit" && (
          <p className="mask-actions-hint">{unwrapError}</p>
        )}
        {error && <p role="alert">{error}</p>}
      </details>
    </div>
  );
}
