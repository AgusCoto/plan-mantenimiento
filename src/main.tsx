import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./sistema/base.css";
import { App } from "./App";

createRoot(document.getElementById("app")!).render(<BrowserRouter><App /></BrowserRouter>);

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
