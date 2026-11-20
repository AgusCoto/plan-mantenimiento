import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./sistema/base.css";
import { App } from "./App";

// Dirección base: «/» en desarrollo, «/plan-mantenimiento/» en GitHub Pages
const BASE = import.meta.env.BASE_URL;

// Etiquetas viejas de W-Main: <dirección>#<código> o ?equipo=<código> → /e/<código> (la app reconoce los códigos viejos)
// (solo en la dirección raíz, que es a donde apuntan las etiquetas viejas)
(() => {
  if (location.pathname !== BASE && location.pathname !== BASE + "index.html") return;
  let t = "";
  try { t = decodeURIComponent(location.hash.slice(1)); } catch { t = location.hash.slice(1); }
  if (!t) { const m = /[?&]equipo=([^&#]+)/.exec(location.search); if (m) { try { t = decodeURIComponent(m[1]); } catch { t = m[1]; } } }
  if (t && !t.startsWith("/") && t.length < 80) history.replaceState(null, "", BASE + "e/" + encodeURIComponent(t));
})();

createRoot(document.getElementById("app")!).render(<BrowserRouter basename={BASE.replace(/\/$/, "") || "/"}><App /></BrowserRouter>);

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register(BASE + "sw.js", { scope: BASE }).catch(() => {});
}
