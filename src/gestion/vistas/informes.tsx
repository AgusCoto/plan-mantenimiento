// Informe semanal (todos los de gestión) y resumen para Dirección.
import { useDatos } from "../../compartido/datos";
import { Pill, ChartDaily, Hbars, descargar } from "../../compartido/ui";
import { ESTADOS_OT, PRIOR } from "../../compartido/catalogos";
import { fd, ymd, addDays, nf, nf1, money, sum, hrs, prevStatus } from "../../compartido/formato";
import { semana, pendientes, informeHtml, otNum } from "../../compartido/informe";
import { useUi } from "../../compartido/estadoUi";

type D = ReturnType<typeof useDatos>;
const emps = (d: D) => d.empresas.map((e): [string, string] => [e.sigla, e.nombre]);

function Pendientes({ d }: { d: D }) {
  const P = pendientes(d);
  return (
    <section className="panel"><h2>Tareas pendientes al día de hoy</h2>
      <div className="grid g3" style={{ marginTop: 6 }}>
        <div><p className="label">Órdenes abiertas ({P.ots.length})</p><div className="list">
          {P.ots.length ? P.ots.slice(0, 6).map((o) => <div className="item" key={o.id}><div className="body"><div className="t">{otNum(o.numero)} · {o.titulo}</div><div className="meta"><span className="code">{o.equipo}</span><Pill map={PRIOR} k={o.prioridad} /></div></div></div>) : <p className="empty">Ninguna</p>}</div></div>
        <div><p className="label">Preventivos vencidos ({P.venc.length})</p><div className="list">
          {P.venc.length ? P.venc.slice(0, 6).map((p) => <div className="item" key={p.id}><div className="body"><div className="t">{p.tarea}</div><div className="meta"><span className="code">{p.equipo}</span><span>{-prevStatus(p)[2]} días vencido</span></div></div></div>) : <p className="empty">Ninguno</p>}</div></div>
        <div><p className="label">Problemas reportados sin resolver ({P.reps.length})</p><div className="list">
          {P.reps.length ? P.reps.slice(0, 6).map((r) => <div className="item" key={r.id}><div className="body"><div className="t">{r.tipo} · {d.eq(r.equipo)?.nombre || r.equipo}</div><div className="meta">{fd(r.ts)} · {r.operario_nombre}</div></div></div>) : <p className="empty">Ninguno</p>}</div>
          <p className="label" style={{ marginTop: 12 }}>Registros sin revisar: {P.movs.length} · Equipos fuera de servicio: {P.det.length}</p></div>
      </div>
    </section>
  );
}

export function Informe() {
  const d = useDatos();
  const [off, setOff] = useUi("weekOff", 0);
  const w = semana(d, off), pv = semana(d, off - 1);
  const delta = (a: number, b: number) => (b ? <span className={"small " + (a >= b ? "" : "muted")}>{a >= b ? "▲" : "▼"} {nf.format(Math.abs(Math.round(((a - b) / b) * 100)))}% vs semana anterior</span> : null);
  const tareas = [
    ...w.fichas.map((f) => ({ ts: f.fecha, t: `${f.ot.titulo} (${otNum(f.ot.numero)})`, eq: f.ot.equipo, q: f.tecnico_nombre, det: f.trabajo, k: "Correctivo", id: f.id })),
    ...w.prevDone.map((x) => ({ ts: x.fecha, t: x.p.tarea, eq: x.p.equipo, q: x.tecnico_nombre, det: x.obs || "", k: "Preventivo", id: x.id })),
  ].sort((a, b) => a.ts.localeCompare(b.ts));
  return (
    <>
      <div className="head"><div><h1>Informe semanal</h1><p>Del {fd(ymd(w.ws))} al {fd(ymd(addDays(w.we, -1)))} · mantenimiento y productividad</p></div><span className="sp" />
        <div className="btns">
          <button className="btn" onClick={() => setOff(off - 1)} aria-label="Semana anterior">← Anterior</button>
          <button className="btn" onClick={() => setOff(Math.min(0, off + 1))} disabled={off >= 0} aria-label="Semana siguiente">Siguiente →</button>
          <button className="btn pri" onClick={() => descargar(`informe-semanal-${ymd(w.ws)}.html`, informeHtml(d, w))}>Descargar informe</button>
        </div></div>
      <h2>Productividad</h2>
      <div className="kpis">
        <div className="kpi"><span className="v">{nf.format(sum(w.prod, "cantidad"))}</span><span className="k">Unidades producidas</span>{delta(sum(w.prod, "cantidad"), sum(pv.prod, "cantidad"))}</div>
        <div className="kpi"><span className="v">{money(sum(w.ven, "monto"))}</span><span className="k">Ventas ({w.ven.length})</span>{delta(sum(w.ven, "monto"), sum(pv.ven, "monto"))}</div>
        <div className="kpi"><span className="v">{money(sum(w.com, "monto"))}</span><span className="k">Compras ({w.com.length})</span></div>
        <div className="kpi"><span className="v">{w.movs.filter((m) => m.estado !== "pendiente").length}/{w.movs.length}</span><span className="k">Registros revisados por producción</span></div>
      </div>
      <div className="grid g2">
        <section className="panel"><h3>Unidades por día</h3><ChartDaily prod={w.prod} ws={w.ws} emps={emps(d)} /></section>
        <section className="panel"><h3>Ventas y compras por empresa</h3>
          <p className="label" style={{ marginTop: 8 }}>Ventas</p><Hbars rows={d.empresas.map((k) => [k.nombre, sum(w.ven.filter((m) => m.empresa === k.sigla), "monto"), `var(--c-${k.sigla})`])} f={money} />
          <p className="label" style={{ marginTop: 14 }}>Compras</p><Hbars rows={d.empresas.map((k) => [k.nombre, sum(w.com.filter((m) => m.empresa === k.sigla), "monto"), `var(--c-${k.sigla})`])} f={money} /></section>
      </div>
      <h2>Mantenimiento</h2>
      <div className="kpis">
        <div className="kpi"><span className="v">{w.otNew.length}</span><span className="k">OT generadas</span></div>
        <div className="kpi ok"><span className="v">{w.otClosed.length}</span><span className="k">OT cerradas</span></div>
        <div className="kpi"><span className="v">{w.prevDone.length}</span><span className="k">Preventivos realizados</span></div>
        <div className="kpi"><span className="v">{nf1.format(w.horas)} h</span><span className="k">Horas de trabajo técnico</span></div>
        <div className={"kpi " + (w.parada ? "warn" : "")}><span className="v">{nf1.format(w.parada)} h</span><span className="k">Máquina parada por intervenciones</span></div>
        <div className="kpi"><span className="v">{w.reps.length}</span><span className="k">Reportes de operarios</span></div>
        <div className="kpi"><span className="v">{hrs(w.resp)}</span><span className="k">Del reporte a la OT (promedio)</span></div>
        <div className="kpi"><span className="v">{hrs(w.res)}</span><span className="k">De la OT al cierre (promedio)</span></div>
      </div>
      <section className="panel"><h3>Tareas realizadas en la semana</h3>{tareas.length ? (
        <div className="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Tarea</th><th>Equipo</th><th>Técnico</th><th>Detalle</th></tr></thead><tbody>
          {tareas.map((t) => <tr key={t.id}><td className="num">{fd(t.ts)}</td><td>{t.k}</td><td>{t.t}</td><td><span className="code">{t.eq}</span></td><td>{t.q}</td><td>{t.det}</td></tr>)}
        </tbody></table></div>) : <p className="empty">No se registraron tareas esta semana.</p>}</section>
      <Pendientes d={d} />
    </>
  );
}

export function Direccion() {
  const d = useDatos();
  const w = semana(d, 0), pv = semana(d, -1);
  const eqAct = d.equipos.filter((e) => e.estado !== "baja");
  const disp = eqAct.length ? Math.round((eqAct.filter((e) => e.estado === "operativo").length / eqAct.length) * 100) : 0;
  const otsEst: [string, number, string][] = Object.keys(ESTADOS_OT).filter((k) => k !== "cerrada").map((k) => [ESTADOS_OT[k][0], d.ordenes.filter((o) => o.estado === k).length, "var(--accent)"]);
  const otsEmp: [string, number, string][] = d.empresas.map((k) => [k.nombre, d.ordenes.filter((o) => o.estado !== "cerrada" && d.eq(o.equipo)?.empresa === k.sigla).length, `var(--c-${k.sigla})`]);
  return (
    <>
      <div className="head"><div><h1>Resumen para dirección</h1><p>Semana en curso, desde el {fd(ymd(w.ws))}. Para el detalle completo abrí el informe semanal.</p></div><span className="sp" /><a className="btn" href="#informe">Informe semanal</a></div>
      <div className="kpis">
        <div className="kpi"><span className="v">{nf.format(sum(w.prod, "cantidad"))}</span><span className="k">Unidades producidas (semana anterior: {nf.format(sum(pv.prod, "cantidad"))})</span></div>
        <div className="kpi"><span className="v">{money(sum(w.ven, "monto"))}</span><span className="k">Ventas de la semana</span></div>
        <div className="kpi"><span className="v">{money(sum(w.com, "monto"))}</span><span className="k">Compras de la semana</span></div>
        <div className={"kpi " + (disp < 90 ? "warn" : "ok")}><span className="v">{disp}%</span><span className="k">Equipos disponibles ahora</span></div>
        <div className="kpi"><span className="v">{hrs(pv.resp)}</span><span className="k">Respuesta a reportes (semana anterior)</span></div>
        <div className="kpi"><span className="v">{hrs(pv.res)}</span><span className="k">Resolución de OT (semana anterior)</span></div>
      </div>
      <div className="grid g2">
        <section className="panel"><h3>Producción diaria · semana anterior</h3><ChartDaily prod={pv.prod} ws={pv.ws} emps={emps(d)} /></section>
        <section className="panel"><h3>Producción diaria · esta semana</h3><ChartDaily prod={w.prod} ws={w.ws} emps={emps(d)} /></section>
        <section className="panel"><h3>Órdenes de trabajo activas por estado</h3><Hbars rows={otsEst} f={nf.format} /></section>
        <section className="panel"><h3>Órdenes activas por empresa</h3><Hbars rows={otsEmp} f={nf.format} /></section>
      </div>
      <Pendientes d={d} />
    </>
  );
}
