import { createRoot } from "react-dom/client";
import { PreviewApp } from "../studio/iframeentry";
import "../studio/styles.css";
createRoot(document.getElementById("root")!).render(<PreviewApp />);
