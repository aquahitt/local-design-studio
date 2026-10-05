import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ComponentDefinition,
  ComponentLibrary,
  Props,
} from "../library/sdk";
import type { Project } from "../core/project";
import { Preview } from "./Preview";
const BATCH_SIZE = 12;

type CatalogProps = {
  library: ComponentLibrary;
  project: Project;
  onAdd: (type: string, props: Props) => void;
};

function CatalogCard({
  type,
  definition,
  library,
  project,
  onAdd,
  chosen,
  onChoose,
}: CatalogProps & {
  type: string;
  definition: ComponentDefinition;
  chosen: string;
  onChoose: (type: string, name: string) => void;
}) {
  const [span, setSpan] = useState(20);
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      // Grid rows are 8px high with a 16px gap; include the final gutter.
      setSpan(Math.ceil((element.getBoundingClientRect().height + 16) / 24));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fixture =
    definition.fixtures.find((f) => f.name === chosen) ??
    definition.fixtures[0];
  const props = useMemo(
    () => ({ ...definition.defaultProps, ...fixture?.props }),
    [definition, fixture],
  );
  return (
    <div className="catalog-pin" style={{ gridRowEnd: `span ${span}` }}>
      <article
        ref={content}
        className="catalog-card"
        data-component-type={type}
      >
        <div className="catalog-preview">
          <Preview
            library={library}
            project={project}
            theme={project.theme}
            title={"Пример " + type}
            component={{ type, props }}
            autoHeight
          />
        </div>
        <header>
          <div>
            <small>{definition.category ?? "Компонент"}</small>
            <h2>{definition.name}</h2>
          </div>
          <span className="support">
            {definition.support === "requires-context"
              ? "Нужен контекст"
              : "React"}
          </span>
        </header>
        {definition.description && (
          <p className="component-description">{definition.description}</p>
        )}
        <footer>
          <select
            aria-label={"Состояние " + type}
            value={fixture?.name ?? ""}
            disabled={!definition.fixtures.length}
            onChange={(e) => onChoose(type, e.target.value)}
          >
            {definition.fixtures.map((f) => (
              <option key={f.name}>{f.name}</option>
            ))}
          </select>
          <button
            onClick={() => onAdd(type, props)}
            disabled={definition.support === "requires-context"}
          >
            На экран +
          </button>
        </footer>
      </article>
    </div>
  );
}

export function Catalog(props: CatalogProps) {
  return (
    <CatalogBoard
      key={props.library.id + "@" + props.library.version}
      {...props}
    />
  );
}

function CatalogBoard({ library, project, onAdd }: CatalogProps) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);
  const all = useMemo(() => Object.entries(library.components), [library]);
  const categories = useMemo(
    () => [...new Set(all.map(([, c]) => c.category ?? "Компонент"))],
    [all],
  );
  const entries = useMemo(
    () =>
      all.filter(
        ([type, c]) =>
          (!category || (c.category ?? "Компонент") === category) &&
          (
            type +
            " " +
            c.name +
            " " +
            (c.category ?? "") +
            " " +
            (c.description ?? "")
          )
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [all, category, query],
  );
  const shown = Math.min(visibleCount, entries.length);
  const hasMore = shown < entries.length;
  useEffect(() => {
    if (
      !hasMore ||
      !sentinel.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    let requested = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !requested) {
          requested = true;
          setVisibleCount((count) =>
            Math.min(count + BATCH_SIZE, entries.length),
          );
        }
      },
      { rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, visibleCount, entries]);
  const reset = () => {
    setQuery("");
    setCategory(null);
    setVisibleCount(BATCH_SIZE);
  };
  return (
    <section className="catalog-board" aria-label="Библиотека компонентов">
      <div className="section-title catalog-heading">
        <div>
          <span className="eyebrow">
            {library.name} · {library.version}
          </span>
          <h1>Библиотека компонентов</h1>
          <p data-testid="catalog-count">
            {all.length} компонентов · выбери состояние и добавь на экран
          </p>
        </div>
        <input
          type="search"
          aria-label="Поиск компонентов"
          placeholder="Найти компонент…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisibleCount(BATCH_SIZE);
          }}
        />
      </div>
      <div
        className="catalog-filters"
        role="group"
        aria-label="Категории компонентов"
      >
        <button
          aria-pressed={category === null}
          onClick={() => {
            setCategory(null);
            setVisibleCount(BATCH_SIZE);
          }}
        >
          Все компоненты
        </button>
        {categories.map((name) => (
          <button
            key={name}
            aria-pressed={category === name}
            onClick={() => {
              setCategory(name);
              setVisibleCount(BATCH_SIZE);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="catalog-grid" data-testid="catalog-board">
        {entries.slice(0, visibleCount).map(([type, definition]) => (
          <CatalogCard
            key={type}
            {...{ type, definition, library, project, onAdd }}
            chosen={chosen[type] ?? ""}
            onChoose={(type, name) =>
              setChosen((previous) => ({ ...previous, [type]: name }))
            }
          />
        ))}
      </div>
      {!entries.length && (
        <div className="catalog-empty">
          <h2>Ничего не найдено</h2>
          <p>Попробуй другое название или категорию.</p>
          <button onClick={reset}>Сбросить фильтры</button>
        </div>
      )}
      {!!entries.length && (
        <div
          ref={sentinel}
          className="catalog-load-more"
          data-testid="catalog-sentinel"
        >
          <p role="status" aria-live="polite">
            Показано {shown} из {entries.length}
            {!hasMore && " · Все компоненты загружены"}
          </p>
          {hasMore && (
            <button
              onClick={() =>
                setVisibleCount((count) =>
                  Math.min(count + BATCH_SIZE, entries.length),
                )
              }
            >
              Показать ещё
            </button>
          )}
        </div>
      )}
    </section>
  );
}
