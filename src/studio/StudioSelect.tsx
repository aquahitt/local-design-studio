import { useEffect, useId, useRef, useState } from "react";
export type SelectOption = { value: string; label: string };
export type SelectSection = { label: string; options: SelectOption[] };
export function StudioSelect({
  label,
  value,
  sections,
  onChange,
  disabled = false,
  fallback,
}: {
  label: string;
  value: string;
  sections: SelectSection[];
  onChange: (value: string) => void;
  disabled?: boolean;
  fallback?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState({
    up: false,
    height: 320,
    left: 0,
  });
  const filtered = sections
    .map((section) => ({
      ...section,
      options: section.options.filter((option) =>
        (section.label + " " + option.label)
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    }))
    .filter((section) => section.options.length);
  const options = filtered.flatMap((section) => section.options);
  const selectedRow = options.findIndex((option) => option.value === value);
  const selected = sections
    .flatMap((section) => section.options)
    .find((option) => option.value === value);
  function close(focus = false) {
    setOpen(false);
    if (focus) trigger.current?.focus();
  }
  function show() {
    if (disabled) return;
    const rect = trigger.current!.getBoundingClientRect();
    const bottom = innerHeight - rect.bottom - 16,
      top = rect.top - 16;
    const up = bottom < 200 && top > bottom;
    setPlacement({
      up,
      height: Math.max(120, Math.min(360, up ? top : bottom)),
      left: Math.max(
        16 - rect.left,
        Math.min(
          0,
          innerWidth -
            16 -
            rect.left -
            Math.min(420, innerWidth - 48, Math.max(280, rect.width)),
        ),
      ),
    });
    setQuery("");
    setActive(
      Math.max(
        0,
        sections
          .flatMap((section) => section.options)
          .findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  }
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const viewport = () => close();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", viewport);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", viewport);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open)
      root.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, query]);
  function choose(option: SelectOption) {
    onChange(option.value);
    close(true);
  }
  let index = -1;
  return (
    <div className="studio-select" ref={root}>
      <button
        ref={trigger}
        className="studio-select-trigger"
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
      >
        <span>{selected?.label ?? fallback ?? "Выбрать…"}</span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div
          className="studio-select-popup"
          style={{
            maxHeight: placement.height,
            left: placement.left,
            ...(placement.up
              ? { bottom: "calc(100% + 8px)" }
              : { top: "calc(100% + 8px)" }),
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            } else if (event.key === "Tab") close();
            else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((current) =>
                options.length
                  ? (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      options.length) %
                    options.length
                  : 0,
              );
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              setActive(
                event.key === "Home" ? 0 : Math.max(0, options.length - 1),
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (options[active]) choose(options[active]);
            }
          }}
        >
          <input
            ref={search}
            type="search"
            aria-label={`Поиск: ${label}`}
            placeholder="Найти…"
            value={query}
            aria-controls={id}
            aria-activedescendant={
              options[active] ? `${id}-${active}` : undefined
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
          <div
            id={id}
            role="listbox"
            aria-label={label}
            className="studio-select-options"
          >
            {filtered.map((section, sectionIndex) => (
              <div
                key={sectionIndex}
                role={section.label ? "group" : undefined}
                aria-label={section.label || undefined}
              >
                {section.label && (
                  <div className="studio-select-heading">{section.label}</div>
                )}
                {section.options.map((option) => {
                  const row = ++index;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      id={`${id}-${row}`}
                      data-index={row}
                      aria-selected={row === selectedRow}
                      className={active === row ? "active" : ""}
                      tabIndex={-1}
                      onPointerMove={() => setActive(row)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(option)}
                    >
                      <span>{option.label}</span>
                      <span aria-hidden="true">
                        {row === selectedRow ? "✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {!options.length && <p role="status">Ничего не найдено</p>}
          </div>
        </div>
      )}
    </div>
  );
}
