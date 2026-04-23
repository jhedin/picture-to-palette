import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

/* Ionic core + required CSS (per Ionic React docs) */
import "@ionic/react/css/core.css";
import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/typography.css";
import "@ionic/react/css/padding.css";
import "@ionic/react/css/float-elements.css";
import "@ionic/react/css/text-alignment.css";
import "@ionic/react/css/text-transformation.css";
import "@ionic/react/css/flex-utils.css";
import "@ionic/react/css/display.css";

/* Ionic dark-mode palette (system-preference-driven) */
import "@ionic/react/css/palettes/dark.system.css";

/* App theme */
import "./theme/variables.css";

import { setupIonicReact } from "@ionic/react";

setupIonicReact({ mode: "md" });

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
