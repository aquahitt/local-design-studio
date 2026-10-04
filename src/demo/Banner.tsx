import { useEffect } from "react";
import { DEMO_STORAGE_KEY, BrowserDemoClient } from "./client";
export function DemoBanner() {
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
    <aside className="demo-banner" aria-label="Режим демо">
      <div>
        <strong>Интерактивное демо</strong>
        <span>
          Синтетические примеры · изменения только в этом браузере · AI/MCP
          показаны как пример
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
          if (confirm("Сбросить изменения демо и вернуть начальные примеры?")) {
            await BrowserDemoClient.reset(localStorage);
            location.reload();
          }
        }}
      >
        Сбросить демо
      </button>
    </aside>
  );
}
