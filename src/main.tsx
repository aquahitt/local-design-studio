import { DemoBanner } from "./demo/Banner";
import { createRoot } from "react-dom/client";
import { App } from "./pilot/App";
import { StudioApp } from "./studio/App";
import { PreviewApp } from "./studio/iframeentry";
import "./studio/styles.css";
import "@puckeditor/core/puck.css";
import "./pilot/styles.css";
const root = document.getElementById("root");
if (!root) throw new Error("ROOT_MISSING");
createRoot(root).render(
  location.pathname === import.meta.env.BASE_URL + "preview" ||
    new URLSearchParams(location.search).has("preview") ? (
    <PreviewApp />
  ) : location.pathname.startsWith("/pilot") ? (
    <App />
  ) : (
    <>
      {__STUDIO_DEMO__ && <DemoBanner />}
      <StudioApp />
    </>
  ),
);
