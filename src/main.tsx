import "@fontsource/figtree/latin-400.css";
import "@fontsource/figtree/latin-600.css";
import "@fontsource/figtree/latin-700.css";
import "./app/styles.css";
import "./app/phone.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyBrandTokens } from "./app/applyBrandTokens";
import { db } from "./db/db";
import { initDatabase } from "./db/init";

applyBrandTokens();

initDatabase(db).catch((error: unknown) => {
  console.error("Database setup failed", error);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
