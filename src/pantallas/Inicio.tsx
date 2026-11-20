// Pantalla de inicio por perfil: tarjetas que se pueden reordenar, mostrar u ocultar.
// El jefe define la versión por defecto de cada perfil (Apariencia) y cada usuario puede ordenar la suya.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useDatos } from "../datos/store";
import { useSesion } from "../datos/sesion";
import { useTema } from "../sistema/tema";
import { sb } from "../datos/supabase";
import { Ventana, abrir, avisar, Codigo, Pastilla } from "../comun/ui";
import { guardarPreferencias } from "./MiCuenta";
import { hace } from "../comun/formato";
import type { Perfil } from "../sistema/tokens";
import { InicioOperario } from "./operario/InicioOperario";
import { ListaPrev, TarjetasPrev, useResumenPrev } from "./preventivos/Preventivos";

export interface Tarjeta { id: string; titulo: string; perfiles: Perfil[]; Vista: () => JSX.Element }
export type Orden = { id: string; visible: boolean }[];

const ESTADO_EQ: Record<string, [string, "ok" | "alerta" | "critico" | ""]> = {
  operativo: ["Operativo", "ok"], detenido: ["Detenido", "critico"], en_reparacion: ["En reparación", "alerta"], reparacion_externa: ["Reparación externa", "alerta"], baja: ["De baja", ""],
};
export const estadoEquipo = (e: string) => ESTADO_EQ[e] || [e, ""];

function Parados() {
  const d = useDatos();
  const l = d.equipos.filter((e) => e.estado === "detenido" || e.estado === "en_reparacion" || e.estado === "reparacion_externa");
  if (!l.length) return <p className="vacio">Todos los equipos están operativos.</p>;
  return <div className="lista">{l.map((e) => { const [t, c] = estadoEquipo(e.estado); return (
    <Link key={e.id} className="item" to={"/equipos/" + e.id}><div className="cuerpo-item"><div className="t">{e.nombre}</div><div className="meta"><Codigo>{e.codigo}</Codigo>{d.empresa(e.empresa_ubicacion_id)?.nombre}</div></div><Pastilla c={c}>{t}</Pastilla></Link>); })}</div>;
}
function ReportesNuevos() {
  const d = useDatos(), tema = useTema();
  const l = d.reportes_falla.filter((r) => r.estado === "nuevo");
  if (!l.length) return <p className="vacio">No hay {tema.t("reportes").toLowerCase()} nuevos.</p>;
  return <div className="lista">{l.slice(0, 6).map((r) => { const e = d.equipo(r.equipo_id); return (
    <Link key={r.id} className="item" to={"/reportes"}><div className="cuerpo-item"><div className="t">{d.item("tipo_falla", r.tipo_falla)?.nombre || r.tipo_falla} · {e?.nombre}</div>
      <div className="meta"><Codigo>{e?.codigo}</Codigo><span>{d.usuarioDe(r.operario_id)?.nombre}</span><span>{hace(r.hecho_en)}</span></div></div>
      {r.parada && <Pastilla c="critico">Máquina parada</Pastilla>}</Link>); })}</div>;
}
function Pendientes() {
  const d = useDatos(), tema = useTema();
  const abiertas = d.ordenes.filter((o) => !["cerrada", "anulada", "terminada", "verificada"].includes(o.estado));
  const k = (v: number, t: string, a: string, c = "") => <Link className={"kpi " + c} to={a}><span className="v">{v}</span><span className="k">{t}</span></Link>;
  return (
    <div className="kpis">
      {k(abiertas.length, tema.t("ordenes") + " abiertas", "/ordenes", abiertas.some((o) => o.prioridad === "urgente") ? "critico" : "")}
      {k(abiertas.filter((o) => o.estado === "esperando_repuesto").length, "Esperando repuesto", "/ordenes", "alerta")}
      {k(d.reportes_falla.filter((r) => r.estado === "nuevo").length, tema.t("reportes") + " nuevos", "/reportes")}
      {k(d.pedidos_compra.filter((p) => p.estado === "pendiente").length, "Compras por aprobar", "/compras")}
      {k(d.movimientos_equipo.filter((m) => m.estado === "solicitado").length, "Préstamos por aprobar", "/movimientos")}
    </div>
  );
}
function MisOrdenes() {
  const d = useDatos(), s = useSesion(), tema = useTema();
  const l = d.ordenes.filter((o) => o.asignado_a === s.usuario?.id && !["cerrada", "anulada", "terminada", "verificada"].includes(o.estado));
  if (!l.length) return <p className="vacio">No tenés {tema.t("ordenes").toLowerCase()} asignadas.</p>;
  return <div className="lista">{l.map((o) => (
    <Link key={o.id} className="item" to={"/ordenes/" + o.id}><div className="cuerpo-item"><div className="t">{tema.t("orden_abrev")}-{String(o.numero).padStart(4, "0")} · {o.titulo}</div>
      <div className="meta"><Codigo>{d.equipo(o.equipo_id)?.codigo}</Codigo><span>{d.item("estado_orden", o.estado)?.nombre}</span></div></div>
      <Pastilla c={o.prioridad === "urgente" ? "critico" : o.prioridad === "alta" ? "alerta" : ""}>{o.prioridad}</Pastilla></Link>))}</div>;
}
function Aprobaciones() {
  const d = useDatos();
  const c = d.pedidos_compra.filter((p) => p.estado === "pendiente"), m = d.movimientos_equipo.filter((x) => x.estado === "solicitado");
  if (!c.length && !m.length) return <p className="vacio">No hay nada para aprobar.</p>;
  return <div className="lista">
    {c.map((p) => <Link key={p.id} className="item" to="/compras"><div className="cuerpo-item"><div className="t">Compra PC-{String(p.numero).padStart(4, "0")}: {p.descripcion}</div><div className="meta">{d.empresa(p.empresa_id)?.nombre}</div></div><Pastilla c="alerta">Por aprobar</Pastilla></Link>)}
    {m.map((x) => <Link key={x.id} className="item" to="/movimientos"><div className="cuerpo-item"><div className="t">Préstamo de {d.equipo(x.equipo_id)?.codigo} a {d.empresa(x.empresa_destino_id)?.nombre}</div><div className="meta">{x.motivo}</div></div><Pastilla c="alerta">Por aprobar</Pastilla></Link>)}
  </div>;
}
const Proximamente = ({ txt }: { txt: string }) => () => <p className="vacio">{txt}</p>;
function PreventivosInicio() {
  const { l, cuenta } = useResumenPrev();
  const urgentes = l.filter((x) => x.estado === "vencida" || x.estado === "proxima");
  return <><TarjetasPrev cuenta={cuenta} />
    <div style={{ marginTop: "var(--e3)" }}>{urgentes.length ? <ListaPrev items={urgentes.slice(0, 6)} /> : <p className="vacio">{l.length ? "No hay tareas vencidas ni próximas." : "Todavía no hay tareas en el plan de preventivos."}</p>}</div>
    <Link to="/preventivos" className="chico">Ver todo el plan →</Link></>;
}

export const TARJETAS: Tarjeta[] = [
  { id: "pendientes", titulo: "Pendientes", perfiles: ["jefe", "encargado", "direccion"], Vista: Pendientes },
  { id: "mis_ordenes", titulo: "Mis órdenes", perfiles: ["tecnico", "encargado", "jefe"], Vista: MisOrdenes },
  { id: "reportes_nuevos", titulo: "Reportes nuevos", perfiles: ["jefe", "encargado", "tecnico", "direccion"], Vista: ReportesNuevos },
  { id: "equipos_parados", titulo: "Equipos parados o en reparación", perfiles: ["jefe", "encargado", "tecnico", "direccion"], Vista: Parados },
  { id: "aprobaciones", titulo: "Para aprobar", perfiles: ["direccion", "jefe"], Vista: Aprobaciones },
  { id: "preventivos", titulo: "Preventivos, lo más urgente primero", perfiles: ["jefe", "encargado", "tecnico", "direccion"], Vista: PreventivosInicio },
  { id: "prestamos_herramientas", titulo: "Préstamos de herramientas", perfiles: ["jefe"], Vista: Proximamente({ txt: "Se suma en la etapa 2 (pañol)." }) },
];
/** Orden de fábrica para cada perfil */
export const tarjetasDe = (p: Perfil): Orden => TARJETAS.filter((t) => t.perfiles.includes(p)).map((t) => ({ id: t.id, visible: !["prestamos_herramientas"].includes(t.id) }));
/** Combina: preferencia del usuario > valor del jefe para el perfil > fábrica (y suma tarjetas nuevas al final) */
export function combinarOrden(p: Perfil, delJefe: Orden | undefined, propio: Orden | null | undefined): Orden {
  const base = (propio && propio.length ? propio : delJefe && delJefe.length ? delJefe : tarjetasDe(p)).filter((x) => TARJETAS.some((t) => t.id === x.id && t.perfiles.includes(p)));
  for (const t of tarjetasDe(p)) if (!base.some((b) => b.id === t.id)) base.push({ id: t.id, visible: false });
  return base;
}

export function EditorOrden({ orden, onChange }: { orden: Orden; onChange: (o: Orden) => void }) {
  const mover = (i: number, d: number) => { const n = [...orden]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <div className="lista">
      {orden.map((o, i) => (
        <div key={o.id} className="item" style={{ alignItems: "center" }}>
          <label style={{ display: "flex", gap: "var(--e2)", alignItems: "center", flex: 1, minHeight: 40 }}>
            <input type="checkbox" checked={o.visible} onChange={(e) => onChange(orden.map((x) => (x.id === o.id ? { ...x, visible: e.target.checked } : x)))} />
            {TARJETAS.find((t) => t.id === o.id)?.titulo}
          </label>
          <button type="button" className="boton chico" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">↑</button>
          <button type="button" className="boton chico" disabled={i === orden.length - 1} onClick={() => mover(i, 1)} aria-label="Bajar">↓</button>
        </div>
      ))}
    </div>
  );
}

function Personalizar({ inicial, perfil, alGuardar }: { inicial: Orden; perfil: Perfil; alGuardar: (o: Orden | null) => void }) {
  const s = useSesion();
  const [o, setO] = useState(inicial);
  return (
    <Ventana titulo="Ordenar mi inicio" onSubmit={async () => { await guardarPreferencias(s.usuario!.id, { inicio: o }); alGuardar(o); avisar("Inicio guardado"); }}>
      <p className="suave chico">Elegí qué tarjetas ver y en qué orden. Solo cambia tu inicio.</p>
      <EditorOrden orden={o} onChange={setO} />
      <button type="button" className="boton chico" style={{ alignSelf: "start" }} onClick={async () => { await guardarPreferencias(s.usuario!.id, { inicio: null }); alGuardar(null); setO(combinarOrden(perfil, undefined, null)); avisar("Volviste al inicio del perfil"); }}>Volver al inicio de mi perfil</button>
    </Ventana>
  );
}

export function Inicio() {
  const d = useDatos(), s = useSesion(), tema = useTema();
  const u = s.usuario!;
  const [propio, setPropio] = useState<Orden | null>(null);
  useEffect(() => { sb().from("preferencias_usuario").select("inicio").eq("usuario_id", u.id).maybeSingle().then(({ data }) => setPropio((data?.inicio as Orden) || null)); }, [u.id]);
  if (u.perfil === "operario") return <InicioOperario />;
  const delJefe = d.conf<Record<string, Orden>>("inicio_por_perfil", {})[u.perfil];
  const orden = combinarOrden(u.perfil, delJefe, propio);
  const hora = new Date().getHours();
  return (
    <>
      <div className="encabezado"><div><h1>{hora < 13 ? "Buen día" : hora < 20 ? "Buenas tardes" : "Buenas noches"}, {u.nombre.split(" ")[0]}</h1><p>{tema.t(u.perfil)}</p></div><span className="sp" />
        <button className="boton chico" onClick={() => abrir(<Personalizar inicial={orden} perfil={u.perfil} alGuardar={setPropio} />)}>Ordenar mi inicio</button></div>
      <div className="grilla g2">
        {orden.filter((o) => o.visible).map((o) => { const t = TARJETAS.find((x) => x.id === o.id)!; return <Seccion key={o.id} titulo={t.titulo}><t.Vista /></Seccion>; })}
      </div>
    </>
  );
}
const Seccion = ({ titulo, children }: { titulo: string; children: ReactNode }) => <section className="panel"><h2>{titulo}</h2>{children}</section>;
