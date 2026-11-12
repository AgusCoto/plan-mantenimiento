import { createRoot } from "react-dom/client";
import "../compartido/estilos.css";
import { App } from "./App";

createRoot(document.getElementById("app")!).render(<App />);

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
