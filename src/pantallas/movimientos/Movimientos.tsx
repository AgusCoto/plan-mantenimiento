// Movimientos de equipos: préstamos entre empresas (los decide el jefe, que registra salida y vuelta),
// reparaciones externas (salida y vuelta con remito, costo y garantía), reubicaciones y bajas.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { llamar } from "../../datos/cola";
import { Campo, Codigo, Emp, Pastilla, Ventana, abrir, avisar, type ColorEstado } from "../../comun/ui";
import { Medios } from "../../comun/archivos";
import { fd, hoy, pesos } from "../../comun/formato";
import { numero } from "./AccionesEquipo";
import type { Movimiento } from "../../datos/tipos";

export const ESTADOS_MOV: Record<Movimiento["estado"], [string, ColorEstado]> = {
  solicitado: ["Por aprobar", "alerta"], aprobado: ["Aprobado, sin salir", "info"], rechazado: ["Rechazado", ""], en_curso: ["Fuera", "alerta"], cerrado: ["Cerrado", "ok"],
};
const atrasado = (m: Movimiento) => m.estado === "en_curso" && !!m.fecha_vuelta_prevista && m.fecha_vuelta_prevista < hoy();

function Resolver({ m, aprobar }: { m: Movimiento; aprobar: boolean }) {
  const d = useDatos();
  return (
    <Ventana titulo={aprobar ? "Aprobar el préstamo" : "Rechazar el préstamo"} ok={aprobar ? "Aprobar" : "Rechazar"} peligro={!aprobar} onSubmit={async (v) => {
      await llamar("resolver_prestamo", { p_mov: m.id, p_aprobar: aprobar, p_respuesta: v.respuesta || null });
      await d.recargar("movimientos_equipo"); avisar(aprobar ? "Préstamo aprobado" : "Préstamo rechazado");
    }}>
      <p><Codigo>{d.equipo(m.equipo_id)?.codigo}</Codigo> {d.equipo(m.equipo_id)?.nombre} → <b>{d.empresa(m.empresa_destino_id)?.nombre}</b></p>
      <Campo label={aprobar ? "Comentario (opcional)" : "Motivo *"}><input type="text" name="respuesta" required={!aprobar} /></Campo>
    </Ventana>
  );
}
function Cancelar({ m }: { m: Movimiento }) {
  const d = useDatos();
  return (
    <Ventana titulo="Cancelar el préstamo" ok="Cancelar el préstamo" peligro onSubmit={async (v) => {
      await llamar("cancelar_prestamo", { p_mov: m.id, p_motivo: v.motivo });
      await d.recargar("movimientos_equipo"); avisar("Préstamo cancelado");
    }}>
      <Campo label="Motivo *"><input type="text" name="motivo" required /></Campo>
    </Ventana>
  );
}
function Salida({ m }: { m: Movimiento }) {
  const d = useDatos();
  return (
    <Ventana titulo="Registrar la salida" ok="Salió" onSubmit={async (v) => {
      await llamar("mover_equipo", { p_mov: m.id, p_accion: "salida", p_fecha: v.fecha || hoy() });
      await d.recargar("movimientos_equipo", "equipos"); avisar("Salida registrada: el equipo figura en " + (d.empresa(m.empresa_destino_id)?.sigla || "destino"));
    }}>
      <p>El equipo pasa a figurar en <b>{d.empresa(m.empresa_destino_id)?.nombre}</b>. Sigue siendo de su empresa dueña.</p>
      <Campo label="Fecha de salida"><input type="date" name="fecha" defaultValue={hoy()} max={hoy()} /></Campo>
    </Ventana>
  );
}
function Vuelta({ m }: { m: Movimiento }) {
  const d = useDatos();
  const rep = m.tipo === "reparacion_externa";
  return (
    <Ventana titulo="Registrar la vuelta" ok="Volvió" onSubmit={async (v) => {
      const datos: Record<string, unknown> = {};
      if (rep) { if (v.remito) datos.remito = v.remito; if (v.garantia) datos.garantia_hasta = v.garantia; if (v.costo) datos.costo = numero(v.costo); }
      else { if (v.area) datos.area_id = v.area; if (v.ubicacion) datos.ubicacion = v.ubicacion; }
      await llamar("mover_equipo", { p_mov: m.id, p_accion: "vuelta", p_fecha: v.fecha || hoy(), p_datos: datos });
      await d.recargar("movimientos_equipo", "equipos"); avisar("Vuelta registrada");
    }}>
      <Campo label="Fecha de vuelta"><input type="date" name="fecha" defaultValue={hoy()} max={hoy()} /></Campo>
      {rep ? <>
        <div className="fila">
          <Campo label="Costo final ($)"><input type="text" name="costo" inputMode="decimal" defaultValue={m.presupuesto != null ? String(m.presupuesto).replace(".", ",") : ""} /></Campo>
          <Campo label="Remito de vuelta"><input type="text" name="remito" /></Campo>
        </div>
        <Campo label="Garantía hasta"><input type="date" name="garantia" /></Campo>
        <p className="chico suave">El equipo vuelve a «operativo».</p>
      </> : <>
        <p className="chico suave">Vuelve a {d.empresa(m.empresa_origen_id)?.nombre}. Si no indicás otro lugar, vuelve a donde estaba{m.ubicacion_origen ? ` (${m.ubicacion_origen})` : ""}.</p>
        <div className="fila">
          <Campo label="Área"><select name="area" defaultValue=""><option value="">La de antes</option>{d.areas.filter((a) => a.activa).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
          <Campo label="Lugar"><input type="text" name="ubicacion" placeholder="El de antes" /></Campo>
        </div>
      </>}
    </Ventana>
  );
}

export function Movimientos() {
  const d = useDatos(), s = useSesion(), tema = useTema();
  const p = s.usuario!.perfil;
  const [ver, setVer] = useState<"tramite" | "todos">("tramite");
  const enTramite = d.movimientos_equipo.filter((m) => ["solicitado", "aprobado", "en_curso"].includes(m.estado));
  const l = ver === "tramite" ? enTramite : d.movimientos_equipo;
  const TIPOS: Record<Movimiento["tipo"], string> = { prestamo: tema.t("prestamo"), reparacion_externa: tema.t("reparacion_externa"), reubicacion: "Reubicación", baja: "Baja" };
  return (
    <>
      <div className="encabezado"><div><h1>{tema.t("movimientos")}</h1>
        <p>Préstamos entre empresas, reparaciones externas, reubicaciones y bajas. Se inician desde la ficha de cada equipo (botón «{tema.t("movimientos")}»).</p></div></div>
      <div className="pestanas" role="tablist">
        <button role="tab" aria-selected={ver === "tramite"} className={ver === "tramite" ? "activa" : ""} onClick={() => setVer("tramite")}>En trámite ({enTramite.length})</button>
        <button role="tab" aria-selected={ver === "todos"} className={ver === "todos" ? "activa" : ""} onClick={() => setVer("todos")}>Historial</button>
      </div>
      <section className="panel">{l.length ? (
        <div className="tabla"><table><thead><tr><th>Fecha</th><th>Equipo</th><th>Movimiento</th><th>Detalle</th><th>Estado</th><th></th></tr></thead><tbody>
          {l.map((m) => {
            const e = d.equipo(m.equipo_id), ori = d.empresa(m.empresa_origen_id), des = d.empresa(m.empresa_destino_id);
            const adj = d.adjuntos.filter((a) => a.tabla === "movimientos_equipo" && a.registro_id === m.id);
            const [t, c] = ESTADOS_MOV[m.estado];
            return (
              <tr key={m.id}>
                <td className="num">{fd(m.creado_en)}<div className="chico suave">{d.usuarioDe(m.creado_por)?.nombre}</div></td>
                <td>{e && <Link to={"/equipos/" + e.id}><Codigo>{e.codigo}</Codigo></Link>}<div className="chico">{e?.nombre}</div></td>
                <td><b>{TIPOS[m.tipo]}</b>
                  {m.tipo === "prestamo" && <div className="chico">{ori && <Emp sigla={ori.sigla} nombre={ori.sigla} />} → {des && <Emp sigla={des.sigla} nombre={des.nombre} />}</div>}
                  {m.tipo === "reparacion_externa" && <div className="chico">{d.proveedores.find((x) => x.id === m.proveedor_id)?.nombre}</div>}
                  {m.tipo === "baja" && <div className="chico">{d.item("destino_baja", m.destino_baja)?.nombre}</div>}
                  {m.tipo === "reubicacion" && <div className="chico">{[d.areas.find((a) => a.id === m.area_destino_id)?.nombre, m.ubicacion_destino].filter(Boolean).join(" · ")}</div>}</td>
                <td className="chico">{m.motivo}
                  {(m.fecha_salida || m.fecha_vuelta_prevista || m.fecha_vuelta) && <div className="suave">{[m.fecha_salida && "Salió " + fd(m.fecha_salida), m.fecha_vuelta_prevista && !m.fecha_vuelta && "Vuelve " + fd(m.fecha_vuelta_prevista), m.fecha_vuelta && "Volvió " + fd(m.fecha_vuelta)].filter(Boolean).join(" · ")}</div>}
                  {(m.presupuesto != null || m.remito || m.garantia_hasta) && <div className="suave">{[m.presupuesto != null && pesos(Number(m.presupuesto)), m.remito && "Remito " + m.remito, m.garantia_hasta && "Garantía hasta " + fd(m.garantia_hasta)].filter(Boolean).join(" · ")}</div>}
                  {m.respuesta && <div>«{m.respuesta}» — {d.usuarioDe(m.resuelto_por)?.nombre}</div>}
                  {adj.length > 0 && <div style={{ marginTop: 4 }}><Medios adjuntos={adj} alt="Movimiento" /></div>}</td>
                <td><Pastilla c={c}>{t}</Pastilla>{atrasado(m) && <div><Pastilla c="critico">Vuelta atrasada</Pastilla></div>}</td>
                <td><div className="botones" style={{ flexWrap: "nowrap" }}>
                  {p === "jefe" && m.estado === "solicitado" && <><button className="boton chico pri" onClick={() => abrir(<Resolver m={m} aprobar />)}>Aprobar</button><button className="boton chico" onClick={() => abrir(<Resolver m={m} aprobar={false} />)}>Rechazar</button></>}
                  {p === "jefe" && m.tipo === "prestamo" && m.estado === "aprobado" && <button className="boton chico pri" onClick={() => abrir(<Salida m={m} />)}>Salió</button>}
                  {p === "jefe" && m.estado === "en_curso" && <button className="boton chico pri" onClick={() => abrir(<Vuelta m={m} />)}>Volvió</button>}
                  {p === "jefe" && m.tipo === "prestamo" && ["solicitado", "aprobado"].includes(m.estado) && <button className="boton chico" onClick={() => abrir(<Cancelar m={m} />)}>Cancelar</button>}
                </div></td>
              </tr>);
          })}
        </tbody></table></div>
      ) : <p className="vacio">{ver === "tramite" ? "No hay movimientos en trámite." : "Todavía no hay movimientos."}</p>}</section>
    </>
  );
}
