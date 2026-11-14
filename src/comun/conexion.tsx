// Estado de la conexión, siempre visible en la barra: «Sin señal: 3 cargas pendientes».
// Al tocarlo se ve qué está esperando y qué rechazó el servidor (para reintentar o descartar).
import { useEffect, useState } from "react";
import { useCola, sincronizar, descartarOp, reintentarOp, type Op } from "../datos/cola";
import { Ventana, abrir, cerrar } from "./ui";
import { fdt } from "./formato";

export function useEnLinea() {
  const [en, setEn] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setEn(true), b = () => setEn(false);
    window.addEventListener("online", a); window.addEventListener("offline", b);
    return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); };
  }, []);
  return en;
}

const detalle = (o: Op) => {
  const f = o.fila || o.cambios || o.args || {};
  const t = (f as Record<string, unknown>).texto || (f as Record<string, unknown>).trabajo || (f as Record<string, unknown>).titulo || (f as Record<string, unknown>).nombre || (f as Record<string, unknown>).descripcion || o.ruta || "";
  return String(t).slice(0, 80);
};
function Pendientes() {
  const c = useCola(), en = useEnLinea();
  const pend = c.ops.filter((o) => !o.error), rech = c.ops.filter((o) => o.error);
  return (
    <Ventana titulo="Cargas guardadas en este celular">
      {!c.ops.length && <p>No hay nada pendiente: todo está enviado.</p>}
      {pend.length > 0 && <>
        <p>{en ? "Enviando…" : "Sin señal. Se envían solas, en orden, cuando vuelva la señal. No cierres la sesión."}</p>
        <div className="lista">{pend.map((o) => <div key={o.id} className="item"><div className="cuerpo-item"><div className="t">{o.etiqueta}</div><div className="meta"><span>{fdt(new Date(o.ts).toISOString())}</span><span>{detalle(o)}</span></div></div></div>)}</div>
        {en && <button className="boton" onClick={() => sincronizar()}>Enviar ahora</button>}
      </>}
      {rech.length > 0 && <>
        <h3>Rechazadas por el servidor</h3>
        <p className="chico suave">Pasa cuando, mientras no había señal, algo cambió (por ejemplo, la orden ya se cerró) o tu perfil no tiene permiso. Revisalas y descartalas, o reintentá.</p>
        <div className="lista">{rech.map((o) => (
          <div key={o.id} className="item"><div className="cuerpo-item"><div className="t">{o.etiqueta}</div><div className="meta"><span>{fdt(new Date(o.ts).toISOString())}</span><span>{detalle(o)}</span></div>
            <div className="chico" style={{ color: "var(--critico)" }}>{o.error}</div></div>
            <div className="botones" style={{ flexWrap: "nowrap" }}><button className="boton chico" onClick={() => reintentarOp(o.id)}>Reintentar</button><button className="boton chico peligro" onClick={() => descartarOp(o.id)}>Descartar</button></div>
          </div>))}</div>
      </>}
      <div className="botones" style={{ marginTop: "var(--e3)" }}><button className="boton" onClick={cerrar}>Cerrar</button></div>
    </Ventana>
  );
}

export function EstadoConexion() {
  const en = useEnLinea();
  const { cantidad, rechazadas } = useCola();
  const txt = !en ? `Sin señal${cantidad ? `: ${cantidad} ${cantidad === 1 ? "carga pendiente" : "cargas pendientes"}` : ""}`
    : cantidad ? `Enviando ${cantidad} ${cantidad === 1 ? "carga" : "cargas"}…`
    : rechazadas ? `${rechazadas} ${rechazadas === 1 ? "carga rechazada" : "cargas rechazadas"}` : "Conectado";
  return <button type="button" className={"conexion" + (!en ? " sin" : cantidad || rechazadas ? " pend" : "")} role="status" aria-live="polite"
    onClick={() => abrir(<Pendientes />)} title="Ver cargas pendientes">{txt}</button>;
}
