// Pantallas de mantenimiento: tablero, equipos, órdenes, preventivos y reportes de operarios.
import { useEffect, useState } from "react";
import { useDatos } from "../../compartido/datos";
import { sb, ok, urlEquipo } from "../../compartido/supabase";
import { Pill, EmpTag, Code, abrirModal, confirmar, toast, descargar, falla } from "../../compartido/ui";
import { Medios, Miniatura, urlFirmada } from "../../compartido/archivos";
import { ESTADOS_EQ, ESTADOS_OT, ESTADOS_REP, PRIOR, puede, type Permiso } from "../../compartido/catalogos";
import { fd, fdt, nf, nf1, prevNext, prevStatus } from "../../compartido/formato";
import { otNum, sortOT } from "../../compartido/informe";
import { qrDataUrl, etiquetaPng, hojaEtiquetas } from "../../compartido/qr";
import { ir } from "../../compartido/ruta";
import type { Cuenta, Equipo as TEquipo, Orden as TOrden, Preventivo, Reporte } from "../../compartido/tipos";
import * as M from "../modales";

type D = ReturnType<typeof useDatos>;
const usePuede = (c: Cuenta) => (p: Permiso) => puede(c.rol, p);
const Emp = ({ d, s }: { d: D; s: string }) => <EmpTag sigla={s} nombre={d.empN(s)} />;

function NotaEjemplo({ d, cuenta }: { d: D; cuenta: Cuenta }) {
  const n = d.equipos.filter((x) => x.ejemplo).length + d.ordenes.filter((x) => x.ejemplo).length + d.reportes.filter((x) => x.ejemplo).length + d.movimientos.filter((x) => x.ejemplo).length + d.preventivos.filter((x) => x.ejemplo).length;
  if (!n || cuenta.rol !== "gm") return null;
  return (
    <div className="note info"><span><b>Datos de ejemplo cargados</b> ({n} registros) para mostrar cómo funciona. Cuando empieces con datos reales, borralos.</span><span className="sp" />
      <button className="btn sm" onClick={() => confirmar("Borrar datos de ejemplo", "Se eliminan los equipos, órdenes, preventivos, reportes y registros de ejemplo, y se desactivan las cuentas de ejemplo. Lo que cargaron ustedes queda.", "Borrar", async () => {
        const r = await sb().rpc("borrar_datos_ejemplo");
        if (r.error) throw falla(r.error.message);
        await d.recargar(); toast("Datos de ejemplo borrados");
      })}>Borrar datos de ejemplo</button></div>
  );
}

export function EqItem({ d, e }: { d: D; e: TEquipo }) {
  return <a className="item" href={"#eq-" + e.codigo}><div className="body"><div className="t">{e.nombre}</div><div className="meta"><span className="code">{e.codigo}</span><Emp d={d} s={e.empresa} /></div></div><Pill map={ESTADOS_EQ} k={e.estado} /></a>;
}
export function OtItem({ o }: { o: TOrden }) {
  return (
    <a className="item" href={"#ot-" + o.id}>
      <div className="body"><div className="t">{otNum(o.numero)} · {o.titulo}</div><div className="meta"><span className="code">{o.equipo}</span>{o.asignado && <span>{o.asignado}</span>}<span>{fd(o.creado)}</span></div></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}><Pill map={ESTADOS_OT} k={o.estado} /><Pill map={PRIOR} k={o.prioridad} /></div>
    </a>
  );
}
export function PrevItem({ p, extra }: { p: Preventivo; extra?: React.ReactNode }) {
  const st = prevStatus(p);
  return (
    <div className="item"><div className="body"><div className="t">{p.tarea}</div>
      <div className="meta"><a href={"#eq-" + p.equipo} className="code">{p.equipo}</a><span>Cada {p.frecuencia} días</span><span>Próximo: {fd(prevNext(p))}</span></div>{extra}</div>
      <span className={"pill " + st[1]}>{st[2] < 0 ? `${-st[2]} días vencido` : st[0]}</span></div>
  );
}
export function RepItem({ d, r }: { d: D; r: Reporte }) {
  const a = d.adjuntos.find((x) => x.reporte_id === r.id);
  return (
    <a className="item" href="#reportes"><Miniatura a={a} />
      <div className="body"><div className="t">{r.tipo} · {d.eq(r.equipo)?.nombre || r.equipo}</div>
        <div className="meta"><span className="code">{r.equipo}</span><span>{r.operario_nombre}</span><span>{fdt(r.ts)}</span>{r.detenida && <span className="pill crit">Máquina detenida</span>}</div></div>
      <Pill map={ESTADOS_REP} k={r.estado} /></a>
  );
}

/* ---------- Tablero ---------- */
export function Tablero({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos(); const can = usePuede(cuenta);
  const eq = d.equipos.filter((e) => e.estado !== "baja");
  const det = eq.filter((e) => e.estado === "detenido"), rep = eq.filter((e) => e.estado === "reparacion");
  const ots = d.ordenes.filter((o) => o.estado !== "cerrada");
  const prevs = d.preventivos.filter((p) => d.eq(p.equipo)?.estado !== "baja");
  const venc = prevs.filter((p) => prevStatus(p)[1] === "crit"), prox = prevs.filter((p) => prevStatus(p)[1] === "warn");
  const nuevos = d.reportes.filter((r) => r.estado === "nuevo");
  const urg = ots.filter((o) => o.prioridad === "alta");
  return (
    <>
      <NotaEjemplo d={d} cuenta={cuenta} />
      <div className="head"><div><h1>Tablero de mantenimiento</h1><p>{nf.format(eq.length)} equipos activos en las {d.empresas.length} empresas</p></div><span className="sp" />
        <div className="btns">{can("ot.create") && <button className="btn pri" onClick={() => abrirModal(<M.NuevaOrden />)}>Nueva orden de trabajo</button>}</div></div>
      <div className="kpis">
        <a className="kpi ok" href="#equipos"><span className="v">{eq.filter((e) => e.estado === "operativo").length}</span><span className="k">Equipos operativos</span></a>
        <a className={"kpi " + (det.length ? "crit" : "")} href="#equipos"><span className="v">{det.length}</span><span className="k">Detenidos</span></a>
        <a className={"kpi " + (rep.length ? "warn" : "")} href="#equipos"><span className="v">{rep.length}</span><span className="k">En reparación</span></a>
        <a className={"kpi " + (urg.length ? "crit" : "")} href="#ordenes"><span className="v">{ots.length}</span><span className="k">OT abiertas · {urg.length} alta prioridad</span></a>
        <a className={"kpi " + (venc.length ? "crit" : "")} href="#preventivos"><span className="v">{venc.length}</span><span className="k">Preventivos vencidos · {prox.length} esta semana</span></a>
        <a className={"kpi " + (nuevos.length ? "warn" : "")} href="#reportes"><span className="v">{nuevos.length}</span><span className="k">Reportes nuevos de operarios</span></a>
      </div>
      <div className="grid g2">
        <section className="panel"><div className="panel-h"><h2>Reportes de operarios sin atender</h2><span className="sp" /><a href="#reportes" className="small">Ver todos</a></div>
          {nuevos.length ? <div className="list">{nuevos.slice(0, 5).map((r) => <RepItem key={r.id} d={d} r={r} />)}</div> : <p className="empty">No hay reportes nuevos.</p>}</section>
        <section className="panel"><div className="panel-h"><h2>Órdenes de trabajo activas</h2><span className="sp" /><a href="#ordenes" className="small">Ver todas</a></div>
          {ots.length ? <div className="list">{sortOT(ots).slice(0, 6).map((o) => <OtItem key={o.id} o={o} />)}</div> : <p className="empty">Sin órdenes abiertas.</p>}</section>
        <section className="panel"><div className="panel-h"><h2>Preventivos vencidos y próximos</h2><span className="sp" /><a href="#preventivos" className="small">Ver plan</a></div>
          {venc.length + prox.length ? <div className="list">{[...venc, ...prox].sort((a, b) => prevNext(a).localeCompare(prevNext(b))).slice(0, 6).map((p) => <PrevItem key={p.id} p={p} />)}</div> : <p className="empty">Todo al día.</p>}</section>
        <section className="panel"><div className="panel-h"><h2>Equipos fuera de servicio</h2></div>
          {det.length + rep.length ? <div className="list">{[...det, ...rep].map((e) => <EqItem key={e.codigo} d={d} e={e} />)}</div> : <p className="empty">Todos los equipos están operativos.</p>}</section>
      </div>
    </>
  );
}

/* ---------- Equipos ---------- */
export function Equipos({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos(); const can = usePuede(cuenta);
  const [q, setQ] = useState(""); const [emp, setEmp] = useState(""); const [est, setEst] = useState("");
  const ql = q.toLowerCase();
  const l = d.equipos.filter((e) => (!emp || e.empresa === emp) && (est ? e.estado === est : e.estado !== "baja") && (!ql || (e.codigo + " " + e.nombre + " " + (e.ubicacion || "")).toLowerCase().includes(ql)));
  const hoja = async () => {
    const html = await hojaEtiquetas(d.equipos.filter((e) => e.estado !== "baja"), d.empN, d.areaN, d.conf<string>("url_publica", ""));
    descargar("etiquetas-qr-equipos.html", html);
  };
  return (
    <>
      <div className="head"><div><h1>Equipos</h1><p>Código: empresa · área · tipo · número. Cada equipo tiene su QR.</p></div><span className="sp" />
        <div className="btns">{d.equipos.length > 0 && <button className="btn" onClick={hoja}>Hoja de etiquetas QR</button>}{can("eq.new") && <button className="btn pri" onClick={() => abrirModal(<M.NuevoEquipo />)}>Nuevo equipo</button>}</div></div>
      <div className="filters">
        <input type="search" id="f-eqq" placeholder="Buscar por código, nombre o ubicación" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <select id="f-eqemp" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">Todas las empresas</option>{d.empresas.map((k) => <option key={k.sigla} value={k.sigla}>{k.nombre}</option>)}</select>
        <select id="f-eqest" value={est} onChange={(e) => setEst(e.target.value)}><option value="">Activos</option>{Object.entries(ESTADOS_EQ).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
      </div>
      <section className="panel">{l.length ? (
        <div className="tbl-wrap"><table><thead><tr><th>Código</th><th>Equipo</th><th>Empresa</th><th>Ubicación</th><th>Estado</th><th className="n">OT abiertas</th></tr></thead><tbody>
          {l.map((e) => (
            <tr className="click" key={e.codigo} onClick={() => ir("eq-" + e.codigo)}>
              <td><span className="code">{e.codigo}</span></td><td>{e.nombre}<div className="small muted">{e.modelo || ""}</div></td><td><Emp d={d} s={e.empresa} /></td>
              <td>{d.areaN(e.area)}<div className="small muted">{e.ubicacion || ""}</div></td><td><Pill map={ESTADOS_EQ} k={e.estado} /></td>
              <td className="n">{d.ordenes.filter((o) => o.equipo === e.codigo && o.estado !== "cerrada").length || ""}</td>
            </tr>))}
        </tbody></table></div>
      ) : d.equipos.length ? <p className="empty">Ningún equipo coincide con el filtro.</p>
        : <p className="empty">Todavía no hay equipos cargados. {can("eq.new") ? "Usá «Nuevo equipo» para cargar el primero; el código y el QR se generan solos." : ""}</p>}</section>
    </>
  );
}

function Qr({ texto }: { texto: string }) {
  const [u, setU] = useState("");
  useEffect(() => { qrDataUrl(texto, 240).then(setU); }, [texto]);
  return <div className="qr" aria-label="Código QR del equipo">{u ? <img src={u} alt="" /> : null}</div>;
}
function ManualLink({ m }: { m: { bucket: string | null; ruta: string | null; url: string | null; nombre: string } }) {
  const abrir = async (ev: React.MouseEvent) => {
    if (m.url) return;
    ev.preventDefault();
    const w = window.open("about:blank", "_blank");
    const u = m.bucket && m.ruta ? await urlFirmada(m.bucket, m.ruta) : null;
    if (u && w) w.location.href = u; else { w?.close(); toast("No se pudo abrir el manual."); }
  };
  return <a href={m.url || "#"} target="_blank" rel="noopener" className="t" onClick={abrir}>{m.nombre}</a>;
}

export function Equipo({ codigo, cuenta }: { codigo: string; cuenta: Cuenta }) {
  const d = useDatos(); const can = usePuede(cuenta);
  const [tab, setTab] = useState("historial");
  const e = d.eq(codigo);
  if (!e) return <><div className="head"><h1>Equipo no encontrado</h1></div><p className="muted">No existe el equipo <span className="code">{codigo}</span>. <a href="#equipos">Volver a equipos</a></p></>;
  const ots = d.ordenes.filter((o) => o.equipo === codigo);
  const otIds = new Set(ots.map((o) => o.id));
  const prevs = d.preventivos.filter((p) => p.equipo === codigo);
  const pvMap = new Map(prevs.map((p) => [p.id, p]));
  const reps = d.reportes.filter((r) => r.equipo === codigo);
  const mans = d.manuales.filter((m) => m.equipo === codigo);
  const hist: { ts: string; c: string; h: React.ReactNode; k: string }[] = [];
  ots.forEach((o) => hist.push({ ts: o.creado, c: "ot", k: "o" + o.id, h: <><b><a href={"#ot-" + o.id}>{otNum(o.numero)}</a></b> creada: {o.titulo} <Pill map={ESTADOS_OT} k={o.estado} /></> }));
  d.fichas.filter((f) => otIds.has(f.orden_id)).forEach((f) => {
    const o = ots.find((x) => x.id === f.orden_id)!;
    hist.push({ ts: f.fecha, c: "ot", k: "f" + f.id, h: <>Ficha de <b>{f.tecnico_nombre}</b> ({otNum(o.numero)}): {f.trabajo} · {nf1.format(f.horas || 0)} h{f.parada ? ` · ${nf1.format(f.parada)} h de máquina parada` : ""}{f.repuestos ? ` · Repuestos: ${f.repuestos}` : ""}</> });
  });
  d.preventivo_ejecuciones.filter((x) => pvMap.has(x.preventivo_id)).forEach((x) => hist.push({ ts: x.fecha, c: "prev", k: "p" + x.id, h: <>Preventivo realizado por <b>{x.tecnico_nombre}</b>: {pvMap.get(x.preventivo_id)!.tarea}{x.obs ? ` · ${x.obs}` : ""}</> }));
  reps.forEach((r) => hist.push({ ts: r.ts, c: "rep", k: "r" + r.id, h: <>Reporte de operario (<b>{r.operario_nombre}</b>): {r.tipo} — {r.descripcion}</> }));
  d.equipo_eventos.filter((x) => x.equipo === codigo).forEach((x) => hist.push({ ts: x.fecha, c: "mov", k: "e" + x.id, h: x.texto }));
  hist.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const tabs: [string, string][] = [["historial", "Historial"], ["preventivos", `Preventivos (${prevs.length})`], ["manuales", `Manuales (${mans.length})`], ["reportes", `Reportes (${reps.length})`]];
  const abiertas = ots.filter((o) => o.estado !== "cerrada");
  const base = d.conf<string>("url_publica", "");
  const etiqueta = async () => descargar(`etiqueta-${e.codigo}.png`, await etiquetaPng(e, d.empN(e.empresa), d.areaN(e.area), base));
  const quien = (id: string | null) => d.cuenta(id)?.nombre;
  return (
    <>
      <div className="head"><div><a href="#equipos" className="small">← Equipos</a><h1>{e.nombre}</h1></div><span className="sp" />
        <div className="btns">
          {can("ot.create") && e.estado !== "baja" && <button className="btn pri" onClick={() => abrirModal(<M.NuevaOrden equipo={codigo} />)}>Nueva OT</button>}
          {can("eq.edit") && <>
            <button className="btn" onClick={() => abrirModal(<M.EditarEquipo e={e} />)}>Editar</button>
            <button className="btn" onClick={() => abrirModal(<M.ReubicarEquipo e={e} />)}>Reubicar</button>
            {e.estado === "baja"
              ? <button className="btn" onClick={async () => { ok(await sb().rpc("estado_equipo", { p_codigo: codigo, p_estado: "operativo", p_motivo: null })); await d.recargar("equipos", "equipo_eventos"); toast("Equipo reactivado"); }}>Reactivar</button>
              : <button className="btn danger" onClick={() => abrirModal(<M.BajaEquipo e={e} />)}>Dar de baja</button>}
          </>}
        </div></div>
      <div className="plate">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Code style={{ fontSize: "1rem" }}>{e.codigo}</Code><Pill map={ESTADOS_EQ} k={e.estado} /></div>
          <dl>
            <dt>Tipo</dt><dd>{d.tipoN(e.tipo)}</dd>
            <dt>Marca / modelo</dt><dd>{[e.marca, e.modelo].filter(Boolean).join(" · ") || "—"}</dd>
            <dt>Empresa</dt><dd><Emp d={d} s={e.empresa} /></dd>
            <dt>Área</dt><dd>{d.areaN(e.area)}</dd>
            <dt>Ubicación</dt><dd>{e.ubicacion || "—"}</dd>
            <dt>Alta</dt><dd>{fd(e.alta)}{quien(e.creado_por) ? " · " + quien(e.creado_por) : ""}{quien(e.autorizo_id) ? ` (autorizó ${quien(e.autorizo_id)})` : ""}</dd>
            {e.notas && <><dt>Notas</dt><dd style={{ whiteSpace: "pre-wrap" }}>{e.notas}</dd></>}
            {quien(e.modificado_por) && <><dt>Último cambio</dt><dd>{quien(e.modificado_por)} · {fdt(e.modificado)}</dd></>}
          </dl>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
          <Qr texto={urlEquipo(e.codigo, base)} />
          <button className="btn sm" onClick={etiqueta}>Descargar etiqueta</button>
        </div>
      </div>
      {abiertas.length > 0 && <section className="panel"><h2>Órdenes abiertas</h2><div className="list">{abiertas.map((o) => <OtItem key={o.id} o={o} />)}</div></section>}
      <section className="panel">
        <div className="tabs" role="tablist">{tabs.map(([k, n]) => <button key={k} role="tab" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{n}</button>)}</div>
        <div style={{ paddingTop: 14 }}>
          {tab === "historial" && (hist.length ? <div className="timeline">{hist.map((x) => <div key={x.k} className={"tl " + x.c}><div className="d">{fdt(x.ts)}</div><div>{x.h}</div></div>)}</div> : <p className="empty">Sin trabajos registrados todavía.</p>)}
          {tab === "preventivos" && <>
            {prevs.length ? <div className="list">{prevs.map((p) => <PrevItem key={p.id} p={p} extra={can("prev.do") && <div style={{ marginTop: 6 }}><button className="btn sm" onClick={() => abrirModal(<M.RegistrarPreventivo id={p.id} cuenta={cuenta} />)}>Registrar realización</button></div>} />)}</div> : <p className="empty">Este equipo no tiene preventivos programados.</p>}
            {can("prev.manage") && <div style={{ marginTop: 10 }}><button className="btn" onClick={() => abrirModal(<M.NuevoPreventivo equipo={codigo} />)}>Programar preventivo</button></div>}
          </>}
          {tab === "manuales" && <>
            {mans.length ? <div className="list">{mans.map((m) => (
              <div className="item" key={m.id}><div className="body"><ManualLink m={m} /><div className="meta">{m.ruta ? "PDF" : "Enlace"} · cargado {fd(m.fecha)}</div></div>
                {can("eq.edit") && <button className="btn sm" onClick={() => confirmar("Quitar manual", <>¿Quitar «{m.nombre}» de este equipo?</>, "Quitar", async () => {
                  ok(await sb().from("manuales").delete().eq("id", m.id).select());
                  if (m.bucket && m.ruta) await sb().storage.from(m.bucket).remove([m.ruta]);
                  await d.recargar("manuales", "auditoria");
                })}>Quitar</button>}</div>))}</div> : <p className="empty">No hay manuales cargados para este equipo.</p>}
            {can("eq.edit") && <div style={{ marginTop: 10 }}><button className="btn" onClick={() => abrirModal(<M.AgregarManual e={e} />)}>Agregar manual</button></div>}
          </>}
          {tab === "reportes" && (reps.length ? <div className="list">{reps.map((r) => <RepItem key={r.id} d={d} r={r} />)}</div> : <p className="empty">Sin reportes de operarios.</p>)}
        </div>
      </section>
    </>
  );
}

/* ---------- Órdenes ---------- */
export function Ordenes({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos(); const can = usePuede(cuenta);
  const [f, setF] = useState("activas");
  const l = sortOT(d.ordenes.filter((o) => (f === "activas" ? o.estado !== "cerrada" : f ? o.estado === f : true)));
  return (
    <>
      <div className="head"><div><h1>Órdenes de trabajo</h1><p>{cuenta.rol === "tec" ? "Abrí una orden para ver el detalle y completar la ficha de trabajo." : "Generadas por mantenimiento, a partir de reportes, preventivos o inspecciones."}</p></div><span className="sp" />
        {can("ot.create") && <button className="btn pri" onClick={() => abrirModal(<M.NuevaOrden />)}>Nueva orden de trabajo</button>}</div>
      <div className="filters"><div className="seg">{[["activas", "Activas"], ["abierta", "Abiertas"], ["curso", "En curso"], ["revisar", "Para revisar"], ["cerrada", "Cerradas"], ["", "Todas"]].map(([k, n]) =>
        <label key={k}><input type="radio" name="otf" value={k} checked={f === k} onChange={() => setF(k)} /><span>{n}</span></label>)}</div></div>
      <section className="panel">{l.length ? (
        <div className="tbl-wrap"><table><thead><tr><th>N°</th><th>Trabajo</th><th>Equipo</th><th>Prioridad</th><th>Asignado</th><th>Creada</th><th>Estado</th></tr></thead><tbody>
          {l.map((o) => (
            <tr className="click" key={o.id} onClick={() => ir("ot-" + o.id)}>
              <td className="mono">{otNum(o.numero)}</td><td>{o.titulo}<div className="small muted">{o.tipo === "preventiva" ? "Preventiva" : "Correctiva"}{o.reporte_id ? " · desde reporte de operario" : ""}</div></td>
              <td><span className="code">{o.equipo}</span><div className="small muted">{d.eq(o.equipo)?.nombre}</div></td><td><Pill map={PRIOR} k={o.prioridad} /></td>
              <td>{o.asignado || "—"}</td><td className="num">{fd(o.creado)}</td><td><Pill map={ESTADOS_OT} k={o.estado} /></td>
            </tr>))}
        </tbody></table></div>) : <p className="empty">No hay órdenes en este estado.</p>}</section>
    </>
  );
}
export function Orden({ id, cuenta }: { id: string; cuenta: Cuenta }) {
  const d = useDatos(); const can = usePuede(cuenta);
  const o = d.ordenes.find((x) => x.id === id);
  if (!o) return <><h1>Orden no encontrada</h1><p><a href="#ordenes">Volver</a></p></>;
  const r = o.reporte_id ? d.reportes.find((x) => x.id === o.reporte_id) : undefined;
  const fichas = d.fichas.filter((f) => f.orden_id === id);
  const horas = fichas.reduce((a, f) => a + (+f.horas || 0), 0), parada = fichas.reduce((a, f) => a + (+f.parada || 0), 0);
  const quien = (x: string | null) => d.cuenta(x)?.nombre;
  return (
    <>
      <div className="head"><div><a href="#ordenes" className="small">← Órdenes</a><h1>{otNum(o.numero)} · {o.titulo}</h1></div><span className="sp" />
        <div className="btns">
          {can("ficha") && o.estado !== "cerrada" && <button className="btn pri" onClick={() => abrirModal(<M.Ficha id={o.id} cuenta={cuenta} />)}>Completar ficha de trabajo</button>}
          {can("ot.manage") && <>
            <button className="btn" onClick={() => abrirModal(<M.EditarOrden id={o.id} />)}>Editar</button>
            {o.estado !== "cerrada" ? <button className="btn" onClick={() => abrirModal(<M.CerrarOrden id={o.id} />)}>Cerrar orden</button>
              : <button className="btn" onClick={async () => { ok(await sb().from("ordenes").update({ estado: "curso" }).eq("id", o.id).select()); await d.recargar("ordenes", "auditoria"); toast("Orden reabierta"); }}>Reabrir</button>}
          </>}
        </div></div>
      <div className="grid g2">
        <section className="panel"><h2>Detalle</h2>
          <div className="form">
            <div className="row">
              <div><div className="label">Estado</div><Pill map={ESTADOS_OT} k={o.estado} /></div><div><div className="label">Prioridad</div><Pill map={PRIOR} k={o.prioridad} /></div>
              <div><div className="label">Tipo</div>{o.tipo === "preventiva" ? "Preventiva" : "Correctiva"}</div><div><div className="label">Asignado a</div>{o.asignado || "Sin asignar"}</div>
            </div>
            <div><div className="label">Equipo</div><a href={"#eq-" + o.equipo} className="code">{o.equipo}</a> {d.eq(o.equipo)?.nombre}</div>
            <div><div className="label">Diagnóstico y tareas indicadas</div><p style={{ whiteSpace: "pre-wrap" }}>{o.descripcion || "—"}</p></div>
            <div className="row">
              <div><div className="label">Creada</div>{fdt(o.creado)}{quien(o.creado_por) && <div className="small muted">por {quien(o.creado_por)}</div>}</div>
              <div><div className="label">Fecha objetivo</div>{fd(o.vence)}</div>
              {o.cerrada && <div><div className="label">Cerrada</div>{fdt(o.cerrada)}{o.cerrada_por_nombre && <div className="small muted">por {o.cerrada_por_nombre}</div>}</div>}
            </div>
            {quien(o.modificado_por) && <p className="small muted">Último cambio: {quien(o.modificado_por)} · {fdt(o.modificado)}</p>}
          </div></section>
        {r && <section className="panel"><h2>Reporte del operario</h2><p><b>{r.tipo}</b> · {r.operario_nombre} · {fdt(r.ts)}</p><p style={{ margin: "8px 0" }}>{r.descripcion}</p><Medios adjuntos={d.adjuntos.filter((a) => a.reporte_id === r.id)} /></section>}
      </div>
      <section className="panel"><div className="panel-h"><h2>Fichas de trabajo</h2><span className="sp" /><span className="muted small num">{nf1.format(horas)} h de trabajo · {nf1.format(parada)} h de máquina parada</span></div>
        {fichas.length ? <div className="timeline">{[...fichas].reverse().map((f) => (
          <div className="tl ot" key={f.id}><div className="d">{fdt(f.fecha)} · {f.tecnico_nombre} · {f.resultado === "terminado" ? "Trabajo terminado" : "Queda pendiente"}</div><div style={{ whiteSpace: "pre-wrap" }}>{f.trabajo}</div>
            <div className="small muted">{nf1.format(f.horas || 0)} h de trabajo{f.parada ? ` · ${nf1.format(f.parada)} h parada` : ""}{f.repuestos ? ` · Repuestos: ${f.repuestos}` : ""}</div></div>))}</div>
          : <p className="empty">Todavía nadie cargó trabajo en esta orden.</p>}
      </section>
    </>
  );
}

/* ---------- Preventivos ---------- */
export function Preventivos({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos(); const can = usePuede(cuenta);
  const [emp, setEmp] = useState("");
  const l = d.preventivos.filter((p) => d.eq(p.equipo)?.estado !== "baja" && (!emp || d.eq(p.equipo)?.empresa === emp)).sort((a, b) => prevNext(a).localeCompare(prevNext(b)));
  return (
    <>
      <div className="head"><div><h1>Mantenimiento preventivo</h1><p>Tareas programadas por frecuencia. El próximo vencimiento se calcula desde la última realización.</p></div><span className="sp" />
        {can("prev.manage") && <button className="btn pri" onClick={() => abrirModal(<M.NuevoPreventivo />)}>Programar preventivo</button>}</div>
      <div className="filters"><select id="f-prevemp" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">Todas las empresas</option>{d.empresas.map((k) => <option key={k.sigla} value={k.sigla}>{k.nombre}</option>)}</select></div>
      <section className="panel">{l.length ? (
        <div className="tbl-wrap"><table><thead><tr><th>Tarea</th><th>Equipo</th><th className="n">Frecuencia</th><th>Última</th><th>Próxima</th><th>Estado</th><th></th></tr></thead><tbody>
          {l.map((p) => { const st = prevStatus(p); return (
            <tr key={p.id}><td>{p.tarea}<div className="small muted">{p.responsable || ""}</div></td><td><a href={"#eq-" + p.equipo} className="code">{p.equipo}</a><div className="small muted">{d.eq(p.equipo)?.nombre}</div></td>
              <td className="n">{p.frecuencia} días</td><td className="num">{fd(p.ultima)}</td><td className="num">{fd(prevNext(p))}</td>
              <td><span className={"pill " + st[1]}>{st[2] < 0 ? `${-st[2]} d vencido` : st[1] === "warn" ? `en ${st[2]} d` : st[0]}</span></td>
              <td><div className="btns">
                {can("prev.do") && <button className="btn sm" onClick={() => abrirModal(<M.RegistrarPreventivo id={p.id} cuenta={cuenta} />)}>Registrar</button>}
                {can("prev.manage") && <button className="btn sm" onClick={() => confirmar("Quitar preventivo", "Se elimina la tarea programada y su registro de realizaciones.", "Quitar", async () => {
                  ok(await sb().from("preventivos").delete().eq("id", p.id).select()); await d.recargar("preventivos", "preventivo_ejecuciones", "auditoria");
                })}>Quitar</button>}
              </div></td></tr>); })}
        </tbody></table></div>) : <p className="empty">No hay preventivos programados.</p>}</section>
    </>
  );
}

/* ---------- Reportes de operarios ---------- */
export function Reportes({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos(); const can = usePuede(cuenta);
  const [f, setF] = useState("activos");
  const l = d.reportes.filter((r) => (f === "activos" ? r.estado === "nuevo" || r.estado === "analisis" : f ? r.estado === f : true));
  const cambiar = async (r: Reporte, st: string) => {
    ok(await sb().from("reportes").update({ estado: st }).eq("id", r.id).select());
    await d.recargar("reportes", "auditoria");
    toast(st === "descartado" ? "Reporte descartado" : "Reporte en análisis");
  };
  return (
    <>
      <div className="head"><div><h1>Reportes de operarios</h1><p>{cuenta.rol === "gm" ? "Revisá fotos y videos, diagnosticá y generá la orden de trabajo." : "Problemas reportados por los operarios en las máquinas."}</p></div></div>
      <div className="filters"><div className="seg">{[["activos", "Sin resolver"], ["nuevo", "Nuevos"], ["analisis", "En análisis"], ["ot", "Con OT"], ["descartado", "Descartados"], ["", "Todos"]].map(([k, n]) =>
        <label key={k}><input type="radio" name="repf" value={k} checked={f === k} onChange={() => setF(k)} /><span>{n}</span></label>)}</div></div>
      {l.length ? l.map((r) => (
        <section className="panel" key={r.id}>
          <div className="panel-h"><div style={{ minWidth: 0 }}><h3>{r.tipo} · {d.eq(r.equipo)?.nombre || r.equipo}</h3>
            <div className="small muted" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><a href={"#eq-" + r.equipo} className="code">{r.equipo}</a><span>{r.operario_nombre}</span><span>{fdt(r.ts)}</span>
              {r.detenida ? <span className="pill crit">Máquina detenida</span> : <span className="pill">Sigue funcionando</span>}</div></div><span className="sp" /><Pill map={ESTADOS_REP} k={r.estado} /></div>
          <p style={{ marginBottom: 10, whiteSpace: "pre-wrap" }}>{r.descripcion}</p>
          <Medios adjuntos={d.adjuntos.filter((a) => a.reporte_id === r.id)} />
          {r.nota && <p className="small" style={{ marginTop: 10 }}><b>Nota de mantenimiento:</b> {r.nota}</p>}
          {r.orden_id && <p className="small" style={{ marginTop: 6 }}><a href={"#ot-" + r.orden_id}>Ver orden de trabajo</a></p>}
          {can("rep.manage") && (r.estado === "nuevo" || r.estado === "analisis") && (
            <div className="btns" style={{ marginTop: 12 }}>
              <button className="btn pri" onClick={() => abrirModal(<M.NuevaOrden reporte={r} />)}>Generar orden de trabajo</button>
              {r.estado === "nuevo" && <button className="btn" onClick={() => cambiar(r, "analisis")}>Marcar en análisis</button>}
              <button className="btn" onClick={() => cambiar(r, "descartado")}>Descartar</button>
            </div>)}
        </section>
      )) : <section className="panel"><p className="empty">No hay reportes en este estado.</p></section>}
    </>
  );
}
