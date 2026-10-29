import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { GUIDE_LIMITS, type PageGuide } from "../core/guides";
import type { SceneView } from "../core/scene";
import { useI18n } from "./i18n";
import { StudioSelect } from "./StudioSelect";
import { restoreFocusOnClose } from "./shortcuts";
import "./CanvasGuides.css";

export type GuideContextScope = {
  projectId: string;
  pageId: string;
  revision: number;
};
export type GuideDraft = { scope: GuideContextScope; raw: string } & (
  | { kind: "create"; axis: PageGuide["axis"] }
  | { kind: "move"; guide: PageGuide }
);
/** Only the first edit captures identity/revision. Later props cannot rebase input. */
export function guideDraftInput(
  draft: GuideDraft | undefined,
  scope: GuideContextScope,
  raw: string,
  guide?: PageGuide,
  axis: PageGuide["axis"] = "x",
): GuideDraft {
  if (draft) {
    if ((draft.kind === "move" ? draft.guide.id : undefined) !== guide?.id)
      return draft;
    return draft.kind === "create"
      ? { ...draft, raw, axis }
      : { ...draft, raw };
  }
  return guide
    ? { kind: "move", guide: { ...guide }, scope: { ...scope }, raw }
    : { kind: "create", axis, scope: { ...scope }, raw };
}
export function guideDraftStatus(
  draft: GuideDraft,
  current: GuideContextScope,
  available = true,
) {
  const stale =
    draft.scope.projectId !== current.projectId ||
    draft.scope.pageId !== current.pageId ||
    draft.scope.revision !== current.revision;
  const text = draft.raw.trim();
  const position = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
    ? Number(text)
    : NaN;
  const numeric =
    Number.isFinite(position) && Math.abs(position) <= GUIDE_LIMITS.position;
  const changed = draft.kind === "create" || position !== draft.guide.position;
  return {
    stale,
    numeric,
    changed,
    position,
    valid:
      available &&
      !stale &&
      numeric &&
      changed &&
      !(draft.kind === "move" && draft.guide.locked),
  };
}
type GuideCreateIntent = { axis: PageGuide["axis"]; position: number };
type GuideIntentCursor = { open: boolean; intent?: GuideCreateIntent };
/** Even an ignored intent is consumed; cancelling input must not replay it later. */
export function guideCreateIntent(
  previous: GuideIntentCursor,
  input: {
    open: boolean;
    intent?: GuideCreateIntent;
    scope: GuideContextScope;
    available: boolean;
    disabled: boolean;
    busy: boolean;
    draft?: GuideDraft;
  },
): { cursor: GuideIntentCursor; draft?: GuideDraft } {
  const fresh =
    input.open && (!previous.open || input.intent !== previous.intent);
  return {
    cursor: { open: input.open, intent: input.intent },
    draft:
      fresh &&
      input.intent &&
      !input.draft &&
      input.available &&
      !input.disabled &&
      !input.busy
        ? guideDraftInput(
            undefined,
            input.scope,
            String(input.intent.position),
            undefined,
            input.intent.axis,
          )
        : undefined,
  };
}

export type ProjectedGuideLine = {
  guide: PageGuide;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
export function projectGuideLines(
  view: SceneView,
  size: { width: number; height: number },
  guides: readonly PageGuide[],
): ProjectedGuideLine[] {
  if (
    ![view.zoom, view.panX, view.panY, size.width, size.height].every(
      Number.isFinite,
    ) ||
    view.zoom <= 0 ||
    size.width <= 0 ||
    size.height <= 0
  )
    return [];
  return guides.slice(0, GUIDE_LIMITS.count).flatMap((guide) => {
    const position =
      guide.position * view.zoom + (guide.axis === "x" ? view.panX : view.panY);
    if (
      !Number.isFinite(position) ||
      position < 0 ||
      position > (guide.axis === "x" ? size.width : size.height)
    )
      return [];
    return [
      {
        guide,
        ...(guide.axis === "x"
          ? { x1: position, y1: 0, x2: position, y2: size.height }
          : { x1: 0, y1: position, x2: size.width, y2: position }),
      },
    ];
  });
}
export function CanvasGuideOverlay({
  view,
  size,
  guides,
  transientPositions,
  disabled = false,
  onGuidePointerDown,
  onGuideKeyDown,
}: {
  view: SceneView;
  size: { width: number; height: number };
  guides: readonly PageGuide[];
  transientPositions?: ReadonlyMap<string, number>;
  disabled?: boolean;
  onGuidePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    guideId: string,
  ) => void;
  onGuideKeyDown?: (
    event: KeyboardEvent<HTMLButtonElement>,
    guideId: string,
  ) => void;
}) {
  const { t } = useI18n();
  const indexes = new Map(guides.map((guide, index) => [guide.id, index + 1]));
  const lines = projectGuideLines(
    view,
    size,
    guides.map((guide) =>
      transientPositions?.has(guide.id)
        ? { ...guide, position: transientPositions.get(guide.id)! }
        : guide,
    ),
  );
  return (
    <div className="canvas-guide-overlay">
      <svg
        width={size.width}
        height={size.height}
        aria-hidden="true"
        className="canvas-guide-lines"
      >
        {lines.map(({ guide, ...line }) => (
          <line
            key={guide.id}
            {...line}
            className={guide.locked ? "is-locked" : undefined}
          />
        ))}
      </svg>
      {lines.map(({ guide, x1, y1 }) => (
        <button
          key={guide.id}
          type="button"
          tabIndex={-1}
          className={`canvas-guide-handle axis-${guide.axis}`}
          data-guide-id={guide.id}
          aria-label={t("Направляющая {index}: {axis}, {position} px", {
            index: indexes.get(guide.id)!,
            axis: t(guide.axis === "x" ? "Вертикальная" : "Горизонтальная"),
            position: guide.position,
          })}
          disabled={disabled || guide.locked}
          style={
            guide.axis === "x"
              ? {
                  left: Math.max(0, Math.min(size.width - 24, x1 - 12)),
                  top: 0,
                  height: size.height,
                }
              : {
                  left: 0,
                  top: Math.max(0, Math.min(size.height - 24, y1 - 12)),
                  width: size.width,
                }
          }
          onPointerDown={(event) => {
            if (!disabled && !guide.locked) onGuidePointerDown(event, guide.id);
          }}
          onKeyDown={(event) => onGuideKeyDown?.(event, guide.id)}
        />
      ))}
    </div>
  );
}

type PanelProps = {
  open: boolean;
  onClose: () => void;
  guides: readonly PageGuide[];
  contextScope: GuideContextScope;
  disabled?: boolean;
  available?: boolean;
  initialCreate?: { axis: PageGuide["axis"]; position: number };
  onDirtyChange?: (dirty: boolean) => void;
  onCreate: (
    guide: Pick<PageGuide, "axis" | "position">,
    scope: GuideContextScope,
  ) => Promise<void>;
  onMove: (
    id: string,
    position: number,
    scope: GuideContextScope,
  ) => Promise<void>;
  onRemove: (id: string, scope: GuideContextScope) => Promise<void>;
  onLock: (
    id: string,
    locked: boolean,
    scope: GuideContextScope,
  ) => Promise<void>;
};
function GuideActionIcon({
  kind,
}: {
  kind: "close" | "lock" | "unlock" | "delete";
}) {
  const path = {
    close: "M6 6l12 12M18 6L6 18",
    lock: "M7 10V7a5 5 0 0110 0v3M5 10h14v11H5z",
    unlock: "M7 10V7a5 5 0 019-3M5 10h14v11H5z",
    delete: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7M14 10v7",
  }[kind];
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
export function CanvasGuidePanel({
  open,
  onClose,
  guides,
  contextScope,
  disabled = false,
  available = true,
  initialCreate,
  onDirtyChange,
  onCreate,
  onMove,
  onRemove,
  onLock,
}: PanelProps) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null),
    createInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<GuideDraft>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true),
    pending = useRef(false),
    latest = useRef({ contextScope, available });
  const dirtyCallback = useRef(onDirtyChange),
    dirty = Boolean(draft);
  latest.current = { contextScope, available };
  dirtyCallback.current = onDirtyChange;
  useEffect(() => {
    dirtyCallback.current?.(dirty);
  }, [dirty]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dirtyCallback.current?.(false);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const restore = restoreFocusOnClose(document),
      node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => {
      node?.close();
      restore();
    };
  }, [open]);
  const intentCursor = useRef<GuideIntentCursor>({ open: false });
  useEffect(() => {
    const next = guideCreateIntent(intentCursor.current, {
      open,
      intent: initialCreate,
      scope: contextScope,
      available,
      disabled,
      busy: pending.current,
      draft,
    });
    intentCursor.current = next.cursor;
    if (next.draft) setDraft(next.draft);
  }, [open, initialCreate, draft, contextScope, available, disabled]);
  useEffect(() => {
    if (open && draft?.kind === "create") createInput.current?.focus();
  }, [open, draft?.kind]);
  const status = draft
    ? guideDraftStatus(draft, contextScope, available)
    : undefined;
  const blocked = disabled || busy || !available;
  const rows =
    draft?.kind === "move" &&
    !guides.some((guide) => guide.id === draft.guide.id)
      ? [...guides, draft.guide]
      : guides;
  function discard() {
    if (!busy) {
      setDraft(undefined);
      setError("");
    }
  }
  async function run(
    action: () => Promise<void>,
    scope: GuideContextScope,
    clear = false,
  ) {
    if (pending.current || disabled || !available) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      if (
        mounted.current &&
        clear &&
        latest.current.available &&
        latest.current.contextScope.projectId === scope.projectId &&
        latest.current.contextScope.pageId === scope.pageId
      )
        setDraft(undefined);
    } catch (caught) {
      if (mounted.current)
        setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function apply() {
    if (!draft || !status?.valid || blocked) return;
    const scope = { ...draft.scope };
    void run(
      () =>
        draft.kind === "create"
          ? onCreate({ axis: draft.axis, position: status.position }, scope)
          : onMove(draft.guide.id, status.position, scope),
      scope,
      true,
    );
  }
  if (!open) return null;
  const createDraft = draft?.kind === "create" ? draft : undefined;
  return (
    <dialog
      ref={dialog}
      className="canvas-guide-dialog"
      aria-label={t("Направляющие страницы")}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !dirty) onClose();
      }}
    >
      <header>
        <h2>{t("Направляющие страницы")}</h2>
        <button
          type="button"
          aria-label={t("Закрыть направляющие")}
          title={
            dirty
              ? t("Сначала сохраните или отмените ввод.")
              : t("Закрыть направляющие")
          }
          disabled={busy || dirty}
          onClick={onClose}
        >
          <GuideActionIcon kind="close" />
        </button>
      </header>
      {!available ? (
        <p role="status" className="canvas-guide-notice">
          {t("Страница недоступна. Ввод сохранён.")}
        </p>
      ) : status?.stale ? (
        <p role="status" className="canvas-guide-notice">
          {t(
            "Страница изменилась. Ввод сохранён. Отмените ввод и проверьте актуальную страницу.",
          )}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="canvas-guide-error">
          {t(error)}
        </p>
      ) : null}
      <section
        className="canvas-guide-create"
        aria-label={t("Создать направляющую")}
      >
        <StudioSelect
          label={t("Ось направляющей")}
          value={createDraft?.axis ?? "x"}
          disabled={blocked || draft?.kind === "move"}
          sections={[
            {
              label: t("Ось направляющей"),
              options: [
                { value: "x", label: t("Вертикальная (X)") },
                { value: "y", label: t("Горизонтальная (Y)") },
              ],
            },
          ]}
          onChange={(axis) =>
            setDraft((previous) =>
              guideDraftInput(
                previous,
                contextScope,
                createDraft?.raw ?? "0",
                undefined,
                axis === "y" ? "y" : "x",
              ),
            )
          }
        />
        <label>
          {t("Позиция направляющей")}
          <input
            ref={createInput}
            type="text"
            inputMode="decimal"
            value={createDraft?.raw ?? "0"}
            readOnly={blocked || draft?.kind === "move"}
            onChange={(event) =>
              setDraft((previous) =>
                guideDraftInput(
                  previous,
                  contextScope,
                  event.target.value,
                  undefined,
                  createDraft?.axis ?? "x",
                ),
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && createDraft) {
                event.preventDefault();
                apply();
              }
            }}
          />
        </label>
        <button
          type="button"
          disabled={
            blocked ||
            draft?.kind === "move" ||
            (createDraft && !status?.valid) ||
            guides.length >= GUIDE_LIMITS.count
          }
          onClick={() => {
            if (createDraft) {
              apply();
              return;
            }
            const scope = { ...contextScope };
            void run(() => onCreate({ axis: "x", position: 0 }, scope), scope);
          }}
        >
          {t("Создать направляющую")}
        </button>
      </section>
      {guides.length >= GUIDE_LIMITS.count ? (
        <p role="status">
          {t("Достигнут лимит направляющих: {count}.", {
            count: GUIDE_LIMITS.count,
          })}
        </p>
      ) : null}
      {!rows.length ? (
        <p className="canvas-guide-empty">{t("Направляющих пока нет")}</p>
      ) : (
        <ul className="canvas-guide-list">
          {rows.map((guide, index) => {
            const editing =
              draft?.kind === "move" && draft.guide.id === guide.id;
            const value = editing ? draft.raw : String(guide.position);
            return (
              <li key={guide.id} data-guide-row={guide.id}>
                <span className="canvas-guide-id">
                  {guide.axis.toUpperCase()} · {index + 1}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={t("Позиция направляющей {index}", {
                    index: index + 1,
                  })}
                  title={
                    guide.locked
                      ? t(
                          "Заблокированную направляющую сначала нужно разблокировать.",
                        )
                      : undefined
                  }
                  value={value}
                  readOnly={
                    blocked || guide.locked || Boolean(draft && !editing)
                  }
                  onChange={(event) =>
                    setDraft((previous) =>
                      guideDraftInput(
                        previous,
                        contextScope,
                        event.target.value,
                        guide,
                      ),
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && editing) {
                      event.preventDefault();
                      apply();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={blocked || dirty}
                  aria-label={t(
                    guide.locked
                      ? "Разблокировать направляющую {index}"
                      : "Заблокировать направляющую {index}",
                    { index: index + 1 },
                  )}
                  onClick={() => {
                    const scope = { ...contextScope };
                    void run(
                      () => onLock(guide.id, !guide.locked, scope),
                      scope,
                    );
                  }}
                >
                  <GuideActionIcon kind={guide.locked ? "unlock" : "lock"} />
                </button>
                <button
                  type="button"
                  disabled={blocked || dirty || guide.locked}
                  aria-label={t("Удалить направляющую {index}", {
                    index: index + 1,
                  })}
                  onClick={() => {
                    const scope = { ...contextScope };
                    void run(() => onRemove(guide.id, scope), scope);
                  }}
                >
                  <GuideActionIcon kind="delete" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {draft ? (
        <footer aria-label={t("Изменения направляющей")}>
          {!status?.numeric ? (
            <p role="status">{t("Введите число от −1000000 до 1000000.")}</p>
          ) : null}
          {draft.kind === "move" ? (
            <button
              type="button"
              disabled={blocked || !status?.valid}
              onClick={apply}
            >
              {t("Сохранить позицию")}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={discard}>
            {t("Отменить ввод")}
          </button>
        </footer>
      ) : null}
    </dialog>
  );
}
