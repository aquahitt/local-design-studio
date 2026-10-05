import { ProposalPreview } from "./ProposalPreview";
import { buildProposalPreview } from "./proposalSimulation";
import { libraryMetadata } from "../library/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { libraries } from "virtual:studio-libraries";
import type { ComponentLibrary, Props } from "../library/sdk";
import type { Project, ProjectNode, JSONRecord } from "../core/project";
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
  if (operation.type === "setTheme")
    return ["Тема: " + project.theme + " → " + operation.theme];
  if (operation.type === "setViewport")
    return [
      "Ширина " +
        operation.pageId +
        ": " +
        project.pages.find((p) => p.screenId === operation.pageId)?.viewport
          .width +
        " → " +
        operation.width,
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
export function StudioApp() {
  const [project, setProject] = useState<Project | null>(null);
  const current = useRef<Project | null>(null);
  const [client, setClient] = useState<StudioClient | null>(null);
  const [view, setView] = useState<
    "catalog" | "tokens" | "editor" | "proposals" | "structure"
  >("catalog");
  const [pageId, setPageId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Подключение к локальным файлам…");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
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
        ? "Сохранено в браузере · ревизия "
        : "Сохранено локально · ревизия ") + next.revision,
    );
  }, []);
  useEffect(() => {
    let active = true;
    let api: StudioClient;
    let busy = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      try {
        api = await StudioClient.connect();
        const initial = await api.read();
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
                  "Сервис недоступен · сохранённые файлы остаются локально",
                );
              }
            })
            .finally(() => {
              busy = false;
            });
        }, 650);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
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
  }, [accept]);
  useEffect(() => {
    if (!client || !project) return;
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
          pageId,
          selectedIds: selected ? [selected] : [],
          viewport: {
            width: project.pages.find((p) => p.screenId === pageId)?.viewport
              .width,
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
  }, [client, project, pageId, selected, dirty, zoom]);
  const page =
    project?.pages.find((p) => p.screenId === pageId) ?? project?.pages[0];
  const library: ComponentLibrary | undefined = libraries.find(
    (l) =>
      l.id === project?.library.id && l.version === project?.library.version,
  );
  const displayLibrary = library ?? libraries[0];
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
          "Выделенный слой удалён внешней правкой. Черновик сохранён: скопируй его или сбрось ввод.",
        );
        return;
      }
      setSelected(null);
      setError("Выделенный слой удалён внешней правкой.");
    }
  }, [project, selected, dirty]);
  async function mutate(
    operations: Operation[],
    description: string,
    baseRevision = current.current?.revision,
  ) {
    if (!client || baseRevision === undefined) return;
    setStatus("Сохранение…");
    try {
      const next = await client.apply(baseRevision, operations, description);
      accept(next);
      setError("");
    } catch (e) {
      setStatus("Правка не сохранена");
      setError((e as Error).message);
      throw e;
    }
  }
  function select(id: string) {
    if (dirty && id !== selected) {
      setError(
        "Есть несохранённый ввод. Примени или сбрось его перед сменой слоя.",
      );
      return;
    }
    setSelected(id);
  }
  async function history(kind: "undo" | "redo") {
    if (!client || !project) return;
    if (dirty || tokenDraft !== null) {
      setError("Сначала примени или сбрось несохранённый ввод.");
      return;
    }
    try {
      accept(await client.history(kind, project.revision));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function add(type: string, props: Props) {
    if (!page || !client) return;
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
        "Добавить " + type,
      );
      setSelected(id);
      setView("editor");
    } catch {
      /* visible error */
    }
  }
  if (!project)
    return (
      <main className="ds-studio loading">
        <strong>{__STUDIO_DEMO__ ? "studio / demo" : "studio / local"}</strong>
        <p>{status}</p>
        {error && (
          <div role="alert">
            {error}
            <p>
              Запусти студию через npm run dev или npm run studio. Статический
              preview не запускает файловый сервис.
            </p>
          </div>
        )}
      </main>
    );
  return (
    <main className="ds-studio">
      <header className="ds-header">
        <div className="ds-brand">
          <span>s</span>
          <div>
            <strong>
              {__STUDIO_DEMO__ ? "studio / demo" : "studio / local"}
            </strong>
            <small>
              {__STUDIO_DEMO__
                ? "Попробуй студию без установки"
                : "Дизайн в твоих файлах"}
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
        <button
          onClick={() =>
            download(
              project.projectId + ".json",
              JSON.stringify(project, null, 2),
            )
          }
        >
          Экспорт проекта ↗
        </button>
      </header>
      <div className="ds-layout">
        <aside className="ds-nav">
          <p className="eyebrow">Рабочее пространство</p>
          {(
            [
              ["catalog", "Компоненты"],
              ["tokens", "Основы"],
              ["editor", "Экраны"],
              ["proposals", "Предложения агента"],
              ["structure", "Документ"],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              aria-pressed={view === id}
              onClick={() => {
                if ((dirty || tokenDraft !== null) && id !== view) {
                  setError(
                    "Есть несохранённый ввод. Примени или сбрось его перед сменой раздела.",
                  );
                  return;
                }
                setView(id);
              }}
            >
              {name}
              {id === "proposals" &&
                proposals.filter((p) => p.status === "pending").length > 0 && (
                  <b>
                    {proposals.filter((p) => p.status === "pending").length}
                  </b>
                )}
            </button>
          ))}
          <div className="ds-nav-bottom">
            <strong>Локальное ядро</strong>
            <p>
              {__STUDIO_DEMO__
                ? "Попробуй редактор на синтетическом проекте. Правки остаются в браузере."
                : "Один документ для человека и агента. AI подключается через MCP."}
            </p>
            <a
              href={
                __STUDIO_DEMO__
                  ? "https://github.com/aquahitt/local-design-studio#запуск"
                  : "/pilot"
              }
            >
              {__STUDIO_DEMO__
                ? "Установить локально ↗"
                : "Открыть технический пилот ↗"}
            </a>
          </div>
        </aside>
        <div className="ds-workspace">
          <div className="ds-toolbar">
            <div>
              <span className="connection-dot" />
              {__STUDIO_DEMO__ ? "Браузерное демо" : "Файловый сервис"} ·{" "}
              {project.pages.length} экранов
            </div>
            <label>
              Тема{" "}
              <select
                aria-label="Тема проекта"
                value={project.theme}
                onChange={(e) =>
                  void mutate(
                    [{ type: "setTheme", theme: e.target.value }],
                    "Изменить тему",
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
            <button onClick={() => void history("undo")}>
              Отменить правку
            </button>
            <button onClick={() => void history("redo")}>
              Повторить правку
            </button>
          </div>
          {error && (
            <div className="ds-error" role="alert">
              {error}
              <button
                aria-label="Закрыть сообщение"
                onClick={() => setError("")}
              >
                ×
              </button>
            </div>
          )}
          {!library && (
            <div role="status" className="notice">
              Библиотека {project.library.id}@{project.library.version}{" "}
              недоступна. Исходный документ сохранён; подключи совместимую
              версию локально.
            </div>
          )}
          <div className="ds-content">
            {view === "catalog" && (
              <Catalog
                library={displayLibrary}
                project={project}
                onAdd={(type, props) => void add(type, props)}
              />
            )}
            {view === "tokens" && (
              <section>
                <span className="eyebrow">Единый источник оформления</span>
                <h1>Токены и темы</h1>
                <p>
                  Ссылки на токены остаются ссылками при смене темы. Локальные
                  переопределения хранятся в проекте.
                </p>
                <div className="token-actions">
                  <button
                    onClick={() =>
                      download(
                        "tokens.json",
                        exportTokensJSON(project.tokens, project.theme),
                      )
                    }
                  >
                    Экспорт токенов JSON
                  </button>
                  <button
                    onClick={() =>
                      download(
                        "tokens.css",
                        exportTokensCSS(project.tokens, project.theme),
                        "text/css",
                      )
                    }
                  >
                    Экспорт CSS variables
                  </button>
                  <button
                    onClick={() => {
                      setTokenDraft(JSON.stringify(project.tokens, null, 2));
                      setTokenBase(project.revision);
                    }}
                  >
                    Редактировать токены
                  </button>
                </div>
                {tokenDraft !== null && (
                  <div className="token-editor">
                    <label>
                      Токены JSON
                      <textarea
                        value={tokenDraft}
                        onChange={(e) => setTokenDraft(e.target.value)}
                        aria-label="Токены JSON"
                      />
                    </label>
                    <button
                      onClick={() => {
                        try {
                          const tokens = JSON.parse(tokenDraft) as Tokens;
                          void mutate(
                            [{ type: "setTokens", tokens }],
                            "Изменить токены",
                            tokenBase,
                          )
                            .then(() => setTokenDraft(null))
                            .catch(() => {});
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Сохранить токены
                    </button>
                    <button onClick={() => setTokenDraft(null)}>Отмена</button>
                  </div>
                )}
                <div className="token-grid">
                  {Object.entries(
                    resolveTokens(project.tokens, project.theme),
                  ).map(([name, value]) => (
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
                            ? " · ссылка"
                            : " · значение"}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {view === "editor" && page && (
              <section className="editor-section">
                <div className="section-title">
                  <div>
                    <span className="eyebrow">Живые компоненты</span>
                    <h1>{page.name}</h1>
                  </div>
                  <div className="editor-controls">
                    <select
                      aria-label="Экран"
                      value={page.screenId}
                      onChange={(e) => {
                        if (dirty) {
                          setError(
                            "Примени или сбрось ввод перед сменой экрана.",
                          );
                          return;
                        }
                        setPageId(e.target.value);
                        setSelected(null);
                      }}
                    >
                      {project.pages.map((p) => (
                        <option key={p.screenId} value={p.screenId}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={dirty}
                      onClick={() =>
                        void mutate(
                          [
                            {
                              type: "addPage",
                              page: {
                                screenId: crypto.randomUUID(),
                                name: "Новый экран",
                                viewport: { width: 390 },
                                nodes: [],
                              },
                            },
                          ],
                          "Добавить экран",
                        )
                          .then(() =>
                            setPageId(current.current!.pages.at(-1)!.screenId),
                          )
                          .catch(() => {})
                      }
                    >
                      Экран +
                    </button>
                    <select
                      aria-label="Ширина экрана"
                      value={page.viewport.width}
                      onChange={(e) =>
                        void mutate(
                          [
                            {
                              type: "setViewport",
                              pageId: page.screenId,
                              width: Number(e.target.value),
                            },
                          ],
                          "Изменить ширину",
                        ).catch(() => {})
                      }
                    >
                      {[390, 768, 1280].map((w) => (
                        <option key={w} value={w}>
                          {w}px
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Масштаб"
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                    >
                      {[0.5, 0.75, 1].map((z) => (
                        <option key={z} value={z}>
                          {z * 100}%
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="document-editor">
                  <aside className="layer-list">
                    <h3>Слои</h3>
                    {flatten(page.nodes).map(({ node, depth }) => (
                      <button
                        key={node.id}
                        aria-label={"Выделить " + node.id}
                        aria-pressed={selected === node.id}
                        style={{ paddingLeft: 12 + depth * 14 }}
                        onClick={() => select(node.id)}
                      >
                        <strong>{node.type}</strong>
                        <small>{node.id}</small>
                      </button>
                    ))}
                    {!page.nodes.length && (
                      <p>Добавь компоненты из библиотеки.</p>
                    )}
                    <p data-testid="selection">Выделено: {selected ?? "—"}</p>
                  </aside>
                  <div className="page-stage" ref={stage}>
                    <div style={{ width: page.viewport.width, zoom }}>
                      <Preview
                        library={displayLibrary}
                        project={project}
                        theme={project.theme}
                        title={"Экран " + page.name}
                        height={850}
                        nodes={page.nodes}
                        selected={selected}
                        onSelect={select}
                      />
                    </div>
                  </div>
                  <aside>
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
                            "Изменить свойства " + node.id,
                            revision,
                          )
                        }
                      />
                    ) : (
                      <div className="inspector">
                        <h3>Инспектор</h3>
                        <p>Выдели компонент на экране или в дереве слоёв.</p>
                      </div>
                    )}
                    {node && (
                      <div className="inspector">
                        <button
                          onClick={() =>
                            void mutate(
                              [{ type: "removeNode", nodeId: node.id }],
                              "Удалить слой",
                            ).catch(() => {})
                          }
                        >
                          Удалить слой
                        </button>
                      </div>
                    )}
                  </aside>
                </div>
              </section>
            )}
            {view === "proposals" && (
              <section>
                <span className="eyebrow">MCP / общий документ</span>
                <h1>Предложения агента</h1>
                {__STUDIO_DEMO__ && (
                  <div className="notice">
                    <p>
                      Интерактивный пример правки. AI и MCP здесь не подключены;
                      настоящие агенты работают с установленной локальной
                      студией.
                    </p>
                    <button
                      onClick={() =>
                        void client
                          ?.request("demo/proposal", {})
                          .then(() => client.proposals())
                          .then(setProposals)
                          .catch((e) => setError(e.message))
                      }
                    >
                      Создать пример предложения
                    </button>
                  </div>
                )}
                <p>
                  По умолчанию агент предлагает правки, а ты подтверждаешь
                  применение. Один пакет — один шаг отмены.
                </p>
                {!proposals.length && (
                  <div className="empty-state">
                    {__STUDIO_DEMO__
                      ? "Пока нет предложений. Нажми «Создать пример предложения», чтобы попробовать подтверждение правки."
                      : "Пока нет предложений. Подключи агента по инструкции MCP в README."}
                  </div>
                )}
                {proposals.map((p) => (
                  <article className="proposal-card" key={p.id}>
                    <header>
                      <h2>
                        {p.description ||
                          p.batch.description ||
                          "Предложение правки"}
                      </h2>
                      <span>{p.status}</span>
                    </header>
                    <p>
                      Автор: {p.batch.author ?? "agent"} · базовая ревизия{" "}
                      {p.batch.baseRevision} · {p.batch.operations.length}{" "}
                      операций
                    </p>
                    <ul>
                      {p.batch.operations
                        .flatMap((op) => proposalChanges(project, op))
                        .map((change, i) => (
                          <li key={i}>{change}</li>
                        ))}
                    </ul>
                    <ProposalPreview
                      project={project}
                      proposal={p}
                      library={displayLibrary}
                    />
                    <details>
                      <summary>Посмотреть точные изменения</summary>
                      <pre>{JSON.stringify(p.batch.operations, null, 2)}</pre>
                    </details>
                    {p.status !== "applied" && p.status !== "rejected" && (
                      <button
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
                        Подтвердить и применить
                      </button>
                    )}
                    {p.status !== "applied" && p.status !== "rejected" && (
                      <button
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
                        Отклонить
                      </button>
                    )}
                    {p.status === "rejected" && (
                      <p>Предложение отклонено · проект не изменён</p>
                    )}
                    {p.status !== "applied" &&
                      p.status !== "rejected" &&
                      p.batch.baseRevision !== project.revision && (
                        <p className="notice">
                          Устаревшая ревизия. Агенту нужно перечитать документ и
                          создать новое предложение.
                        </p>
                      )}
                  </article>
                ))}
              </section>
            )}
            {view === "structure" && (
              <section>
                <h1>Документ проекта</h1>
                <p>
                  {__STUDIO_DEMO__
                    ? "Каноническая схема v2 · изменения сохраняются в браузере. JSON можно экспортировать."
                    : "Каноническая схема v2 · сохранена в локальном project.json. Ключи и пути подключения агента хранятся отдельно."}
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
  );
}
