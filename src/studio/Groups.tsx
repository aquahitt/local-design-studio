import { StudioSelect } from "./StudioSelect";
import { useEffect, useRef, useState } from "react";
import type { Project, ProjectGroup } from "../core/project";
import type { ComponentLibrary } from "../library/sdk";
export type GroupKind = "pages" | "components" | "tokens";
export function inGroup(
  project: Project,
  filter: string,
  kind: GroupKind,
  id: string,
): boolean {
  if (!filter) return true;
  if (filter === "ungrouped")
    return !(project.groups ?? []).some((group) => group[kind].includes(id));
  const group = project.groups?.find((group) => group.id === filter);
  return !group || group[kind].includes(id);
}
export function Groups({
  project,
  library,
  filter,
  onFilter,
  disabled,
  onApply,
}: {
  project: Project;
  library: ComponentLibrary;
  filter: string;
  onFilter: (id: string) => void;
  disabled: boolean;
  onApply: (groups: ProjectGroup[], revision: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const validFilter =
    filter === "ungrouped" || project.groups?.some((g) => g.id === filter)
      ? filter
      : "";
  return (
    <div className="group-toolbar">
      <span>Группа</span>
      <StudioSelect
        label="Группа проекта"
        disabled={disabled}
        value={validFilter}
        onChange={onFilter}
        sections={[
          {
            label: "",
            options: [
              { value: "", label: "Все группы" },
              { value: "ungrouped", label: "Без группы" },
              ...(project.groups ?? []).map((group) => ({
                value: group.id,
                label: group.name,
              })),
            ],
          },
        ]}
      />
      <button disabled={disabled} onClick={() => setOpen(true)}>
        Управлять группами
      </button>
      {open && (
        <GroupEditor
          project={project}
          library={library}
          onClose={() => setOpen(false)}
          onApply={onApply}
        />
      )}
    </div>
  );
}
function GroupEditor({
  project,
  library,
  onClose,
  onApply,
}: {
  project: Project;
  library: ComponentLibrary;
  onClose: () => void;
  onApply: (groups: ProjectGroup[], revision: number) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState(() =>
    structuredClone(project.groups ?? []),
  );
  const [revision] = useState(project.revision);
  const [selected, setSelected] = useState(groups[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [kind, setKind] = useState<GroupKind>("pages");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const group = groups.find((g) => g.id === selected);
  const stale = revision !== project.revision;
  const update = (patch: Partial<ProjectGroup>) =>
    setGroups((values) =>
      values.map((g) => (g.id === selected ? { ...g, ...patch } : g)),
    );
  const items =
    kind === "pages"
      ? project.pages.map((p) => [p.screenId, p.name])
      : kind === "tokens"
        ? Object.keys(project.tokens).map((name) => [name, name])
        : [
            ...new Set([
              ...Object.keys(library.components),
              ...(group?.components ?? []),
            ]),
          ].map((type) => [
            type,
            library.components[type]?.name ?? `${type} · недоступен`,
          ]);
  const filteredItems = items.filter(([id, name]) =>
    (id + " " + name).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <dialog
      ref={dialog}
      className="group-dialog"
      aria-label="Управление группами"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>Группы проекта</h2>
        <button aria-label="Закрыть группы" disabled={busy} onClick={onClose}>
          ×
        </button>
      </header>
      <p>
        Объединяй экраны, компоненты и токены. Элемент может входить в несколько
        групп.
      </p>
      <form
        className="group-create"
        onSubmit={(event) => {
          event.preventDefault();
          const name = newName.trim();
          if (
            !name ||
            groups.some((g) => g.name.toLowerCase() === name.toLowerCase())
          ) {
            setError("Укажи уникальное название группы.");
            return;
          }
          if (groups.length >= 100) {
            setError("Можно создать до 100 групп.");
            return;
          }
          const id = crypto.randomUUID();
          setGroups([
            ...groups,
            { id, name, pages: [], components: [], tokens: [] },
          ]);
          setSelected(id);
          setNewName("");
          setError("");
        }}
      >
        <input
          aria-label="Название новой группы"
          placeholder="PWA Buyer, PWA Business, Site…"
          maxLength={100}
          value={newName}
          disabled={busy}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button disabled={busy}>Создать группу</button>
      </form>
      <div className="group-editor-body">
        <aside aria-label="Список групп">
          {groups.map((g) => (
            <button
              key={g.id}
              aria-pressed={selected === g.id}
              disabled={busy}
              onClick={() => {
                setSelected(g.id);
                setQuery("");
              }}
            >
              {g.name}
              <small>
                {g.pages.length} экранов · {g.components.length} компонентов ·{" "}
                {g.tokens.length} токенов
              </small>
            </button>
          ))}
          {!groups.length && <p>Создай первую группу.</p>}
        </aside>
        {group && (
          <section className="group-members">
            <div className="group-name">
              <label>
                Название{" "}
                <input
                  aria-label="Название группы"
                  value={group.name}
                  maxLength={100}
                  disabled={busy}
                  onChange={(event) => update({ name: event.target.value })}
                />
              </label>
              <button
                disabled={busy}
                onClick={() => {
                  setGroups(groups.filter((g) => g.id !== selected));
                  setSelected(groups.find((g) => g.id !== selected)?.id ?? "");
                }}
              >
                Удалить группу
              </button>
            </div>
            <div className="group-tabs">
              {(
                [
                  ["pages", "Экраны"],
                  ["components", "Компоненты"],
                  ["tokens", "Токены"],
                ] as const
              ).map(([value, name]) => (
                <button
                  key={value}
                  aria-pressed={kind === value}
                  onClick={() => {
                    setKind(value);
                    setQuery("");
                  }}
                >
                  {name} · {group[value].length}
                </button>
              ))}
            </div>
            <input
              aria-label="Поиск элементов группы"
              placeholder="Найти элемент…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="group-tabs">
              <button
                disabled={busy || !filteredItems.length}
                onClick={() =>
                  update({
                    [kind]: [
                      ...new Set([
                        ...group[kind],
                        ...filteredItems.map(([id]) => id),
                      ]),
                    ],
                  })
                }
              >
                Выбрать найденные
              </button>
              <button
                disabled={busy || !filteredItems.length}
                onClick={() => {
                  const ids = new Set(filteredItems.map(([id]) => id));
                  update({ [kind]: group[kind].filter((id) => !ids.has(id)) });
                }}
              >
                Убрать найденные
              </button>
            </div>
            <div className="group-member-list">
              {filteredItems.map(([id, name]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    aria-label={`В группу: ${name}`}
                    checked={group[kind].includes(id)}
                    disabled={busy}
                    onChange={(event) =>
                      update({
                        [kind]: event.target.checked
                          ? [...group[kind], id]
                          : group[kind].filter((value) => value !== id),
                      })
                    }
                  />
                  {name}
                </label>
              ))}
              {!items.length && <p>В проекте пока нет элементов этого типа.</p>}
            </div>
          </section>
        )}
      </div>
      {stale && (
        <p role="alert">
          Проект изменился. Закрой окно и открой снова, чтобы работать с
          актуальной версией.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <footer>
        <span>Удаление группы сохраняет её элементы.</span>
        <button disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          disabled={busy || stale}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onApply(
                groups.map((g) => ({ ...g, name: g.name.trim() })),
                revision,
              );
              onClose();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Сохранить группы
        </button>
      </footer>
    </dialog>
  );
}
