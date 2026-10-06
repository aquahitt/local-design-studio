import { useI18n } from "./i18n";
import { StudioSelect } from "./StudioSelect";
import { Assets } from "./Assets";
import { LayerActions } from "./LayerActions";
import { NodeLayoutInspector } from "./NodeLayoutInspector";
import { Annotations } from "./Annotations";
import { Handoff } from "./Handoff";
import { StudioLanguageChoice } from "./i18n";
import { useStudioShortcuts } from "./shortcuts";
import { desktopMetadataLibrary } from "./desktopLibraries";
import { DesktopLibraryContext } from "./desktopLibraryContext";
import type { DesktopLibrary } from "../desktop/types";
import { Groups, inGroup } from "./Groups";
import { DEVICE_PRESETS } from "./devicePresets";
import { ViewportControls } from "./ViewportControls";
import { DeviceFrame } from "./DeviceFrame";
import { contentViewport } from "../core/viewport";
import {
  StudioThemeChoice,
  studioThemeStyle,
  StudioButton,
  StudioHeading,
  LocalCoreNotice,
  STUDIO_THEME_KEY,
  readStudioTheme,
} from "./DesignSystem";
import { ProposalPreview } from "./ProposalPreview";
import { buildProposalPreview } from "./proposalSimulation";
import { libraryMetadata } from "../library/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { libraries } from "virtual:studio-libraries";
import type { ComponentLibrary, Props } from "../library/sdk";
import type {
  Project,
  ProjectNode,
  ProjectPage,
  JSONRecord,
} from "../core/project";
import type { Operation } from "../core/operations";
import {
  resolveTokens,
  exportTokensCSS,
  exportTokensJSON,
  type Tokens,
} from "../core/tokens";
import { StudioClient, type Proposal } from "./client";
import { Catalog } from "./Catalog";
import { Inspector } from "./Inspector";
import { Preview } from "./Preview";
function locate(
  nodes: ProjectNode[],
  id: string | null,
): ProjectNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    for (const children of Object.values(node.slots)) {
      const found = locate(children, id);
      if (found) return found;
    }
  }
}
function flatten(
  nodes: ProjectNode[],
  depth = 0,
): { node: ProjectNode; depth: number }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...Object.values(node.slots).flatMap((children) =>
      flatten(children, depth + 1),
    ),
  ]);
}
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function proposalChanges(project: Project, operation: Operation): string[] {
  if (operation.type === "updateProps") {
    const before = project.pages
      .map((p) => locate(p.nodes, operation.nodeId))
      .find(Boolean);
    return Object.entries(operation.props).map(
      ([key, value]) =>
        operation.nodeId +
        " · " +
        key +
        ": " +
        JSON.stringify(before?.props[key] ?? null) +
        " → " +
        JSON.stringify(value),
    );
  }
  if (operation.type === "setGroups")
    return [
      "Группы: " +
        operation.groups
          .map(
            (g) =>
              `${g.name} (${g.pages.length} экранов, ${g.components.length} компонентов, ${g.tokens.length} токенов)`,
          )
          .join(", "),
    ];
  if (operation.type === "setTheme")
    return ["Тема: " + project.theme + " → " + operation.theme];
  if (operation.type === "setViewport")
    return [
      "Размеры " +
        operation.pageId +
        ": " +
        operation.width +
        " × " +
        (operation.height ??
          project.pages.find((p) => p.screenId === operation.pageId)?.viewport
            .height ??
          "авто") +
        (operation.device ? " · системные зоны устройства" : ""),
    ];
  if (operation.type === "insertNode")
    return [
      "Добавить " +
        operation.node.type +
        " · " +
        operation.node.id +
        " на экран " +
        operation.pageId,
    ];
  if (operation.type === "removeNode")
    return ["Удалить слой " + operation.nodeId];
  if (operation.type === "moveNode")
    return [
      "Переместить " +
        operation.nodeId +
        " на экран " +
        operation.pageId +
        " · позиция " +
        operation.index,
    ];
  if (operation.type === "addPage")
    return ["Добавить экран " + operation.page.name];
  if (operation.type === "removePage")
    return ["Удалить экран " + operation.pageId];
  if (operation.type === "renamePage")
    return ["Переименовать экран " + operation.pageId + " → " + operation.name];
  return ["Заменить набор токенов"];
}
export function StudioApp({
  desktopLibrary,
}: { desktopLibrary?: DesktopLibrary } = {}) {
  const { t } = useI18n();

  const activeLibraries = desktopLibrary
    ? [...libraries, desktopMetadataLibrary(desktopLibrary.metadata)]
    : libraries;
  const [studioTheme, setStudioTheme] = useState(readStudioTheme);
  useEffect(() => {
    try {
      localStorage.setItem(STUDIO_THEME_KEY, studioTheme);
    } catch {
      /* The current session remains usable without storage. */
    }
  }, [studioTheme]);
  const [project, setProject] = useState<Project | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadProgress, setLoadProgress] = useState<{
    received: number;
    total?: number;
  } | null>(null);
  const loadingController = useRef<AbortController | null>(null);
  const current = useRef<Project | null>(null);
  const [client, setClient] = useState<StudioClient | null>(null);
  const [view, setView] = useState<
    "catalog" | "tokens" | "editor" | "proposals" | "structure" | "assets"
  >("catalog");
  const [pageId, setPageId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [multipleIds, setMultipleIds] = useState<string[]>([]);
  const [propsDirty, setDirty] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [definitionDirty, setDefinitionDirty] = useState(false);
  const inspectorDirty = propsDirty || layoutDirty || definitionDirty;
  const [viewportDirty, setViewportDirty] = useState(false);
  const viewportPageSnapshot = useRef<ProjectPage | null>(null);
  const dirty = inspectorDirty || viewportDirty;
  const [groupFilter, setGroupFilter] = useState("");
  const [shade, setShade] = useState(false);
  const [deviceControlsOpen, setDeviceControlsOpen] = useState(false);
  useEffect(() => setShade(false), [pageId]);
  useEffect(() => setMultipleIds([]), [pageId]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(t("Подключение к локальным файлам…"));
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalList, setProposalList] = useState<"pending" | "history">(
    "pending",
  );
  const pendingProposals = proposals.filter(
    (p) => p.status !== "applied" && p.status !== "rejected",
  );
  const historyProposals = proposals.filter(
    (p) => p.status === "applied" || p.status === "rejected",
  );
  const visibleProposals =
    proposalList === "pending"
      ? pendingProposals
      : [...historyProposals].reverse();
  const [tokenDraft, setTokenDraft] = useState<string | null>(null);
  const [tokenBase, setTokenBase] = useState(0);
  const [zoom, setZoom] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const selectedSnapshot = useRef<ProjectNode | undefined>(undefined);
  const clientId = useRef(crypto.randomUUID());
  const accept = useCallback((next: Project) => {
    if (current.current && next.revision < current.current.revision) return;
    current.current = next;
    setProject((previous) =>
      previous?.revision === next.revision ? previous : next,
    );
    setStatus(
      (__STUDIO_DEMO__
        ? t("Сохранено в браузере · ревизия ")
        : t("Сохранено локально · ревизия ")) + next.revision,
    );
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    loadingController.current = controller;
    let api: StudioClient;
    let busy = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      try {
        api = await StudioClient.connect();
        const initial = await api.read({
          signal: controller.signal,
          onProgress: (received, total) => {
            if (active) setLoadProgress({ received, total });
          },
        });
        if (!active) return;
        setClient(api);
        accept(initial);
        setPageId(initial.pages[0].screenId);
        poll = setInterval(() => {
          if (busy) return;
          busy = true;
          void Promise.all([api.read(), api.proposals()])
            .then(([next, proposals]) => {
              if (active) {
                accept(next);
                setProposals(proposals);
              }
            })
            .catch((e) => {
              if (active) {
                setError(e.message);
                setStatus(
                  t("Сервис недоступен · сохранённые файлы остаются локально"),
                );
              }
            })
            .finally(() => {
              busy = false;
            });
        }, 650);
      } catch (e) {
        if (active)
          setError(
            controller.signal.aborted
              ? t("Загрузка отменена. Файлы проекта сохранены.")
              : (e as Error).message,
          );
      }
    })();
    return () => {
      active = false;
      controller.abort();
      if (poll) clearInterval(poll);
      if (api)
        void api
          .request("context", {
            clientId: clientId.current,
            pageId,
            selectedIds: [],
            connected: false,
          })
          .catch(() => {});
    };
  }, [accept, loadAttempt]);
  useEffect(() => {
    if (!client || !project) return;
    const contextPage =
      project.pages.find((p) => p.screenId === pageId) ?? project.pages[0];
    const send = () => {
      const bounds: Record<string, unknown> = {};
      const frame = stage.current?.querySelector("iframe");
      const origin = frame?.getBoundingClientRect();
      frame?.contentDocument
        ?.querySelectorAll("[data-node-id]")
        .forEach((element) => {
          const rect = element.getBoundingClientRect();
          bounds[element.getAttribute("data-node-id") ?? ""] = {
            x: (origin?.x ?? 0) + rect.x * zoom,
            y: (origin?.y ?? 0) + rect.y * zoom,
            width: rect.width * zoom,
            height: rect.height * zoom,
          };
        });
      void client
        .request("context", {
          clientId: clientId.current,
          pageId: contextPage.screenId,
          selectedIds: [
            ...new Set([...multipleIds, ...(selected ? [selected] : [])]),
          ],
          viewport: {
            ...contextPage.viewport,
            content: contentViewport(contextPage.viewport),
            zoom,
          },
          bounds,
          dirty,
          revision: project.revision,
        })
        .catch(() => {});
    };
    send();
    const timer = setInterval(send, 3500);
    return () => clearInterval(timer);
  }, [client, project, pageId, selected, multipleIds, dirty, zoom]);
  const livePage = project?.pages.find((p) => p.screenId === pageId);
  if (livePage) viewportPageSnapshot.current = livePage;
  const page =
    livePage ??
    (viewportDirty ? viewportPageSnapshot.current : null) ??
    project?.pages[0];
  const library: ComponentLibrary | undefined = activeLibraries.find(
    (l) =>
      l.id === project?.library.id && l.version === project?.library.version,
  );
  const displayLibrary = library ?? activeLibraries[0];
  const groupedPages =
    project?.pages.filter((p) =>
      inGroup(project, groupFilter, "pages", p.screenId),
    ) ?? [];
  useEffect(() => {
    if (
      project &&
      !dirty &&
      groupedPages.length &&
      !groupedPages.some((p) => p.screenId === pageId)
    ) {
      setPageId(groupedPages[0].screenId);
      setSelected(null);
    }
  }, [project, groupFilter, dirty, pageId]);
  const liveNode = page && locate(page.nodes, selected);
  if (liveNode) selectedSnapshot.current = liveNode;
  const node =
    liveNode ??
    (dirty && selectedSnapshot.current?.id === selected
      ? selectedSnapshot.current
      : undefined);
  useEffect(() => {
    if (
      project &&
      selected &&
      !project.pages.some((p) => locate(p.nodes, selected))
    ) {
      if (dirty) {
        setError(
          t(
            "Выделенный слой удалён внешней правкой. Черновик сохранён: скопируй его или сбрось ввод.",
          ),
        );
        return;
      }
      setSelected(null);
      setError(t("Выделенный слой удалён внешней правкой."));
    }
  }, [project, selected, dirty]);
  async function mutate(
    operations: Operation[],
    description: string,
    baseRevision = current.current?.revision,
  ) {
    if (!client || baseRevision === undefined) return;
    setStatus(t("Сохранение…"));
    try {
      const next = await client.apply(baseRevision, operations, description);
      accept(next);
      setError("");
    } catch (e) {
      setStatus(t("Правка не сохранена"));
      setError((e as Error).message);
      throw e;
    }
  }
  function select(id: string, additive = false) {
    if (dirty && id !== selected) {
      setError(
        t("Есть несохранённый ввод. Примени или сбрось его перед сменой слоя."),
      );
      return;
    }
    setMultipleIds((ids) =>
      additive
        ? [...new Set([...ids, ...(selected ? [selected] : []), id])]
        : [id],
    );
    setSelected(id);
  }
  async function history(kind: "undo" | "redo") {
    if (!client || !project) return;
    if (dirty || tokenDraft !== null) {
      setError(t("Сначала примени или сбрось несохранённый ввод."));
      return;
    }
    try {
      accept(await client.history(kind, project.revision));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useStudioShortcuts([
    {
      id: "undo",
      shortcut: "Mod+Z",
      enabled: () => !dirty && tokenDraft === null,
      run: () => history("undo"),
    },
    {
      id: "redo",
      shortcut: "Mod+Shift+Z",
      enabled: () => !dirty && tokenDraft === null,
      run: () => history("redo"),
    },
  ]);
  async function addGroupedPage() {
    if (!project || dirty) return;
    const screenId = crypto.randomUUID();
    const operations: Operation[] = [
      {
        type: "addPage",
        page: {
          screenId,
          name: t("Новый экран"),
          viewport: { width: 390 },
          nodes: [],
        },
      },
    ];
    if (project.groups?.some((g) => g.id === groupFilter))
      operations.push({
        type: "setGroups",
        groups: project.groups.map((g) =>
          g.id === groupFilter ? { ...g, pages: [...g.pages, screenId] } : g,
        ),
      });
    try {
      await mutate(operations, t("Добавить экран в группу"));
      setPageId(screenId);
      setSelected(null);
    } catch {
      /* visible error */
    }
  }
  async function add(type: string, props: Props) {
    if (!page || !client) return;
    if (!groupedPages.some((p) => p.screenId === page.screenId)) {
      setError(
        t(
          "В выбранной группе нет экрана для добавления. Создай экран в разделе «Экраны».",
        ),
      );
      return;
    }
    const id = type.toLowerCase() + "-" + crypto.randomUUID().slice(0, 8);
    try {
      const savedProps = (await client.materialize(props)) as JSONRecord;
      await mutate(
        [
          {
            type: "insertNode",
            pageId: page.screenId,
            index: page.nodes.length,
            node: {
              id,
              type,
              props: savedProps,
              slots: Object.fromEntries(
                (library?.components[type]?.slots ?? []).map((s) => [s, []]),
              ),
            },
          },
        ],
        t("Добавить ") + type,
      );
      setSelected(id);
      setView("editor");
    } catch {
      /* visible error */
    }
  }
  if (!project)
    return (
      <main
        className="ds-studio loading"
        data-studio-theme={studioTheme}
        style={studioThemeStyle(studioTheme)}
      >
        <strong>{__STUDIO_DEMO__ ? "studio / demo" : "studio / local"}</strong>
        <p>{status}</p>
        {loadProgress && (
          <>
            <progress
              aria-label={t("Загрузка проекта")}
              value={loadProgress.total ? loadProgress.received : undefined}
              max={loadProgress.total}
            />
            <p>
              {t("Получено")} {Math.ceil(loadProgress.received / 1024)}{" "}
              {t("КБ")}
              {loadProgress.total
                ? t(" из {0} КБ", { 0: Math.ceil(loadProgress.total / 1024) })
                : ""}
            </p>
          </>
        )}
        <button onClick={() => loadingController.current?.abort()}>
          {t("Отменить загрузку")}
        </button>
        {error && (
          <button
            onClick={() => {
              setError("");
              setLoadProgress(null);
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            {t("Повторить загрузку")}
          </button>
        )}
        {error && (
          <div role="alert">
            {error}
            <p>
              {t(
                "Запусти студию через npm run dev или npm run studio. Статический preview не запускает файловый сервис.",
              )}
            </p>
          </div>
        )}
      </main>
    );
  return (
    <DesktopLibraryContext.Provider value={desktopLibrary}>
      <main
        className="ds-studio"
        data-studio-theme={studioTheme}
        style={studioThemeStyle(studioTheme)}
      >
        <header className="ds-header">
          <div className="ds-brand">
            <span>s</span>
            <div>
              <strong>
                {__STUDIO_DEMO__ ? "studio / demo" : "studio / local"}
              </strong>
              <small>
                {__STUDIO_DEMO__
                  ? t("Попробуй студию без установки")
                  : t("Дизайн в твоих файлах")}
              </small>
            </div>
          </div>
          <div className="ds-project">
            <strong>{project.name}</strong>
            <small>
              {project.library.id} · {project.library.version}
            </small>
          </div>
          <div className="ds-save" data-testid="save-status">
            <span />
            {status}
          </div>
          <StudioButton
            onClick={() =>
              download(
                project.projectId + ".json",
                JSON.stringify(project, null, 2),
              )
            }
          >
            {t("Экспорт проекта ↗")}
          </StudioButton>
        </header>
        <div className="ds-layout">
          <aside className="ds-nav">
            <nav className="ds-nav-menu" aria-label={t("Разделы студии")}>
              <p className="eyebrow">{t("Рабочее пространство")}</p>
              {(
                [
                  ["catalog", t("Компоненты")],
                  ["tokens", t("Основы")],
                  ["assets", t("Изображения")],
                  ["editor", t("Экраны")],
                  ["proposals", t("Предложения агента")],
                  ["structure", t("Документ")],
                ] as const
              ).map(([id, name]) => (
                <StudioButton
                  key={id}
                  aria-pressed={view === id}
                  onClick={() => {
                    if ((dirty || tokenDraft !== null) && id !== view) {
                      setError(
                        t(
                          "Есть несохранённый ввод. Примени или сбрось его перед сменой раздела.",
                        ),
                      );
                      return;
                    }
                    setView(id);
                  }}
                >
                  {name}
                  {id === "proposals" && pendingProposals.length > 0 && (
                    <b>{pendingProposals.length}</b>
                  )}
                </StudioButton>
              ))}
            </nav>
            <div className="ds-nav-bottom">
              <StudioLanguageChoice />
              <StudioThemeChoice
                value={studioTheme}
                onChange={setStudioTheme}
              />
              <LocalCoreNotice demo={__STUDIO_DEMO__} />
            </div>
          </aside>
          <div className="ds-workspace">
            <div className="ds-toolbar">
              <div>
                <span className="connection-dot" />
                {__STUDIO_DEMO__
                  ? t("Браузерное демо")
                  : t("Файловый сервис")}{" "}
                · {project.pages.length} {t("экранов")}
              </div>
              <label>
                {t("Тема")}{" "}
                <select
                  aria-label={t("Тема проекта")}
                  value={project.theme}
                  onChange={(e) =>
                    void mutate(
                      [{ type: "setTheme", theme: e.target.value }],
                      t("Изменить тему"),
                    ).catch(() => {})
                  }
                >
                  {displayLibrary.themes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <StudioButton onClick={() => void history("undo")}>
                {t("Отменить правку")}
              </StudioButton>
              <StudioButton onClick={() => void history("redo")}>
                {t("Повторить правку")}
              </StudioButton>
            </div>
            {error && (
              <div className="ds-error" role="alert">
                {error}
                <StudioButton
                  aria-label={t("Закрыть сообщение")}
                  onClick={() => setError("")}
                >
                  ×
                </StudioButton>
              </div>
            )}
            {!library && (
              <div role="status" className="notice">
                {t("Библиотека")} {project.library.id}@{project.library.version}{" "}
                {t(
                  "недоступна. Исходный документ сохранён; подключи совместимую версию локально.",
                )}
              </div>
            )}
            <div className="ds-content">
              {(["catalog", "tokens", "editor"] as string[]).includes(view) && (
                <Groups
                  project={project}
                  library={displayLibrary}
                  filter={groupFilter}
                  disabled={dirty || tokenDraft !== null}
                  onFilter={setGroupFilter}
                  onApply={(groups, revision) =>
                    mutate(
                      [{ type: "setGroups", groups }],
                      t("Изменить группы"),
                      revision,
                    ).then(() => {})
                  }
                />
              )}
              {view === "editor" &&
                dirty &&
                page &&
                !groupedPages.some((p) => p.screenId === page.screenId) && (
                  <p className="notice" role="alert">
                    {t(
                      "Состав группы изменился. Экран оставлен открытым, чтобы сохранить несохранённый ввод. Примени или сбрось его перед сменой экрана.",
                    )}
                  </p>
                )}
              {view === "editor" && !groupedPages.length && !dirty && (
                <p className="notice">
                  {t(
                    "В этой группе пока нет экранов. Добавь их через «Управлять группами» или создай новый.",
                  )}
                  <StudioButton
                    disabled={dirty}
                    onClick={() => void addGroupedPage()}
                  >
                    {t("Экран +")}
                  </StudioButton>
                </p>
              )}
              {view === "catalog" && (
                <Catalog
                  library={displayLibrary}
                  project={project}
                  groupFilter={groupFilter}
                  onAdd={(type, props) => void add(type, props)}
                />
              )}
              {view === "assets" && client && (
                <Assets
                  client={client}
                  revision={project.revision}
                  onInsert={async (asset) => {
                    if (!page || dirty)
                      throw new Error(
                        t("Сначала выбери экран и сохрани текущий ввод."),
                      );
                    const id = crypto.randomUUID();
                    await mutate(
                      [
                        {
                          type: "insertNode",
                          pageId: page.screenId,
                          index: page.nodes.length,
                          node: {
                            id,
                            type: "StudioImage",
                            name: asset.name,
                            props: {
                              src: asset.path,
                              alt: asset.name,
                              objectFit: "contain",
                              objectPosition: "50% 50%",
                            },
                            slots: {},
                            scene: {
                              kind: "image",
                              x: 0,
                              y: 0,
                              width: Math.min(
                                asset.width ?? 320,
                                page.viewport.width,
                              ),
                              height: Math.min(asset.height ?? 240, 600),
                            },
                          },
                        },
                      ],
                      t("Добавить изображение"),
                    );
                    setSelected(id);
                    setView("editor");
                  }}
                />
              )}
              {view === "tokens" && (
                <section>
                  <span className="eyebrow">
                    {t("Единый источник оформления")}
                  </span>
                  <StudioHeading>{t("Токены и темы")}</StudioHeading>
                  <p>
                    {t(
                      "Ссылки на токены остаются ссылками при смене темы. Локальные переопределения хранятся в проекте.",
                    )}
                  </p>
                  <div className="token-actions">
                    <StudioButton
                      onClick={() =>
                        download(
                          "tokens.json",
                          exportTokensJSON(project.tokens, project.theme),
                        )
                      }
                    >
                      {t("Экспорт токенов JSON")}
                    </StudioButton>
                    <StudioButton
                      onClick={() =>
                        download(
                          "tokens.css",
                          exportTokensCSS(project.tokens, project.theme),
                          "text/css",
                        )
                      }
                    >
                      {t("Экспорт CSS variables")}
                    </StudioButton>
                    <StudioButton
                      onClick={() => {
                        setTokenDraft(JSON.stringify(project.tokens, null, 2));
                        setTokenBase(project.revision);
                      }}
                    >
                      {t("Редактировать токены")}
                    </StudioButton>
                  </div>
                  {tokenDraft !== null && (
                    <div className="token-editor">
                      <label>
                        {t("Токены JSON")}
                        <textarea
                          value={tokenDraft}
                          onChange={(e) => setTokenDraft(e.target.value)}
                          aria-label={t("Токены JSON")}
                        />
                      </label>
                      <StudioButton
                        onClick={() => {
                          try {
                            const tokens = JSON.parse(tokenDraft) as Tokens;
                            void mutate(
                              [{ type: "setTokens", tokens }],
                              t("Изменить токены"),
                              tokenBase,
                            )
                              .then(() => setTokenDraft(null))
                              .catch(() => {});
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        {t("Сохранить токены")}
                      </StudioButton>
                      <StudioButton onClick={() => setTokenDraft(null)}>
                        {t("Отмена")}
                      </StudioButton>
                    </div>
                  )}
                  <div className="token-grid">
                    {Object.entries(
                      resolveTokens(project.tokens, project.theme),
                    )
                      .filter(([name]) =>
                        inGroup(project, groupFilter, "tokens", name),
                      )
                      .map(([name, value]) => (
                        <article key={name}>
                          <div
                            className="token-swatch"
                            style={{
                              background:
                                project.tokens[name].type === "color"
                                  ? String(value)
                                  : undefined,
                            }}
                          >
                            {project.tokens[name].type !== "color" && "Aa"}
                          </div>
                          <div>
                            <strong>{name}</strong>
                            <code>{String(value)}</code>
                            <small>
                              {project.tokens[name].type}
                              {typeof project.tokens[name].value === "object"
                                ? t(" · ссылка")
                                : t(" · значение")}
                            </small>
                          </div>
                        </article>
                      ))}
                  </div>
                </section>
              )}
              {view === "editor" &&
                page &&
                (groupedPages.length > 0 || dirty) && (
                  <section className="editor-section">
                    <div className="section-title">
                      <div>
                        <span className="eyebrow">{t("Живые компоненты")}</span>
                        <StudioHeading>{page.name}</StudioHeading>
                      </div>
                      <div className="editor-controls">
                        <StudioSelect
                          label={t("Экран")}
                          value={page.screenId}
                          fallback={page.name}
                          disabled={dirty}
                          onChange={(id) => {
                            setPageId(id);
                            setSelected(null);
                          }}
                          sections={[
                            ...(project.groups ?? [])
                              .map((group) => ({
                                label: group.name,
                                options: groupedPages
                                  .filter((p) =>
                                    group.pages.includes(p.screenId),
                                  )
                                  .map((p) => ({
                                    value: p.screenId,
                                    label: p.name,
                                  })),
                              }))
                              .filter((section) => section.options.length),
                            {
                              label: t("Без группы"),
                              options: groupedPages
                                .filter(
                                  (p) =>
                                    !(project.groups ?? []).some((group) =>
                                      group.pages.includes(p.screenId),
                                    ),
                                )
                                .map((p) => ({
                                  value: p.screenId,
                                  label: p.name,
                                })),
                            },
                          ]}
                        />
                        <StudioButton
                          disabled={dirty}
                          onClick={() => void addGroupedPage()}
                        >
                          {t("Экран +")}
                        </StudioButton>
                        <select
                          aria-label={t("Масштаб")}
                          value={zoom}
                          onChange={(e) => setZoom(Number(e.target.value))}
                        >
                          {[0.5, 0.75, 1].map((z) => (
                            <option key={z} value={z}>
                              {z * 100}%
                            </option>
                          ))}
                        </select>
                        <StudioButton
                          aria-label={t("Настройки устройства")}
                          aria-expanded={deviceControlsOpen}
                          aria-controls="device-controls"
                          onClick={() => setDeviceControlsOpen((open) => !open)}
                        >
                          {(DEVICE_PRESETS.find(
                            (preset) =>
                              preset.id === page.viewport.device?.preset,
                          )?.name.split(" · ")[0] ?? t("Свои размеры")) +
                            ` · ${page.viewport.width} × ${page.viewport.height ?? 850}`}
                          {viewportDirty ? t(" · не сохранено") : ""}
                          {deviceControlsOpen ? " ▴" : " ▾"}
                        </StudioButton>
                      </div>
                    </div>
                    {!project.pages.some(
                      (p) => p.screenId === page.screenId,
                    ) && (
                      <p className="notice" role="alert">
                        {t(
                          "Выбранный экран удалён. Ввод размеров сохранён: скопируй его или нажми «Сбросить размеры».",
                        )}
                      </p>
                    )}
                    <div id="device-controls" hidden={!deviceControlsOpen}>
                      <ViewportControls
                        key={page.screenId}
                        viewport={page.viewport}
                        groups={project.groups ?? []}
                        pageId={page.screenId}
                        pageCount={project.pages.length}
                        onBulkApply={async (value, revision, groupId) => {
                          const group = groupId
                            ? project.groups?.find((g) => g.id === groupId)
                            : undefined;
                          if (groupId && !group)
                            throw new Error(
                              t("Группа удалена. Выбери актуальную группу."),
                            );
                          const targets = group
                            ? project.pages.filter((p) =>
                                group.pages.includes(p.screenId),
                              )
                            : project.pages;
                          if (!targets.length)
                            throw new Error(t("В группе нет экранов."));
                          await mutate(
                            targets.map((target) => ({
                              type: "setViewport",
                              pageId: target.screenId,
                              width: value.width,
                              height: value.height,
                              device: value.device ?? null,
                            })),
                            group
                              ? t("Применить устройство к группе «{0}»", {
                                  0: group.name,
                                })
                              : t("Применить устройство ко всем экранам"),
                            revision,
                          );
                          return {
                            count: targets.length,
                            includesCurrent: targets.some(
                              (target) => target.screenId === page.screenId,
                            ),
                          };
                        }}
                        revision={project.revision}
                        disabled={inspectorDirty}
                        onDirty={setViewportDirty}
                        shade={shade}
                        onShadeChange={setShade}
                        onApply={async (value, revision) => {
                          await mutate(
                            [
                              {
                                type: "setViewport",
                                pageId: page.screenId,
                                width: value.width,
                                height: value.height,
                                device: value.device ?? null,
                              },
                            ],
                            t("Изменить устройство и размеры"),
                            revision,
                          );
                        }}
                      />
                    </div>
                    <LayerActions
                      project={project}
                      page={page}
                      selectedIds={[
                        ...new Set([
                          ...multipleIds.filter((id) => locate(page.nodes, id)),
                          ...(selected ? [selected] : []),
                        ]),
                      ]}
                      disabled={propsDirty || layoutDirty || viewportDirty}
                      onDirty={setDefinitionDirty}
                      mutate={mutate}
                      onSelection={(ids) => {
                        setMultipleIds(ids);
                        setSelected(ids[0] ?? null);
                      }}
                    />
                    <Annotations
                      key={page.screenId}
                      project={project}
                      page={page}
                      nodeId={selected}
                      disabled={dirty}
                      mutate={mutate}
                      onVariant={(id) => {
                        setPageId(id);
                        setSelected(null);
                        setMultipleIds([]);
                      }}
                    />
                    {client && (
                      <Handoff
                        key={page.screenId + "-handoff"}
                        project={project}
                        page={page}
                        nodeId={selected}
                        client={client}
                      />
                    )}
                    <div className="document-editor">
                      <aside className="layer-list">
                        <h3>{t("Слои")}</h3>
                        {flatten(page.nodes).map(({ node, depth }) => (
                          <div key={node.id} className="layer-row">
                            <input
                              type="checkbox"
                              aria-label={
                                t("Выбрать слой ") + (node.name ?? node.id)
                              }
                              checked={
                                multipleIds.includes(node.id) ||
                                selected === node.id
                              }
                              disabled={dirty}
                              onChange={(e) => {
                                const ids = [
                                  ...new Set([
                                    ...multipleIds,
                                    ...(selected ? [selected] : []),
                                  ]),
                                ];
                                const next = e.target.checked
                                  ? [...new Set([...ids, node.id])]
                                  : ids.filter((id) => id !== node.id);
                                setMultipleIds(next);
                                setSelected(next[0] ?? null);
                              }}
                            />
                            <StudioButton
                              key={node.id}
                              aria-label={t("Выделить ") + node.id}
                              aria-pressed={selected === node.id}
                              style={{ paddingLeft: 12 + depth * 14 }}
                              onClick={() => select(node.id)}
                            >
                              <strong>
                                {node.name ?? node.type}
                                {node.hidden ? t(" · скрыт") : ""}
                                {node.locked ? t(" · заблокирован") : ""}
                              </strong>
                              <small>{node.id}</small>
                            </StudioButton>
                          </div>
                        ))}
                        {!page.nodes.length && (
                          <p>{t("Добавь компоненты из библиотеки.")}</p>
                        )}
                        <p data-testid="selection">
                          {t("Выделено:")} {selected ?? "—"}
                        </p>
                      </aside>
                      <div className="page-stage" ref={stage}>
                        <div style={{ width: page.viewport.width, zoom }}>
                          <DeviceFrame
                            viewport={page.viewport}
                            theme={project.theme}
                            shade={shade}
                            onCloseShade={() => setShade(false)}
                          >
                            {(size) => (
                              <Preview
                                library={displayLibrary}
                                project={project}
                                theme={project.theme}
                                title={t("Экран ") + page.name}
                                height={size.height}
                                nodes={page.nodes}
                                selected={selected}
                                selectedIds={multipleIds}
                                onSelect={select}
                              />
                            )}
                          </DeviceFrame>
                        </div>
                      </div>
                      <aside>
                        {node && (
                          <NodeLayoutInspector
                            key={node.id + "-layout"}
                            node={node}
                            project={project}
                            disabled={propsDirty || definitionDirty}
                            onDirty={setLayoutDirty}
                            onApply={mutate}
                          />
                        )}
                        {node ? (
                          <Inspector
                            key={node.id}
                            node={node}
                            revision={project.revision}
                            onDirty={setDirty}
                            onApply={(props, revision) =>
                              mutate(
                                [
                                  {
                                    type: "updateProps",
                                    nodeId: node.id,
                                    props: props as JSONRecord,
                                  },
                                ],
                                t("Изменить свойства ") + node.id,
                                revision,
                              )
                            }
                          />
                        ) : (
                          <div className="inspector">
                            <h3>{t("Инспектор")}</h3>
                            <p>
                              {t(
                                "Выдели компонент на экране или в дереве слоёв.",
                              )}
                            </p>
                          </div>
                        )}
                        {node && (
                          <div className="inspector">
                            <StudioButton
                              onClick={() =>
                                void mutate(
                                  [{ type: "removeNode", nodeId: node.id }],
                                  t("Удалить слой"),
                                ).catch(() => {})
                              }
                            >
                              {t("Удалить слой")}
                            </StudioButton>
                          </div>
                        )}
                      </aside>
                    </div>
                  </section>
                )}
              {view === "proposals" && (
                <section>
                  <span className="eyebrow">{t("MCP / общий документ")}</span>
                  <StudioHeading>{t("Предложения агента")}</StudioHeading>
                  {__STUDIO_DEMO__ && (
                    <div className="notice">
                      <p>
                        {t(
                          "Интерактивный пример правки. AI и MCP здесь не подключены; настоящие агенты работают с установленной локальной студией.",
                        )}
                      </p>
                      <StudioButton
                        onClick={() =>
                          void client
                            ?.request("demo/proposal", {})
                            .then(() => client.proposals())
                            .then(setProposals)
                            .catch((e) => setError(e.message))
                        }
                      >
                        {t("Создать пример предложения")}
                      </StudioButton>
                    </div>
                  )}
                  <p>
                    {t(
                      "По умолчанию агент предлагает правки, а ты подтверждаешь применение. Один пакет — один шаг отмены.",
                    )}
                  </p>
                  <div
                    className="proposal-sections"
                    role="group"
                    aria-label={t("Разделы предложений")}
                  >
                    <StudioButton
                      aria-label={t("Ожидают решения")}
                      aria-pressed={proposalList === "pending"}
                      onClick={() => setProposalList("pending")}
                    >
                      {t("Ожидают решения ·")} {pendingProposals.length}
                    </StudioButton>
                    <StudioButton
                      aria-label={t("История предложений")}
                      aria-pressed={proposalList === "history"}
                      onClick={() => setProposalList("history")}
                    >
                      {t("История ·")} {historyProposals.length}
                    </StudioButton>
                  </div>
                  {proposalList === "history" && (
                    <p>
                      {t(
                        "Применённые и отклонённые предложения сохраняются без ограничения срока.",
                      )}
                    </p>
                  )}
                  {!visibleProposals.length && proposalList === "history" && (
                    <div className="empty-state">
                      {t(
                        "История пока пуста. Здесь появятся применённые и отклонённые предложения.",
                      )}
                    </div>
                  )}
                  {!pendingProposals.length &&
                    proposalList === "pending" &&
                    proposals.length > 0 && (
                      <div className="empty-state">
                        {t(
                          "Нет предложений, ожидающих решения. Завершённые доступны в истории.",
                        )}
                      </div>
                    )}
                  {!proposals.length && proposalList === "pending" && (
                    <div className="empty-state">
                      {__STUDIO_DEMO__
                        ? t(
                            "Пока нет предложений. Нажми «Создать пример предложения», чтобы попробовать подтверждение правки.",
                          )
                        : t(
                            "Пока нет предложений. Подключи агента по инструкции MCP в README.",
                          )}
                    </div>
                  )}
                  {visibleProposals.map((p) => (
                    <article className="proposal-card" key={p.id}>
                      <header>
                        <h2>
                          {p.description ||
                            p.batch.description ||
                            t("Предложение правки")}
                        </h2>
                        <span>{p.status}</span>
                      </header>
                      <p>
                        {t("Автор:")} {p.batch.author ?? "agent"}{" "}
                        {t("· базовая ревизия")} {p.batch.baseRevision} ·{" "}
                        {p.batch.operations.length} {t("операций")}
                      </p>
                      {proposalList === "pending" && (
                        <ul>
                          {p.batch.operations
                            .flatMap((op) => proposalChanges(project, op))
                            .map((change, i) => (
                              <li key={i}>{change}</li>
                            ))}
                        </ul>
                      )}
                      <ProposalPreview
                        project={project}
                        proposal={p}
                        library={displayLibrary}
                      />
                      <details>
                        <summary>{t("Посмотреть точные изменения")}</summary>
                        <pre>{JSON.stringify(p.batch.operations, null, 2)}</pre>
                      </details>
                      {p.status !== "applied" && p.status !== "rejected" && (
                        <StudioButton
                          className="accent"
                          disabled={
                            p.batch.baseRevision !== project.revision ||
                            dirty ||
                            !!reviewing ||
                            !!buildProposalPreview(project, p.batch, [
                              libraryMetadata(displayLibrary),
                            ]).error
                          }
                          onClick={() => {
                            if (!client) return;
                            setReviewing(p.id);
                            void client
                              .approve(p.id)
                              .then(accept)
                              .then(() => client.proposals())
                              .then(setProposals)
                              .catch((e) => setError(e.message))
                              .finally(() => setReviewing(null));
                          }}
                        >
                          {t("Подтвердить и применить")}
                        </StudioButton>
                      )}
                      {p.status !== "applied" && p.status !== "rejected" && (
                        <StudioButton
                          disabled={!!reviewing}
                          onClick={() => {
                            if (!client) return;
                            setReviewing(p.id);
                            void client
                              .reject(p.id)
                              .then(() => client.proposals())
                              .then(setProposals)
                              .catch((e) => setError(e.message))
                              .finally(() => setReviewing(null));
                          }}
                        >
                          {t("Отклонить")}
                        </StudioButton>
                      )}
                      {p.status === "rejected" && (
                        <p>{t("Предложение отклонено · проект не изменён")}</p>
                      )}
                      {p.status !== "applied" &&
                        p.status !== "rejected" &&
                        p.batch.baseRevision !== project.revision && (
                          <p className="notice">
                            {t(
                              "Устаревшая ревизия. Агенту нужно перечитать документ и создать новое предложение.",
                            )}
                          </p>
                        )}
                    </article>
                  ))}
                </section>
              )}
              {view === "structure" && (
                <section>
                  <StudioHeading>{t("Документ проекта")}</StudioHeading>
                  <p>
                    {__STUDIO_DEMO__
                      ? t(
                          "Каноническая схема v2 · изменения сохраняются в браузере. JSON можно экспортировать.",
                        )
                      : t(
                          "Каноническая схема v2 · сохранена в локальном project.json. Ключи и пути подключения агента хранятся отдельно.",
                        )}
                  </p>
                  <pre data-testid="project-document">
                    {JSON.stringify(project, null, 2)}
                  </pre>
                </section>
              )}
            </div>
          </div>
        </div>
      </main>
    </DesktopLibraryContext.Provider>
  );
}
