import { createRoot } from "react-dom/client";
import { App } from "./pilot/App";
import "@puckeditor/core/puck.css";
import "./pilot/styles.css";
const root = document.getElementById("root");
if (!root) throw new Error("ROOT_MISSING");
createRoot(root).render(<App />);
