import { useI18n } from "../studio/i18n";
import { useEffect, useRef } from "react";
import { DEMO_STORAGE_KEY, BrowserDemoClient } from "./client";
export function DemoBanner() {
  const { t } = useI18n();

  const banner = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!banner.current) return;
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        "--studio-demo-offset",
        banner.current!.getBoundingClientRect().height + "px",
      ),
    );
    observer.observe(banner.current);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--studio-demo-offset");
    };
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === DEMO_STORAGE_KEY || event.key === null) &&
        event.newValue === null
      )
        location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return (
    <aside ref={banner} className="demo-banner" aria-label={t("Режим демо")}>
      <div>
        <strong>{t("Интерактивное демо")}</strong>
        <span>
          {t(
            "Дизайн-система студии · изменения только в этом браузере · AI/MCP показаны как пример",
          )}
        </span>
      </div>
      <a
        href="https://github.com/aquahitt/local-design-studio"
        target="_blank"
        rel="noreferrer"
      >
        GitHub ↗
      </a>
      <button
        onClick={async () => {
          if (
            confirm(t("Сбросить изменения демо и вернуть начальные примеры?"))
          ) {
            await BrowserDemoClient.reset(localStorage);
            location.reload();
          }
        }}
      >
        {t("Сбросить демо")}
      </button>
    </aside>
  );
}
