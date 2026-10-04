import { useEffect, useState } from "react";
import { StudioApp } from "../studio/App";
import type { DesktopProject } from "./types";
import "./styles.css";
const messages: Record<string, string> = {
  PROJECT_NOT_FOUND:
    "В выбранной папке нет проекта. Выбери папку с project.json.",
  PROJECT_ROOT_NOT_EMPTY: "Для нового проекта выбери пустую папку.",
  PROJECT_ALREADY_EXISTS:
    "В папке уже есть проект. Используй «Открыть проект».",
  OWNER_CONFIGURATION_MISMATCH:
    "Проект открыт другим сервисом с другой библиотекой. Закрой его и повтори открытие.",
  OWNER_ORIGIN_MISMATCH:
    "Проект открыт в браузерной студии. Закрой её сервис, затем открой проект здесь.",
  UNSAFE_SYMLINK: "Выбери папку проекта напрямую, без символьной ссылки.",
};
export function DesktopApp() {
  const bridge = window.studioDesktop;
  const [active, setActive] = useState<DesktopProject | null>(null);
  const [recent, setRecent] = useState<DesktopProject[]>([]);
  const [name, setName] = useState("Новый проект");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (bridge)
      void bridge
        .recent()
        .then(setRecent)
        .catch((e) => setError(String(e.message)));
  }, [bridge]);
  async function run(action: () => Promise<DesktopProject | null>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const project = await action();
      if (project) setActive(project);
      setRecent(await bridge!.recent());
    } catch (e) {
      const message = (e as Error).message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      );
      setError(messages[message] ?? "Не удалось открыть проект: " + message);
    } finally {
      setBusy(false);
    }
  }
  if (!bridge)
    return (
      <main className="desktop-launcher">
        <p role="alert">Desktop-мост недоступен. Перезапусти приложение.</p>
      </main>
    );
  if (active)
    return (
      <>
        <header className="desktop-projectbar">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await bridge.home();
                setActive(null);
                setError("");
                setRecent(await bridge.recent());
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Все проекты
          </button>
          <strong>{active.name}</strong>
          <span title={active.root}>{active.root}</span>
          {error && <p role="alert">{error}</p>}
        </header>
        <StudioApp key={active.root} />
      </>
    );
  return (
    <main className="desktop-launcher">
      <div className="desktop-intro">
        <span className="eyebrow">LOCAL DESIGN STUDIO</span>
        <h1>Твои проекты — на твоём компьютере</h1>
        <p>
          Собирай экраны, работай с компонентами и проверяй предложения агента.
          Изменения сохраняются в папке проекта.
        </p>
      </div>
      <div className="desktop-startgrid">
        <section className="desktop-new">
          <h2>Начать проект</h2>
          <label>
            Название проекта
            <input
              aria-label="Название проекта"
              value={name}
              maxLength={160}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !name.trim()}
            onClick={() => void run(() => bridge.create(name))}
          >
            Создать проект
          </button>
          <small>
            Выбери пустую папку. Приложение сохранит туда документ и ресурсы.
          </small>
          <div className="desktop-actions">
            <button
              disabled={busy}
              onClick={() => void run(() => bridge.open())}
            >
              Открыть проект
            </button>
            <button
              disabled={busy}
              onClick={() => void run(() => bridge.example())}
            >
              Попробовать пример
            </button>
          </div>
        </section>
        <section className="desktop-recent">
          <h2>Недавние проекты</h2>
          {recent.length ? (
            recent.map((p) => (
              <button
                key={p.root}
                disabled={busy}
                onClick={() => void run(() => bridge.reopen(p.root))}
              >
                <strong>{p.name}</strong>
                <span title={p.root}>{p.root}</span>
              </button>
            ))
          ) : (
            <p>Здесь появятся проекты, которые ты открывал.</p>
          )}
        </section>
      </div>
      {busy && <p role="status">Открываем проект…</p>}
      {error && (
        <div className="desktop-error" role="alert">
          {error}
        </div>
      )}
      <footer>
        Работает локально · example/builtin библиотеки включены · внешние
        библиотеки подключаются в версии для разработчиков
      </footer>
    </main>
  );
}
