import { DesktopApp } from "./desktop/App";
import { DemoBanner } from "./demo/Banner";
import { createRoot } from "react-dom/client";
import { App } from "./pilot/App";
import { StudioApp } from "./studio/App";
import { PreviewApp } from "./studio/iframeentry";
import { I18nProvider } from "./studio/i18n";
import "./studio/styles.css";
import "@puckeditor/core/puck.css";
import "./pilot/styles.css";
const root = document.getElementById("root");
if (!root) throw new Error("ROOT_MISSING");
createRoot(root).render(
  location.pathname === import.meta.env.BASE_URL + "preview" ||
    new URLSearchParams(location.search).has("preview") ? (
    <PreviewApp />
  ) : __STUDIO_DESKTOP__ ? (
    <I18nProvider><DesktopApp /></I18nProvider>
  ) : location.pathname.startsWith("/pilot") ? (
    <App />
  ) : (
    <I18nProvider>
      {__STUDIO_DEMO__ && <DemoBanner />}
      <StudioApp />
    </I18nProvider>
  ),
);
