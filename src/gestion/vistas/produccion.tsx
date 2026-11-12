// Producción (tablero y registros) y Administración (listados con filtros, totales y CSV).
import { useDatos } from "../../compartido/datos";
import { sb, ok } from "../../compartido/supabase";
import { Pill, EmpTag, abrirModal, ChartDaily, Hbars, descargar, toast } from "../../compartido/ui";
import { ESTADOS_MOV, TIPOS_MOV, puede } from "../../compartido/catalogos";
import { fd, nf, money, sum, weekStart, ymd, addDays, parseD, hoy } from "../../compartido/formato";
import { csv } from "../../compartido/informe";
import { useUi } from "../../compartido/estadoUi";
import type { Cuenta, Movimiento } from "../../compartido/tipos";
import * as M from "../modales";

type D = ReturnType<typeof useDatos>;

export function MovTabla({ d, l, cuenta, acciones = true }: { d: D; l: Movimiento[]; cuenta: Cuenta; acciones?: boolean }) {
  const rev = acciones && puede(cuenta.rol, "mov.review");
  if (!l.length) return <p className="empty">No hay registros.</p>;
  const revisado = async (m: Movimiento) => {
    ok(await sb().from("movimientos").update({ estado: "revisado" }).eq("id", m.id).select());
    await d.recargar("movimientos", "auditoria");
    toast("Marcado como revisado");
  };
  return (
    <div className="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Empresa</th><th>Detalle</th><th className="n">Cantidad</th><th className="n">Monto</th><th>Cargó</th><th>Estado</th>{rev && <th></th>}</tr></thead><tbody>
      {l.map((m) => (
        <tr key={m.id}>
          <td className="num">{fd(m.fecha)}</td><td>{TIPOS_MOV[m.tipo]}</td><td><EmpTag sigla={m.empresa} nombre={d.empN(m.empresa)} /></td>
          <td>{m.producto}
            {m.contraparte && <div className="small muted">{m.tipo === "venta" ? "Cliente" : "Proveedor"}: {m.contraparte}</div>}
            {m.turno && <div className="small muted">Turno {m.turno}{m.equipo ? " · " + m.equipo : ""}</div>}
            {m.obs && <div className="small muted">{m.obs}</div>}
            {m.nota && <div className="small"><b>Nota:</b> {m.nota}</div>}</td>
          <td className="n">{nf.format(m.cantidad || 0)}</td><td className="n">{m.monto ? money(m.monto) : "—"}</td><td>{m.operario_nombre}</td><td><Pill map={ESTADOS_MOV} k={m.estado} /></td>
          {rev && <td><div className="btns">{m.estado !== "revisado" && <button className="btn sm" onClick={() => revisado(m)}>Revisado</button>}<button className="btn sm" onClick={() => abrirModal(<M.Observar id={m.id} />)}>Observar</button></div></td>}
        </tr>))}
    </tbody></table></div>
  );
}

const empresasPara = (d: D) => d.empresas.map((e): [string, string] => [e.sigla, e.nombre]);

export function Produccion({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos();
  const ws = weekStart(new Date()), we = addDays(ws, 7);
  const l = d.movimientos.filter((m) => { const x = parseD(m.fecha)!; return x >= ws && x < we; });
  const pend = d.movimientos.filter((m) => m.estado === "pendiente").sort((a, b) => b.ts.localeCompare(a.ts));
  const prod = l.filter((m) => m.tipo === "produccion"), ven = l.filter((m) => m.tipo === "venta"), com = l.filter((m) => m.tipo === "compra");
  const rep = d.reportes.filter((r) => r.estado === "nuevo" || r.estado === "analisis");
  return (
    <>
      <div className="head"><div><h1>Tablero de producción</h1><p>Semana del {fd(ymd(ws))} · lo que cargaron los operarios</p></div></div>
      <div className="kpis">
        <div className="kpi"><span className="v">{nf.format(sum(prod, "cantidad"))}</span><span className="k">Unidades producidas esta semana</span></div>
        <div className="kpi"><span className="v">{money(sum(ven, "monto"))}</span><span className="k">Ventas cargadas ({ven.length})</span></div>
        <div className="kpi"><span className="v">{money(sum(com, "monto"))}</span><span className="k">Compras cargadas ({com.length})</span></div>
        <a className={"kpi " + (pend.length ? "warn" : "")} href="#registros"><span className="v">{pend.length}</span><span className="k">Registros sin revisar</span></a>
        <a className={"kpi " + (rep.length ? "warn" : "")} href="#reportes"><span className="v">{rep.length}</span><span className="k">Problemas en máquinas sin resolver</span></a>
      </div>
      <div className="grid g2">
        <section className="panel"><h2>Unidades producidas por día</h2><ChartDaily prod={prod} ws={ws} emps={empresasPara(d)} /></section>
        <section className="panel"><h2>Producción por empresa</h2><Hbars rows={d.empresas.map((k) => [k.nombre, sum(prod.filter((m) => m.empresa === k.sigla), "cantidad"), `var(--c-${k.sigla})`])} f={nf.format} /></section>
      </div>
      <section className="panel"><div className="panel-h"><h2>Últimos registros sin revisar</h2><span className="sp" /><a href="#registros" className="small">Ver registros</a></div><MovTabla d={d} l={pend.slice(0, 8)} cuenta={cuenta} /></section>
    </>
  );
}

export function Registros({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos();
  const [tipo, setTipo] = useUi("movTipo", ""); const [emp, setEmp] = useUi("movEmp", ""); const [est, setEst] = useUi("movEst", "");
  const l = d.movimientos.filter((m) => (!tipo || m.tipo === tipo) && (!emp || m.empresa === emp) && (!est || m.estado === est)).sort((a, b) => (b.fecha + b.ts).localeCompare(a.fecha + a.ts));
  return (
    <>
      <div className="head"><div><h1>Registros de operarios</h1><p>Producción, ventas y compras cargadas desde la app de operarios. Marcalos como revisados u observalos con una nota.</p></div></div>
      <div className="filters">
        <select id="f-movtipo" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos los tipos</option><option value="produccion">Producción</option><option value="venta">Ventas</option><option value="compra">Compras</option></select>
        <select id="f-movemp" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">Todas las empresas</option>{d.empresas.map((k) => <option key={k.sigla} value={k.sigla}>{k.nombre}</option>)}</select>
        <select id="f-movest" value={est} onChange={(e) => setEst(e.target.value)}><option value="">Todos los estados</option>{Object.entries(ESTADOS_MOV).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
      </div>
      <section className="panel"><MovTabla d={d} l={l.slice(0, 200)} cuenta={cuenta} />{l.length > 200 && <p className="muted small">Se muestran los 200 más recientes de {l.length}.</p>}</section>
    </>
  );
}

export function Listados({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos();
  const [tab, setTab] = useUi("listTab", "produccion"); const [emp, setEmp] = useUi("listEmp", "");
  const [desde, setDesde] = useUi("listDesde", ""); const [hasta, setHasta] = useUi("listHasta", "");
  const l = d.movimientos.filter((m) => m.tipo === tab && (!emp || m.empresa === emp) && (!desde || m.fecha >= desde) && (!hasta || m.fecha <= hasta)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const byEmp: [string, number, string][] = d.empresas.map((k) => { const x = l.filter((m) => m.empresa === k.sigla); return [k.nombre, tab === "produccion" ? sum(x, "cantidad") : sum(x, "monto"), `var(--c-${k.sigla})`]; });
  return (
    <>
      <div className="head"><div><h1>Listados administrativos</h1><p>Todo lo cargado por los operarios, con filtros y totales.</p></div><span className="sp" />
        <button className="btn" onClick={() => descargar(`${tab}-${hoy()}.csv`, csv(d, l), "text/csv;charset=utf-8")}>Exportar CSV</button></div>
      <div className="tabs">{[["produccion", "Unidades producidas"], ["venta", "Ventas"], ["compra", "Compras"]].map(([k, n]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{n}</button>)}</div>
      <div className="filters">
        <select id="f-listemp" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">Todas las empresas</option>{d.empresas.map((k) => <option key={k.sigla} value={k.sigla}>{k.nombre}</option>)}</select>
        <label className="small">Desde <input type="date" id="f-ld" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="small">Hasta <input type="date" id="f-lh" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      <div className="grid g2">
        <section className="panel"><h3>Totales</h3><div className="kpis" style={{ marginTop: 8 }}><div className="kpi"><span className="v">{l.length}</span><span className="k">Registros</span></div>
          {tab === "produccion" ? <div className="kpi"><span className="v">{nf.format(sum(l, "cantidad"))}</span><span className="k">Unidades</span></div> : <div className="kpi"><span className="v">{money(sum(l, "monto"))}</span><span className="k">Monto total</span></div>}</div></section>
        <section className="panel"><h3>Por empresa</h3><Hbars rows={byEmp} f={tab === "produccion" ? nf.format : money} /></section>
      </div>
      <section className="panel"><MovTabla d={d} l={l.slice(0, 300)} cuenta={cuenta} acciones={false} /></section>
    </>
  );
}
