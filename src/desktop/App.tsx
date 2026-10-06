import { useI18n } from "../studio/i18n";
import { useEffect, useState, useRef } from "react";
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
  const { t, locale } = useI18n();

  const projectbar = useRef<HTMLElement>(null);
  const bridge = window.studioDesktop;
  const [active, setActive] = useState<DesktopProject | null>(null);
  const [recent, setRecent] = useState<DesktopProject[]>([]);
  const [name, setName] = useState(t("Новый проект"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (bridge)
      void bridge.setLocale(locale).catch((error) => setError(error.message));
  }, [bridge, locale]);
  useEffect(() => {
    if (bridge)
      void bridge
        .recent()
        .then(setRecent)
        .catch((e) => setError(String(e.message)));
  }, [bridge]);
  useEffect(() => {
    if (!active || !projectbar.current) return;
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        "--studio-desktop-offset",
        projectbar.current!.getBoundingClientRect().height + "px",
      ),
    );
    observer.observe(projectbar.current);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--studio-desktop-offset");
    };
  }, [active]);
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
      setError(
        messages[message]
          ? t(messages[message])
          : t("Не удалось открыть проект: ") + message,
      );
    } finally {
      setBusy(false);
    }
  }
  if (!bridge)
    return (
      <main className="desktop-launcher">
        <p role="alert">
          {t("Desktop-мост недоступен. Перезапусти приложение.")}
        </p>
      </main>
    );
  if (active)
    return (
      <>
        <header ref={projectbar} className="desktop-projectbar">
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
            {t("Все проекты")}
          </button>
          <strong>{active.name}</strong>
          <span title={active.root}>{active.root}</span>
          <button
            disabled={busy}
            onClick={() => void run(() => bridge.configureLibrary())}
          >
            {active.library
              ? t("Сменить библиотеку")
              : t("Подключить библиотеку")}
          </button>
          {active.library && (
            <button
              disabled={busy}
              onClick={() => void run(() => bridge.clearLibrary())}
            >
              {t("Отключить библиотеку")}
            </button>
          )}
          {error && <p role="alert">{error}</p>}
          {active.libraryError && (
            <p role="alert">
              {t("Библиотека недоступна:")} {active.libraryError}
              {t(". Подключи её заново или отключи.")}
            </p>
          )}
        </header>
        <StudioApp
          key={active.root + (active.library?.bundleUrl ?? "")}
          desktopLibrary={active.library}
        />
      </>
    );
  return (
    <main className="desktop-launcher">
      <div className="desktop-intro">
        <span className="eyebrow">LOCAL DESIGN STUDIO</span>
        <h1>{t("Твои проекты — на твоём компьютере")}</h1>
        <p>
          {t(
            "Собирай экраны, работай с компонентами и проверяй предложения агента. Изменения сохраняются в папке проекта.",
          )}
        </p>
      </div>
      <div className="desktop-startgrid">
        <section className="desktop-new">
          <h2>{t("Начать проект")}</h2>
          <label>
            {t("Название проекта")}
            <input
              aria-label={t("Название проекта")}
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
            {t("Создать проект")}
          </button>
          <small>
            {t(
              "Выбери пустую папку. Приложение сохранит туда документ и ресурсы.",
            )}
          </small>
          <div className="desktop-actions">
            <button
              disabled={busy}
              onClick={() => void run(() => bridge.open())}
            >
              {t("Открыть проект")}
            </button>
            <button
              disabled={busy}
              onClick={() => void run(() => bridge.example())}
            >
              {t("Попробовать пример")}
            </button>
          </div>
        </section>
        <section className="desktop-recent">
          <h2>{t("Недавние проекты")}</h2>
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
            <p>{t("Здесь появятся проекты, которые ты открывал.")}</p>
          )}
        </section>
      </div>
      {busy && <p role="status">{t("Открываем проект…")}</p>}
      {error && (
        <div className="desktop-error" role="alert">
          {error}
        </div>
      )}
      <footer>
        {t(
          "Работает локально · дизайн-система студии включена · библиотеки подключаются для выбранного проекта",
        )}
      </footer>
    </main>
  );
}
