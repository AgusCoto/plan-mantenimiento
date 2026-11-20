// Consultas e informes (como en W-Main): buscar fallas anteriores, historial de intervenciones,
// informe mensual, resumen para dirección, manuales y «¿Dónde está cada cosa?».
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useDatos } from "../datos/store";
import { useSesion } from "../datos/sesion";
import { useTema } from "../sistema/tema";
import { Codigo, Emp, Pastilla, abrir, descargar } from "../comun/ui";
import { fd, fdt, hoy, nf, pesos } from "../comun/formato";
import { xlsx } from "../comun/exportar";
import { Ico } from "../sistema/iconos";
import { ACTIVAS, EstadoOT, PrioridadOT, costoOrden, num4, rangoPrioridad, vencida } from "./ordenes/comun";
import { estadoEquipo } from "./Inicio";
import { AbrirDoc, CATEGORIAS, NuevoDocumento } from "./equipos/Ficha";
import { useResumenPrev } from "./preventivos/Preventivos";
import type { Equipo, Ficha, Orden } from "../datos/tipos";

type D = ReturnType<typeof useDatos>;
const enEmpresa = (e: Equipo | undefined, emp: string) => !emp || e?.empresa_duena_id === emp || e?.empresa_ubicacion_id === emp;
function FiltroEmpresa({ emp, setEmp }: { emp: string; setEmp: (v: string) => void }) {
  const d = useDatos();
  return <select value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Empresa"><option value="">Todas las empresas</option>{d.empresas.map((e) => <option key={e.id} value={e.id}>{e.sigla} · {e.nombre}</option>)}</select>;
}
const Imprimir = () => <button className="boton" onClick={() => window.print()}><Ico n="descargar" />Imprimir o guardar en PDF</button>;
const quienFicha = (d: D, f: Ficha) => d.usuarioDe(f.tecnico_id)?.nombre || d.proveedores.find((p) => p.id === f.contratista_id)?.nombre || "—";

/* ---------- Buscar fallas anteriores ---------- */
export function BuscarFallas() {
  const d = useDatos(), tema = useTema();
  const [q, setQ] = useState(""); const [emp, setEmp] = useState(""); const [falla, setFalla] = useState(""); const [causa, setCausa] = useState("");
  // Cada caso: una orden correctiva (con su reporte, sus fichas y la causa) o un reporte que no llegó a orden
  const casos = useMemo(() => {
    const l: { id: string; fecha: string; e?: Equipo; falla?: string; texto: string; causa?: string | null; trabajo: string[]; parada: number; o?: Orden }[] = [];
    for (const o of d.ordenes.filter((x) => x.tipo !== "preventiva" && x.estado !== "anulada")) {
      const r = d.reportes_falla.find((x) => x.id === o.reporte_id), fs = d.fichas.filter((f) => f.orden_id === o.id);
      l.push({ id: "o" + o.id, fecha: r?.hecho_en || o.creado_en, e: d.equipo(o.equipo_id), falla: r?.tipo_falla, texto: [o.titulo, r?.texto, o.descripcion].filter(Boolean).join(" · "),
        causa: [...fs].reverse().find((f) => f.causa)?.causa, trabajo: fs.map((f) => `${fd(f.hecho_en)} ${quienFicha(d, f)}: ${f.trabajo}`), parada: fs.reduce((a, f) => a + Number(f.horas_parada), 0), o });
    }
    for (const r of d.reportes_falla.filter((x) => !x.orden_id))
      l.push({ id: "r" + r.id, fecha: r.hecho_en, e: d.equipo(r.equipo_id), falla: r.tipo_falla, texto: r.texto || "", trabajo: r.motivo_descarte ? ["Descartado: " + r.motivo_descarte] : [], parada: 0 });
    return l.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [d]);
  const ql = q.trim().toLowerCase();
  const l = casos.filter((c) => enEmpresa(c.e, emp) && (!falla || c.falla === falla) && (!causa || c.causa === causa)
    && (!ql || [c.e?.codigo, c.e?.nombre, c.texto, ...c.trabajo, d.item("tipo_falla", c.falla)?.nombre, d.item("causa", c.causa)?.nombre].join(" ").toLowerCase().includes(ql)));
  return (
    <>
      <div className="encabezado"><div><h1>Buscar fallas anteriores</h1><p>¿Ya pasó? Buscá por equipo, síntoma, repuesto o causa y mirá qué se hizo la otra vez.</p></div></div>
      <div className="filtros">
        <input type="search" autoFocus placeholder="Ej.: pérdida de aceite, rodamiento, INY-INY-001" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} aria-label="Buscar" />
        <FiltroEmpresa emp={emp} setEmp={setEmp} />
        <select value={falla} onChange={(e) => setFalla(e.target.value)} aria-label="Tipo de falla"><option value="">Toda falla</option>{d.listas.filter((x) => x.lista === "tipo_falla").map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}</select>
        <select value={causa} onChange={(e) => setCausa(e.target.value)} aria-label="Causa"><option value="">Toda causa</option>{d.listas.filter((x) => x.lista === "causa").map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}</select>
      </div>
      <p className="chico suave" style={{ margin: 0 }}>{l.length} {l.length === 1 ? "caso" : "casos"}</p>
      {l.length ? <div className="grilla g2">{l.slice(0, 100).map((c) => (
        <article key={c.id} className="panel" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <b>{d.item("tipo_falla", c.falla)?.nombre || (c.o ? ({ correctiva: "Correctiva", mejora: "Mejora", preventiva: "Preventiva" })[c.o.tipo] : "Falla")}</b>
            {c.causa && <Pastilla c="info">Causa: {d.item("causa", c.causa)?.nombre || c.causa}</Pastilla>}
            {c.parada > 0 && <Pastilla c="alerta">{nf.format(c.parada)} h parada</Pastilla>}
            <span style={{ flex: 1 }} /><span className="chico suave">{fd(c.fecha)}</span>
          </div>
          <div className="meta" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{c.e && <Link to={"/equipos/" + c.e.id}><Codigo>{c.e.codigo}</Codigo></Link>}<span>{c.e?.nombre}</span></div>
          {c.texto && <div>{c.texto}</div>}
          {c.trabajo.length ? <ul className="chico" style={{ margin: 0, paddingLeft: 18 }}>{c.trabajo.map((t, i) => <li key={i}>{t}</li>)}</ul> : <div className="chico suave">Sin trabajos cargados.</div>}
          {c.o && <Link className="chico" to={"/ordenes/" + c.o.id}>{tema.t("orden_abrev")}-{num4(c.o.numero)} · {d.item("estado_orden", c.o.estado)?.nombre}</Link>}
        </article>))}</div> : <p className="vacio">{casos.length ? "No hay fallas que coincidan." : "Todavía no hay fallas registradas."}</p>}
    </>
  );
}

/* ---------- Historial de intervenciones ---------- */
export function HistorialIntervenciones() {
  const d = useDatos(), tema = useTema();
  const [q, setQ] = useState(""); const [emp, setEmp] = useState(""); const [quien, setQuien] = useState(""); const [tipo, setTipo] = useState("");
  const [desde, setDesde] = useState(""); const [hasta, setHasta] = useState("");
  const l = d.fichas.map((f) => ({ f, o: d.ordenes.find((o) => o.id === f.orden_id) })).map((x) => ({ ...x, e: d.equipo(x.o?.equipo_id) }))
    .filter(({ f, o, e }) => {
      const ql = q.trim().toLowerCase(), dia = f.hecho_en.slice(0, 10);
      return enEmpresa(e, emp) && (!tipo || (tipo === "externa" ? !!f.contratista_id : o?.tipo === tipo)) && (!quien || f.tecnico_id === quien || f.contratista_id === quien)
        && (!desde || dia >= desde) && (!hasta || dia <= hasta) && (!ql || [e?.codigo, e?.nombre, o?.titulo, f.trabajo].join(" ").toLowerCase().includes(ql));
    }).sort((a, b) => b.f.hecho_en.localeCompare(a.f.hecho_en));
  const horas = l.reduce((a, x) => a + Number(x.f.horas), 0), parada = l.reduce((a, x) => a + Number(x.f.horas_parada), 0);
  const personas = [...d.usuarios.filter((u) => d.fichas.some((f) => f.tecnico_id === u.id)).map((u) => [u.id, u.nombre]), ...d.proveedores.filter((p) => d.fichas.some((f) => f.contratista_id === p.id)).map((p) => [p.id, p.nombre + " (externo)"])];
  function excel() {
    const cols = ["Fecha", "Equipo", "Nombre del equipo", "Orden", "Tipo", "Quién", "Trabajo", "Horas", "Horas de parada", "Causa", "Cierre", "Remito"];
    descargar(`historial-intervenciones-${hoy()}.xlsx`, xlsx([{ nombre: "Intervenciones", cols, filas: l.map(({ f, o, e }) => [fdt(f.hecho_en), e?.codigo || "", e?.nombre || "",
      o ? tema.t("orden_abrev") + "-" + num4(o.numero) : "", o?.tipo || "", quienFicha(d, f) + (f.contratista_id ? " (externo)" : ""), f.trabajo, Number(f.horas), Number(f.horas_parada),
      d.item("causa", f.causa)?.nombre || "", f.es_cierre ? "Sí" : "", f.remito || ""]) }]));
  }
  return (
    <>
      <div className="encabezado"><div><h1>Historial de intervenciones</h1><p>Todo el trabajo cargado en las fichas: quién, cuándo, en qué equipo y cuántas horas.</p></div><span className="sp" />
        <button className="boton" onClick={excel} disabled={!l.length}><Ico n="descargar" />Excel</button></div>
      <div className="filtros">
        <input type="search" placeholder="Buscar equipo, orden o trabajo" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Buscar" />
        <FiltroEmpresa emp={emp} setEmp={setEmp} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo"><option value="">Todo tipo</option><option value="correctiva">Correctivas</option><option value="preventiva">Preventivas</option><option value="mejora">Mejoras</option><option value="externa">Solo externos</option></select>
        <select value={quien} onChange={(e) => setQuien(e.target.value)} aria-label="Quién"><option value="">Todas las personas</option>{personas.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <label className="chico" style={{ display: "flex", gap: 4, alignItems: "center" }}>Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="chico" style={{ display: "flex", gap: 4, alignItems: "center" }}>Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      <p className="chico suave" style={{ margin: 0 }}>{l.length} intervenciones · {nf.format(horas)} h de trabajo · {nf.format(parada)} h de máquina parada</p>
      <section className="panel">{l.length ? <div className="tabla"><table><thead><tr><th>Fecha</th><th>Equipo</th><th>Orden</th><th>Quién</th><th>Trabajo</th><th className="n">Horas</th></tr></thead><tbody>
        {l.slice(0, 500).map(({ f, o, e }) => (
          <tr key={f.id}><td className="num">{fdt(f.hecho_en)}</td><td>{e && <Link to={"/equipos/" + e.id}><Codigo>{e.codigo}</Codigo></Link>}<div className="chico">{e?.nombre}</div></td>
            <td>{o && <Link to={"/ordenes/" + o.id}>{tema.t("orden_abrev")}-{num4(o.numero)}</Link>}<div className="chico suave">{o?.tipo}</div></td>
            <td>{quienFicha(d, f)}{f.contratista_id && <div><Pastilla c="info">Externo</Pastilla></div>}</td>
            <td className="chico">{f.trabajo}{f.es_cierre && <> <Pastilla c="ok">Cierre</Pastilla></>}{f.causa && <div className="suave">Causa: {d.item("causa", f.causa)?.nombre}</div>}</td>
            <td className="n">{nf.format(Number(f.horas))}{Number(f.horas_parada) > 0 && <div className="chico suave">{nf.format(Number(f.horas_parada))} parada</div>}</td></tr>))}
      </tbody></table></div> : <p className="vacio">No hay intervenciones con este filtro.</p>}</section>
    </>
  );
}

/* ---------- Informe mensual ---------- */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function Kpi({ v, k, c = "" }: { v: ReactNode; k: string; c?: string }) { return <div className={"kpi " + c}><span className="v">{v}</span><span className="k">{k}</span></div>; }
export function InformeMensual() {
  const d = useDatos();
  const [mes, setMes] = useState(hoy().slice(0, 7)); const [emp, setEmp] = useState("");
  const enMes = (s: string | null | undefined) => !!s && s.slice(0, 7) === mes;
  const deEmp = (equipoId: string | null | undefined) => enEmpresa(d.equipo(equipoId), emp);
  const ordenes = d.ordenes.filter((o) => deEmp(o.equipo_id) && o.estado !== "anulada");
  const creadas = ordenes.filter((o) => enMes(o.creado_en)), terminadas = ordenes.filter((o) => enMes(o.terminada_en));
  const fichas = d.fichas.filter((f) => enMes(f.hecho_en) && deEmp(d.ordenes.find((o) => o.id === f.orden_id)?.equipo_id));
  const reportes = d.reportes_falla.filter((r) => enMes(r.hecho_en) && deEmp(r.equipo_id));
  const horas = fichas.filter((f) => f.tecnico_id).reduce((a, f) => a + Number(f.horas), 0), parada = fichas.reduce((a, f) => a + Number(f.horas_parada), 0);
  const vh = Number(d.conf("valor_hora_tecnico", 0)) || 0;
  // Costos: lo cargado en las órdenes terminadas en el mes y las reparaciones externas que volvieron en el mes
  const costosPorEmpresa = new Map<string, number>();
  for (const o of terminadas) costosPorEmpresa.set(o.empresa_cargo_id, (costosPorEmpresa.get(o.empresa_cargo_id) || 0) + costoOrden(d, o.id).total);
  for (const m of d.movimientos_equipo.filter((x) => x.tipo === "reparacion_externa" && enMes(x.fecha_vuelta) && deEmp(x.equipo_id))) {
    const e = d.equipo(m.equipo_id); if (e) costosPorEmpresa.set(e.empresa_duena_id, (costosPorEmpresa.get(e.empresa_duena_id) || 0) + Number(m.presupuesto || 0));
  }
  const total = [...costosPorEmpresa.values()].reduce((a, b) => a + b, 0);
  const paradaPorEquipo = new Map<string, number>();
  fichas.forEach((f) => { const eq = d.ordenes.find((o) => o.id === f.orden_id)?.equipo_id; if (eq && Number(f.horas_parada)) paradaPorEquipo.set(eq, (paradaPorEquipo.get(eq) || 0) + Number(f.horas_parada)); });
  const porFalla = new Map<string, number>(); reportes.forEach((r) => porFalla.set(r.tipo_falla, (porFalla.get(r.tipo_falla) || 0) + 1));
  const porCausa = new Map<string, number>(); fichas.filter((f) => f.causa).forEach((f) => porCausa.set(f.causa!, (porCausa.get(f.causa!) || 0) + 1));
  const prevGeneradas = creadas.filter((o) => o.tipo === "preventiva"), prevHechas = prevGeneradas.filter((o) => o.terminada_en);
  const corr = terminadas.filter((o) => o.tipo === "correctiva");
  const mttr = corr.length ? corr.reduce((a, o) => a + (new Date(o.terminada_en!).getTime() - new Date(o.creado_en).getTime()) / 36e5, 0) / corr.length : null;
  const [a, m] = mes.split("-").map(Number);
  const top = (mapa: Map<string, number>, nombre: (k: string) => string, unidad = "") => [...mapa].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => <li key={k}>{nombre(k)}: <b>{nf.format(v)}{unidad}</b></li>);
  return (
    <div className="informe">
      <div className="encabezado"><div><h1>Informe mensual · {MESES[m - 1]} {a}</h1><p>{emp ? d.empresa(emp)?.nombre : "Todas las empresas"}. Generado el {fdt(new Date().toISOString())}.</p></div><span className="sp" /><Imprimir /></div>
      <div className="filtros no-imprimir"><input type="month" value={mes} max={hoy().slice(0, 7)} onChange={(e) => setMes(e.target.value || hoy().slice(0, 7))} aria-label="Mes" /><FiltroEmpresa emp={emp} setEmp={setEmp} /></div>
      <div className="kpis">
        <Kpi v={creadas.length} k="Órdenes abiertas en el mes" /><Kpi v={terminadas.length} k="Órdenes terminadas" c="ok" />
        <Kpi v={ordenes.filter((o) => ACTIVAS.includes(o.estado)).length} k="Pendientes hoy" c="alerta" /><Kpi v={reportes.length} k="Fallas reportadas" />
        <Kpi v={nf.format(horas) + " h"} k="Horas de trabajo" /><Kpi v={nf.format(parada) + " h"} k="Horas de máquina parada" c={parada ? "critico" : ""} />
        <Kpi v={mttr != null ? nf.format(mttr) + " h" : "—"} k="Tiempo medio de reparación" />
        <Kpi v={prevGeneradas.length ? Math.round((100 * prevHechas.length) / prevGeneradas.length) + " %" : "—"} k={`Preventivos cumplidos (${prevHechas.length} de ${prevGeneradas.length})`} />
      </div>
      <div className="grilla g2">
        <section className="panel"><h2>Gasto por empresa</h2>{costosPorEmpresa.size ? <div className="tabla"><table><tbody>
          {[...costosPorEmpresa].sort((x, y) => y[1] - x[1]).map(([k, v]) => { const e = d.empresa(k); return <tr key={k}><td>{e && <Emp sigla={e.sigla} nombre={e.nombre} />}</td><td className="n">{pesos(v)}</td></tr>; })}
          <tr><td><b>Total</b></td><td className="n"><b>{pesos(total)}</b></td></tr></tbody></table></div> : <p className="vacio">Sin gastos en el mes.</p>}
          <p className="chico suave">Mano de obra (horas × {pesos(vh)}), repuestos y servicios de las órdenes terminadas en el mes, y reparaciones externas que volvieron en el mes.</p></section>
        <section className="panel"><h2>Equipos con más horas de parada</h2>{paradaPorEquipo.size ? <ol>{top(paradaPorEquipo, (k) => `${d.equipo(k)?.codigo} · ${d.equipo(k)?.nombre}`, " h")}</ol> : <p className="vacio">Sin paradas cargadas.</p>}</section>
        <section className="panel"><h2>Fallas por tipo</h2>{porFalla.size ? <ul>{top(porFalla, (k) => d.item("tipo_falla", k)?.nombre || k)}</ul> : <p className="vacio">Sin fallas reportadas.</p>}</section>
        <section className="panel"><h2>Causas</h2>{porCausa.size ? <ul>{top(porCausa, (k) => d.item("causa", k)?.nombre || k)}</ul> : <p className="vacio">Sin causas cargadas.</p>}</section>
      </div>
      <section className="panel"><h2>Órdenes terminadas en el mes</h2>{terminadas.length ? <div className="tabla"><table><thead><tr><th>Orden</th><th>Equipo</th><th>Trabajo</th><th>Tipo</th><th className="n">Costo</th></tr></thead><tbody>
        {terminadas.map((o) => <tr key={o.id}><td><Link to={"/ordenes/" + o.id}>OT-{num4(o.numero)}</Link></td><td><Codigo>{d.equipo(o.equipo_id)?.codigo}</Codigo></td><td>{o.titulo}</td><td>{o.tipo}</td><td className="n">{pesos(costoOrden(d, o.id).total)}</td></tr>)}
      </tbody></table></div> : <p className="vacio">Ninguna.</p>}</section>
    </div>
  );
}

/* ---------- Resumen para Dirección ---------- */
export function ResumenDireccion() {
  const d = useDatos(), tema = useTema();
  const [emp, setEmp] = useState("");
  const { cuenta } = useResumenPrev(emp);
  const deEmp = (id: string | null | undefined) => enEmpresa(d.equipo(id), emp);
  const parados = d.equipos.filter((e) => ["detenido", "en_reparacion", "reparacion_externa"].includes(e.estado) && enEmpresa(e, emp));
  const pendientes = d.ordenes.filter((o) => ACTIVAS.includes(o.estado) && deEmp(o.equipo_id)).sort((a, b) => rangoPrioridad(a.prioridad) - rangoPrioridad(b.prioridad));
  const compras = d.pedidos_compra.filter((p) => p.estado === "pendiente" && (!emp || p.empresa_id === emp));
  const prestados = d.equipos.filter((e) => e.estado !== "baja" && e.empresa_ubicacion_id !== e.empresa_duena_id && enEmpresa(e, emp));
  const mes = hoy().slice(0, 7);
  const gastoMes = d.ordenes.filter((o) => o.terminada_en?.slice(0, 7) === mes && deEmp(o.equipo_id)).reduce((a, o) => a + costoOrden(d, o.id).total, 0);
  return (
    <div className="informe">
      <div className="encabezado"><div><h1>Resumen para Dirección</h1><p>Situación al {fdt(new Date().toISOString())} · {emp ? d.empresa(emp)?.nombre : "todas las empresas"}</p></div><span className="sp" /><Imprimir /></div>
      <div className="filtros no-imprimir"><FiltroEmpresa emp={emp} setEmp={setEmp} /></div>
      <div className="kpis">
        <Kpi v={parados.length} k="Equipos parados o en reparación" c={parados.length ? "critico" : "ok"} />
        <Kpi v={pendientes.length} k={tema.t("ordenes") + " pendientes"} c={pendientes.some((o) => o.prioridad === "urgente") ? "critico" : ""} />
        <Kpi v={pendientes.filter(vencida).length} k="Órdenes vencidas" c={pendientes.some(vencida) ? "alerta" : ""} />
        <Kpi v={cuenta.vencida} k="Preventivos vencidos" c={cuenta.vencida ? "alerta" : "ok"} />
        <Kpi v={compras.length} k={"Compras por aprobar · " + pesos(compras.reduce((a, p) => a + Number(p.monto_estimado || 0), 0))} />
        <Kpi v={pesos(gastoMes)} k={"Gasto del mes (" + MESES[Number(mes.slice(5)) - 1] + ")"} />
      </div>
      <div className="grilla g2">
        <section className="panel"><h2>Equipos parados o en reparación</h2>{parados.length ? <div className="lista">{parados.map((e) => { const [t, c] = estadoEquipo(e.estado); return (
          <Link key={e.id} className="item" to={"/equipos/" + e.id}><div className="cuerpo-item"><div className="t">{e.nombre}</div><div className="meta"><Codigo>{e.codigo}</Codigo>{d.empresa(e.empresa_ubicacion_id)?.sigla}</div></div><Pastilla c={c}>{t}</Pastilla></Link>); })}</div>
          : <p className="vacio">Todos los equipos están operativos.</p>}</section>
        <section className="panel"><h2>Lo más urgente</h2>{pendientes.length ? <div className="lista">{pendientes.slice(0, 10).map((o) => (
          <Link key={o.id} className="item" to={"/ordenes/" + o.id}><div className="cuerpo-item"><div className="t">{tema.t("orden_abrev")}-{num4(o.numero)} · {o.titulo}</div>
            <div className="meta"><Codigo>{d.equipo(o.equipo_id)?.codigo}</Codigo><span>{d.usuarioDe(o.asignado_a)?.nombre || "Sin asignar"}</span>{o.vence && <span>vence {fd(o.vence)}</span>}</div></div>
            <div style={{ display: "flex", gap: 4, flexDirection: "column", alignItems: "end" }}><PrioridadOT p={o.prioridad} /><EstadoOT o={o} /></div></Link>))}</div> : <p className="vacio">No hay órdenes pendientes.</p>}</section>
        {prestados.length > 0 && <section className="panel"><h2>Equipos prestados a otra empresa</h2><div className="lista">{prestados.map((e) => (
          <Link key={e.id} className="item" to={"/equipos/" + e.id}><div className="cuerpo-item"><div className="t">{e.nombre}</div><div className="meta"><Codigo>{e.codigo}</Codigo><span>de {d.empresa(e.empresa_duena_id)?.sigla} en {d.empresa(e.empresa_ubicacion_id)?.sigla}</span></div></div></Link>))}</div></section>}
      </div>
      <p className="chico suave no-imprimir">Para el detalle de un mes, mirá el <Link to="/informe">Informe mensual</Link>.</p>
    </div>
  );
}

/* ---------- Manuales ---------- */
export function Manuales() {
  const d = useDatos(), s = useSesion();
  const jefe = s.usuario!.perfil === "jefe";
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [emp, setEmp] = useState("");
  const ql = q.trim().toLowerCase();
  const l = d.documentos.filter((x) => x.activo && x.categoria !== "chapa" && x.categoria !== "foto").map((x) => ({ x, e: d.equipo(x.equipo_id) }))
    .filter(({ x, e }) => (!cat || x.categoria === cat) && enEmpresa(e, emp) && (!ql || [x.nombre, e?.codigo, e?.nombre, e?.marca, e?.modelo].join(" ").toLowerCase().includes(ql)))
    .sort((a, b) => (a.e?.codigo || "").localeCompare(b.e?.codigo || "") || a.x.nombre.localeCompare(b.x.nombre));
  return (
    <>
      <div className="encabezado"><div><h1>Manuales</h1><p>Manuales del fabricante, planos eléctricos, programas de PLC y procedimientos de todos los equipos.</p></div><span className="sp" />
        {jefe && <button className="boton pri" onClick={() => abrir(<NuevoDocumento />)}><Ico n="mas" />Cargar manual</button>}</div>
      <div className="filtros">
        <input type="search" placeholder="Buscar por equipo, marca, modelo o nombre" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Buscar" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Tipo de documento"><option value="">Todo tipo</option>{Object.entries(CATEGORIAS).filter(([k]) => !["chapa", "foto"].includes(k)).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <FiltroEmpresa emp={emp} setEmp={setEmp} />
      </div>
      <section className="panel">{l.length ? <div className="lista">{l.map(({ x, e }) => (
        <div key={x.id} className="item"><div className="cuerpo-item"><AbrirDoc doc={x} /><div className="meta">{e && <Link to={"/equipos/" + e.id}><Codigo>{e.codigo}</Codigo></Link>}<span>{e?.nombre}</span><span>{CATEGORIAS[x.categoria]}</span><span>{fd(x.creado_en)}</span></div></div></div>))}</div>
        : <p className="vacio">{d.documentos.length ? "Ningún documento coincide." : "Todavía no hay manuales cargados."}</p>}</section>
    </>
  );
}

/* ---------- ¿Dónde está cada cosa? ---------- */
export function Ayuda() {
  const s = useSesion(), tema = useTema();
  const p = s.usuario!.perfil;
  const Q = ({ q, children }: { q: string; children: ReactNode }) => <details className="ayuda"><summary>{q}</summary><div>{children}</div></details>;
  return (
    <>
      <div className="encabezado"><div><h1>¿Dónde está cada cosa?</h1><p>Respuestas cortas para el día a día. En el celular, todo está en <b>Menú</b> (abajo a la derecha).</p></div></div>
      <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Q q="Una máquina falla: ¿cómo la reporto?">Tocá <b>Falla</b> (abajo, en rojo) o escaneá la etiqueta del equipo con la cámara. Elegí qué le pasa, si está parada, y enviá. Podés sumar foto o video.</Q>
        <Q q="¿Cómo abro un equipo con el QR o el chip NFC?">Botón <b>Escanear</b> (el redondo de abajo) o <b>Menú → Escanear QR / NFC</b>. También sirve la cámara del celular apuntando al QR. Las etiquetas viejas de W-Main también funcionan.</Q>
        {p !== "operario" && <>
          <Q q="¿Dónde veo mis órdenes de trabajo?"><b>Órdenes</b> (abajo) o <b>Menú → Órdenes de trabajo</b>. En Inicio está «Mis órdenes». Dentro de cada orden se carga la ficha de trabajo y la ficha de cierre.</Q>
          <Q q="¿Dónde está el plan de preventivos?"><b>Menú → Preventivos</b>: tarjetas Vencidas, Próximas, Al día y Sin datos, y la lista con lo más urgente primero. «Generar orden» crea la orden de la tarea; al terminarla, la tarea queda al día.</Q>
          <Q q="¿Ya pasó esta falla antes?"><b>Menú → Buscar fallas anteriores</b>: buscá por equipo, síntoma o repuesto y mirá qué se hizo la otra vez.</Q>
          <Q q="¿Dónde están los manuales y planos?"><b>Menú → Manuales</b>, o en la ficha de cada equipo, pestaña Documentos.</Q>
          <Q q="¿Cómo pido un repuesto?">Dentro de la orden: <b>Pedir repuesto</b>. La orden queda esperando el repuesto hasta que llegue.</Q>
        </>}
        {(p === "jefe" || p === "encargado") && <>
          <Q q="¿Cómo creo una orden?"><b>Órdenes → Nueva {tema.t("orden_abrev")}</b>, desde la ficha del equipo o desde un reporte de falla (<b>Crear {tema.t("orden_abrev")}</b>). Para un contratista que no está cargado, elegí «+ Cargar uno nuevo…».</Q>
          <Q q="¿Dónde veo todo lo que se hizo?"><b>Menú → Historial de intervenciones</b> (todas las fichas, con filtros y Excel) y <b>Menú → Intervenciones externas</b> (talleres y contratistas, con informe PDF).</Q>
        </>}
        {p === "jefe" && <>
          <Q q="¿Cómo doy de alta un equipo e imprimo su etiqueta?"><b>Equipos → Relevamiento</b>. Al guardar se genera el código, el QR y la etiqueta. Varias juntas: <b>Menú → Etiquetas QR y NFC</b>.</Q>
          <Q q="¿Cómo reubico, presto o doy de baja un equipo?">En la ficha del equipo: <b>Reubicar</b>, <b>Dar de baja</b> (con informe de baja en PDF) y <b>Préstamo, reparación externa…</b>.</Q>
          <Q q="¿Cómo apruebo compras?"><b>Menú → Pedidos de compra</b>: Aprobar o Rechazar. Lo que pedís vos queda aprobado.</Q>
          <Q q="¿Usuarios, nombres, colores y logo?"><b>Menú → Usuarios y permisos</b> (alta, baja, eliminar, contraseñas) y <b>Menú → Configuración</b> (apariencia, empresas y siglas, vocabulario, campos de la ficha, etiqueta QR).</Q>
        </>}
        {(p === "jefe" || p === "direccion") && <Q q="¿Dónde están los informes?"><b>Menú → Informe mensual</b> y <b>Resumen para Dirección</b> (se imprimen o guardan en PDF), <b>Historial de modificaciones</b> y <b>Exportar datos</b> (Excel).</Q>}
        <Q q="Sin señal, ¿se pierde lo que cargo?">No. Queda guardado en el celular y se envía solo al volver la señal. Arriba se ve «Sin señal: N cargas pendientes».</Q>
        <Q q="¿Cómo recibo los avisos en el celular?"><b>Mi cuenta → Activar avisos en este celular</b>. En iPhone, primero agregá la app a la pantalla de inicio (Safari → Compartir → Agregar a inicio).</Q>
      </section>
    </>
  );
}
