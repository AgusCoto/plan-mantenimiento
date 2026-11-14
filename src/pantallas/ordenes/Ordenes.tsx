// Listado de órdenes de trabajo con filtros, y alta de una orden (desde un reporte o desde un equipo).
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { insertar } from "../../datos/cola";
import { Campo, Codigo, Emp, avisar } from "../../comun/ui";
import { fd, hace } from "../../comun/formato";
import { Ico } from "../../sistema/iconos";
import { ACTIVAS, EstadoOT, PrioridadOT, PRIORIDADES, NOMBRE_PRIORIDAD, num4, prioridadDe, rangoPrioridad, tecnicosPara, vencida } from "./comun";
import { TarjetaReporte } from "./Reportes";
import type { Orden } from "../../datos/tipos";

export function Ordenes() {
  const d = useDatos(), s = useSesion(), tema = useTema(), nav = useNavigate();
  const u = s.usuario!;
  const gestiona = ["jefe", "encargado"].includes(u.perfil);
  const [q, setQ] = useState("");
  const [est, setEst] = useState("activas");
  const [pri, setPri] = useState("");
  const [emp, setEmp] = useState("");
  const [mias, setMias] = useState(u.perfil === "tecnico");
  const l = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return d.ordenes.filter((o) => {
      const e = d.equipo(o.equipo_id);
      return (est === "activas" ? ACTIVAS.includes(o.estado) : est === "por_cerrar" ? ["terminada", "verificada"].includes(o.estado) : !est || o.estado === est)
        && (!pri || o.prioridad === pri) && (!emp || o.empresa_cargo_id === emp || e?.empresa_ubicacion_id === emp) && (!mias || o.asignado_a === u.id)
        && (!ql || [num4(o.numero), o.titulo, e?.codigo, e?.nombre].join(" ").toLowerCase().includes(ql));
    }).sort((a, b) => est === "activas" ? rangoPrioridad(a.prioridad) - rangoPrioridad(b.prioridad) || a.numero - b.numero : b.numero - a.numero);
  }, [d, q, est, pri, emp, mias, u.id]);
  const ot = (o: Orden) => `${tema.t("orden_abrev")}-${num4(o.numero)}`;
  return (
    <>
      <div className="encabezado"><div><h1>{tema.t("ordenes")}</h1><p>Ordenadas por prioridad: la calcula la criticidad del equipo y si está parado; dirección la confirma o la cambia.</p></div><span className="sp" />
        {gestiona && <Link className="boton pri" to="/ordenes/nueva"><Ico n="mas" />Nueva {tema.t("orden_abrev")}</Link>}</div>
      <div className="filtros">
        <input type="search" placeholder="Buscar por número, título o equipo" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} aria-label="Buscar" />
        <select value={est} onChange={(e) => setEst(e.target.value)} aria-label="Estado">
          <option value="activas">Pendientes</option><option value="por_cerrar">Terminadas, por cerrar</option><option value="">Todas</option>
          {d.listas.filter((x) => x.lista === "estado_orden").map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}
        </select>
        <select value={pri} onChange={(e) => setPri(e.target.value)} aria-label="Prioridad"><option value="">Toda prioridad</option>{PRIORIDADES.map((p) => <option key={p} value={p}>{NOMBRE_PRIORIDAD[p]}</option>)}</select>
        <select value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Empresa"><option value="">Todas las empresas</option>{d.empresas.map((e) => <option key={e.id} value={e.id}>{e.sigla} · {e.nombre}</option>)}</select>
        {u.perfil !== "direccion" && <label className="opciones"><input type="checkbox" checked={mias} onChange={(e) => setMias(e.target.checked)} /><span>Solo las mías</span></label>}
      </div>
      <section className="panel">{l.length ? (
        <div className="tabla"><table><thead><tr><th>N.º</th><th>Equipo</th><th>Trabajo</th><th>Prioridad</th><th>Estado</th><th>Asignada a</th><th>Vence</th></tr></thead><tbody>
          {l.map((o) => { const e = d.equipo(o.equipo_id); const emp = d.empresa(o.empresa_cargo_id); return (
            <tr key={o.id} className="clic" onClick={() => nav("/ordenes/" + o.id)}>
              <td className="num"><Link to={"/ordenes/" + o.id} onClick={(x) => x.stopPropagation()}>{ot(o)}</Link><div className="chico suave">{hace(o.creado_en)}</div></td>
              <td><Codigo>{e?.codigo}</Codigo><div className="chico">{emp && <Emp sigla={emp.sigla} nombre={emp.nombre} />}</div></td>
              <td>{o.titulo}{o.parada && <div className="chico" style={{ color: "var(--critico)" }}>Máquina parada</div>}</td>
              <td><PrioridadOT p={o.prioridad} /></td>
              <td><EstadoOT o={o} /></td>
              <td>{d.usuarioDe(o.asignado_a)?.nombre || d.proveedores.find((p) => p.id === o.contratista_id)?.nombre || <span className="suave">Sin asignar</span>}</td>
              <td className="num" style={vencida(o) ? { color: "var(--critico)", fontWeight: 700 } : undefined}>{o.vence ? fd(o.vence) : ""}</td>
            </tr>); })}
        </tbody></table></div>
      ) : <p className="vacio">No hay {tema.t("ordenes").toLowerCase()} con este filtro.</p>}</section>
    </>
  );
}

export function NuevaOrden() {
  const [qs] = useSearchParams();
  const d = useDatos(), tema = useTema(), nav = useNavigate();
  const r = d.reportes_falla.find((x) => x.id === qs.get("reporte"));
  const [equipoId, setEquipoId] = useState(r?.equipo_id || qs.get("equipo") || "");
  const [parada, setParada] = useState(r?.parada ?? d.equipo(qs.get("equipo"))?.estado === "detenido");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const e = d.equipo(equipoId);
  const tecnicos = tecnicosPara(d, e);
  if (r && r.estado !== "nuevo") return <><h1>Nueva {tema.t("orden_abrev")}</h1><p className="nota">Ese reporte ya fue atendido.</p><Link to="/reportes">Volver a los reportes</Link></>;

  async function guardar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget), v = (k: string) => String(f.get(k) || "").trim();
    setOcupado(true); setError(null);
    try {
      const id = crypto.randomUUID();
      await insertar("ordenes", {
        id, equipo_id: equipoId, reporte_id: r?.id || null, titulo: v("titulo"), descripcion: v("descripcion") || null, tipo: v("tipo") || "correctiva",
        parada: r ? r.parada : parada, asignado_a: v("asignado") || null, contratista_id: v("contratista") || null, vence: v("vence") || null,
      });
      await d.recargar("ordenes", "reportes_falla", "equipos");
      avisar(`${tema.t("orden")} creada`); nav("/ordenes/" + id, { replace: true });
    } catch (x) { setError((x as { msg?: string }).msg || "No se pudo crear."); setOcupado(false); }
  }
  const pri = e ? prioridadDe(e.criticidad, r ? r.parada : parada) : null;
  return (
    <>
      <div className="encabezado"><div><Link to={r ? "/reportes" : "/ordenes"} className="chico">← {r ? tema.t("reportes") : tema.t("ordenes")}</Link><h1>Nueva {tema.t("orden").toLowerCase()}</h1></div></div>
      {r && <TarjetaReporte r={r} acciones={false} />}
      <form className="form panel" onSubmit={guardar}>
        <Campo label={tema.t("equipo") + " *"}>
          <select required value={equipoId} disabled={!!r} onChange={(x) => setEquipoId(x.target.value)}>
            <option value="">Elegí…</option>{d.equipos.filter((x) => x.estado !== "baja").map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
          </select></Campo>
        <Campo label="Título *"><input type="text" name="titulo" required minLength={2} maxLength={200} defaultValue={r ? `${d.item("tipo_falla", r.tipo_falla)?.nombre || ""}${r.texto ? ": " + r.texto.slice(0, 120) : ""}` : ""} placeholder="Ej.: Cambiar rodamiento del motor" /></Campo>
        <Campo label="Descripción"><textarea name="descripcion" defaultValue={r?.texto || ""} /></Campo>
        <div className="fila">
          <Campo label="Tipo"><select name="tipo" defaultValue="correctiva"><option value="correctiva">Correctiva</option><option value="preventiva">Preventiva</option><option value="mejora">Mejora</option></select></Campo>
          <Campo label="Vence"><input type="date" name="vence" /></Campo>
        </div>
        {!r && <label className="opciones"><input type="checkbox" checked={parada} onChange={(x) => setParada(x.target.checked)} /><span>La máquina está parada</span></label>}
        <div className="fila">
          <Campo label="Asignar a" ayuda={e ? "Técnicos y encargados con acceso a la empresa del equipo" : undefined}><select name="asignado" defaultValue=""><option value="">Sin asignar todavía</option>{tecnicos.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {tema.t(u.perfil)}</option>)}</select></Campo>
          <Campo label={"…o a un " + tema.t("contratista").toLowerCase()}><select name="contratista" defaultValue=""><option value="">Ninguno</option>{d.proveedores.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
        </div>
        {e && pri && <p className="chico">Prioridad calculada: <PrioridadOT p={pri} /> (criticidad {e.criticidad}{(r ? r.parada : parada) ? ", máquina parada" : ""}). Dirección la puede confirmar o cambiar.{e.criticidad === "alta" && " Equipo crítico: el cierre lo firma el supervisor de producción."}</p>}
        {error && <p className="nota critico" role="alert">{error}</p>}
        <div className="botones"><button className="boton pri grande" type="submit" disabled={ocupado || !equipoId}>{ocupado ? "Creando…" : "Crear " + tema.t("orden_abrev")}</button></div>
      </form>
    </>
  );
}
