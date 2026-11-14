// Estado de la conexión, siempre visible en la barra: «Sin señal: 3 cargas pendientes».
import { useEffect, useState } from "react";
import { usePendientes } from "../datos/cola";

export function useEnLinea() {
  const [en, setEn] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setEn(true), b = () => setEn(false);
    window.addEventListener("online", a); window.addEventListener("offline", b);
    return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); };
  }, []);
  return en;
}

export function EstadoConexion() {
  const en = useEnLinea();
  const { cantidad, rechazadas } = usePendientes();
  const txt = !en ? `Sin señal${cantidad ? `: ${cantidad} ${cantidad === 1 ? "carga pendiente" : "cargas pendientes"}` : ""}`
    : cantidad ? `Enviando ${cantidad} ${cantidad === 1 ? "carga" : "cargas"}…`
    : rechazadas ? `${rechazadas} ${rechazadas === 1 ? "carga rechazada" : "cargas rechazadas"}` : "Conectado";
  return <span className={"conexion" + (!en ? " sin" : cantidad || rechazadas ? " pend" : "")} role="status" aria-live="polite">{txt}</span>;
}
