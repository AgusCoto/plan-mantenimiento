// Registro de cambios (jefe y dirección): quién, cuándo, qué cambió y quién aprobó. Lo escribe la base.
import { useState } from "react";
import { useDatos } from "../datos/store";
import { useTema } from "../sistema/tema";
import { fdt } from "../comun/formato";
import type { Cambio } from "../datos/tipos";

const TABLAS: Record<string, string> = {
  equipos: "Equipos", movimientos_equipo: "Movimientos", documentos: "Documentos", reportes_falla: "Reportes de falla", ordenes: "Órdenes",
  fichas: "Fichas", costos_orden: "Costos", pedidos_compra: "Compras", adjuntos: "Fotos y videos", usuarios: "Usuarios", usuario_empresas: "Accesos",
  empresas: "Empresas", areas: "Áreas", tipos_equipo: "Tipos de equipo", listas: "Listas", config: "Configuración", proveedores: "Proveedores",
  temas: "Apariencia", sesion: "Ingresos", "w-main": "Migración de W-Main",
};
const valor = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "sí" : "no") : typeof v === "object" ? "(cambió)" : String(v));
function Detalle({ c }: { c: Cambio }) {
  const [abierto, setAbierto] = useState(false);
  if (c.operacion !== "modificacion" || !c.cambios) return null;
  const l = Object.entries(c.cambios).filter(([k]) => !/_id$|^id$|^tokens$/.test(k));
  if (!l.length) return null;
  return abierto
    ? <ul className="chico suave" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{l.map(([k, v]) => { const [a, b] = v as [unknown, unknown]; return <li key={k}>{k.replace(/_/g, " ")}: {valor(a)} → {valor(b)}</li>; })}</ul>
    : <button className="boton chico" style={{ marginTop: 4 }} onClick={() => setAbierto(true)}>Ver qué cambió</button>;
}
export function Registro() {
  const d = useDatos(), tema = useTema();
  const [u, setU] = useState(""); const [t, setT] = useState(""); const [op, setOp] = useState("");
  const l = d.registro_cambios.filter((c) => (!u || c.usuario_id === u) && (!t || c.tabla === t) && (!op || c.operacion === op));
  return (
    <>
      <div className="encabezado"><div><h1>Registro de cambios</h1><p>Lo anota la base de datos y nadie lo puede editar ni borrar. Se muestran los últimos 1000 movimientos.</p></div></div>
      <div className="filtros">
        <select value={u} onChange={(e) => setU(e.target.value)} aria-label="Persona"><option value="">Todas las personas</option>{d.usuarios.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        <select value={t} onChange={(e) => setT(e.target.value)} aria-label="Qué"><option value="">Todo</option>{Object.entries(TABLAS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <select value={op} onChange={(e) => setOp(e.target.value)} aria-label="Tipo"><option value="">Altas, cambios, bajas e ingresos</option><option value="alta">Altas</option><option value="modificacion">Cambios</option><option value="baja">Bajas</option><option value="ingreso">Ingresos</option><option value="conflicto">Conflictos de sincronización</option></select>
      </div>
      <section className="panel">{l.length ? (
        <div className="tabla"><table><thead><tr><th>Fecha y hora</th><th>Persona</th><th>Qué hizo</th></tr></thead><tbody>
          {l.slice(0, 500).map((c) => (
            <tr key={c.id}><td className="num" style={{ whiteSpace: "nowrap" }}>{fdt(c.ts)}</td><td>{c.nombre}<div className="chico suave">{c.perfil ? tema.t(c.perfil) : ""}</div></td>
              <td>{c.resumen}{c.aprobo_nombre && <div className="chico suave">Aprobó: {c.aprobo_nombre}</div>}<Detalle c={c} /></td></tr>))}
        </tbody></table></div>) : <p className="vacio">No hay movimientos{u || t || op ? " con este filtro" : ""}.</p>}</section>
    </>
  );
}
