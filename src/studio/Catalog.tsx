import { useState } from "react";
import type { ComponentLibrary, Props } from "../library/sdk";
import type { Project } from "../core/project";
import { Preview } from "./Preview";
export function Catalog({
  library,
  project,
  onAdd,
}: {
  library: ComponentLibrary;
  project: Project;
  onAdd: (type: string, props: Props) => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const entries = Object.entries(library.components).filter(([type, c]) =>
    (type + " " + c.name + " " + (c.category ?? ""))
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section>
      <div className="section-title">
        <div>
          <span className="eyebrow">
            {library.id} / {library.version}
          </span>
          <h1>Библиотека компонентов</h1>
          <p data-testid="catalog-count">
            {Object.keys(library.components).length} компонентов · реальные
            реализации, свойства и состояния
          </p>
        </div>
        <input
          aria-label="Поиск компонентов"
          placeholder="Поиск компонентов…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="catalog-grid">
        {entries.map(([type, definition]) => {
          const fixture =
            definition.fixtures.find((f) => f.name === chosen[type]) ??
            definition.fixtures[0];
          const props = { ...definition.defaultProps, ...fixture?.props };
          return (
            <article className="catalog-card" key={type}>
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
              <Preview
                library={library}
                project={project}
                theme={project.theme}
                title={"Пример " + type}
                component={{ type, props }}
              />
              <footer>
                <select
                  aria-label={"Состояние " + type}
                  value={fixture?.name ?? ""}
                  onChange={(e) =>
                    setChosen({ ...chosen, [type]: e.target.value })
                  }
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
              {definition.description && (
                <p className="component-description">
                  {definition.description}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
