// Informe semanal (productividad + mantenimiento), pendientes y exportaciones. Mismos cálculos que el prototipo.
import type { useDatos } from "./datos";
import { addDays, weekStart, parseD, sum, prevStatus, fd, fdt, ymd, nf, nf1, money, hrs } from "./formato";
import { ESTADOS_MOV, ESTADOS_OT, PRIOR, TIPOS_MOV } from "./catalogos";
import type { Orden, Ficha, Preventivo, Ejecucion, Movimiento } from "./tipos";
import { esc } from "./qr";

type D = ReturnType<typeof useDatos>;

export const otNum = (n: number) => "OT-" + String(n).padStart(4, "0");
export function sortOT(a: Orden[]) {
  const pr: Record<string, number> = { alta: 0, media: 1, baja: 2 };
  return [...a].sort((x, y) => pr[x.prioridad] - pr[y.prioridad] || y.creado.localeCompare(x.creado));
}

export interface Semana {
  ws: Date; we: Date; movs: Movimiento[]; prod: Movimiento[]; ven: Movimiento[]; com: Movimiento[];
  otNew: Orden[]; otClosed: Orden[]; fichas: (Ficha & { ot: Orden })[]; prevDone: (Ejecucion & { p: Preventivo })[];
  reps: D["reportes"]; horas: number; parada: number; resp: number | null; res: number | null;
}
export function semana(d: D, off: number): Semana {
  const ws = addDays(weekStart(new Date()), 7 * off), we = addDays(ws, 7);
  const inR = (s: string | null | undefined) => { const x = parseD(s); return !!x && x >= ws && x < we; };
  const movs = d.movimientos.filter((m) => inR(m.fecha));
  const otById = new Map(d.ordenes.map((o) => [o.id, o]));
  const pvById = new Map(d.preventivos.map((p) => [p.id, p]));
  const otNew = d.ordenes.filter((o) => inR(o.creado)), otClosed = d.ordenes.filter((o) => o.cerrada && inR(o.cerrada));
  const fichas = d.fichas.filter((f) => inR(f.fecha) && otById.has(f.orden_id)).map((f) => ({ ...f, ot: otById.get(f.orden_id)! }));
  const prevDone = d.preventivo_ejecuciones.filter((x) => inR(x.fecha) && pvById.has(x.preventivo_id)).map((x) => ({ ...x, p: pvById.get(x.preventivo_id)! }));
  const reps = d.reportes.filter((r) => inR(r.ts));
  const resp: number[] = [];
  d.reportes.forEach((r) => { if (r.orden_id) { const o = otById.get(r.orden_id); if (o && inR(o.creado)) resp.push((+parseD(o.creado)! - +parseD(r.ts)!) / 36e5); } });
  const res = otClosed.map((o) => (+parseD(o.cerrada)! - +parseD(o.creado)!) / 36e5);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    ws, we, movs, prod: movs.filter((m) => m.tipo === "produccion"), ven: movs.filter((m) => m.tipo === "venta"), com: movs.filter((m) => m.tipo === "compra"),
    otNew, otClosed, fichas, prevDone, reps, horas: sum(fichas, "horas"), parada: sum(fichas, "parada"), resp: avg(resp), res: avg(res),
  };
}
export function pendientes(d: D) {
  return {
    ots: sortOT(d.ordenes.filter((o) => o.estado !== "cerrada")),
    venc: d.preventivos.filter((p) => prevStatus(p)[1] === "crit" && d.eq(p.equipo)?.estado !== "baja"),
    reps: d.reportes.filter((r) => r.estado === "nuevo" || r.estado === "analisis"),
    movs: d.movimientos.filter((m) => m.estado === "pendiente"),
    det: d.equipos.filter((e) => e.estado === "detenido" || e.estado === "reparacion"),
  };
}

export function informeHtml(d: D, w: Semana) {
  const P = pendientes(d);
  const emps = d.empresas.map((e) => e.sigla);
  const empRows = emps.map((k) => `<tr><td>${esc(d.empN(k))}</td><td class=n>${nf.format(sum(w.prod.filter((m) => m.empresa === k), "cantidad"))}</td><td class=n>${money(sum(w.ven.filter((m) => m.empresa === k), "monto"))}</td><td class=n>${money(sum(w.com.filter((m) => m.empresa === k), "monto"))}</td><td class=n>${d.ordenes.filter((o) => o.estado !== "cerrada" && d.eq(o.equipo)?.empresa === k).length}</td></tr>`).join("");
  const tareas = [
    ...w.fichas.map((f) => [f.fecha, "Correctivo", `${f.ot.titulo} (${otNum(f.ot.numero)})`, f.ot.equipo, f.tecnico_nombre || "", f.trabajo]),
    ...w.prevDone.map((x) => [x.fecha, "Preventivo", x.p.tarea, x.p.equipo, x.tecnico_nombre || "", x.obs || ""]),
  ].sort((a, b) => a[0].localeCompare(b[0]));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe semanal ${fd(ymd(w.ws))}</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:20px auto;padding:0 16px;color:#16202A}h1{font-size:20pt;margin-bottom:0}h2{font-size:14pt;border-bottom:2px solid #0A5AA8;padding-bottom:4px;margin-top:28px}table{width:100%;border-collapse:collapse;font-size:10pt;margin-top:8px}th,td{border-bottom:1px solid #ccc;padding:5px;text-align:left;vertical-align:top}th{background:#EEF1F4}.n{text-align:right}.k{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.k div{border:1px solid #ccc;border-radius:4px;padding:8px}.k b{display:block;font-size:16pt}</style></head><body>
  <h1>Informe semanal del grupo</h1><p>Semana del ${fd(ymd(w.ws))} al ${fd(ymd(addDays(w.we, -1)))} · generado el ${fdt(new Date().toISOString())}</p>
  <h2>Productividad</h2><div class="k"><div><b>${nf.format(sum(w.prod, "cantidad"))}</b>Unidades producidas</div><div><b>${money(sum(w.ven, "monto"))}</b>Ventas</div><div><b>${money(sum(w.com, "monto"))}</b>Compras</div><div><b>${w.movs.filter((m) => m.estado !== "pendiente").length}/${w.movs.length}</b>Registros revisados</div></div>
  <table><tr><th>Empresa</th><th class=n>Unidades</th><th class=n>Ventas</th><th class=n>Compras</th><th class=n>OT abiertas</th></tr>${empRows}</table>
  <h2>Mantenimiento</h2><div class="k"><div><b>${w.otNew.length}</b>OT generadas</div><div><b>${w.otClosed.length}</b>OT cerradas</div><div><b>${w.prevDone.length}</b>Preventivos realizados</div><div><b>${nf1.format(w.horas)} h</b>Trabajo técnico</div><div><b>${nf1.format(w.parada)} h</b>Máquina parada</div><div><b>${w.reps.length}</b>Reportes de operarios</div><div><b>${hrs(w.resp)}</b>Reporte → OT</div><div><b>${hrs(w.res)}</b>OT → cierre</div></div>
  <h2>Tareas realizadas</h2>${tareas.length ? `<table><tr><th>Fecha</th><th>Tipo</th><th>Tarea</th><th>Equipo</th><th>Técnico</th><th>Detalle</th></tr>${tareas.map((t) => `<tr><td>${fd(t[0])}</td><td>${t[1]}</td><td>${esc(t[2])}</td><td>${esc(t[3])}</td><td>${esc(t[4])}</td><td>${esc(t[5])}</td></tr>`).join("")}</table>` : "<p>Sin tareas registradas.</p>"}
  <h2>Pendientes</h2><table><tr><th>Orden</th><th>Equipo</th><th>Prioridad</th><th>Estado</th></tr>${P.ots.map((o) => `<tr><td>${otNum(o.numero)} ${esc(o.titulo)}</td><td>${esc(o.equipo)}</td><td>${PRIOR[o.prioridad][0]}</td><td>${ESTADOS_OT[o.estado][0]}</td></tr>`).join("")}</table>
  <p>Preventivos vencidos: ${P.venc.length} · Reportes sin resolver: ${P.reps.length} · Registros sin revisar: ${P.movs.length} · Equipos fuera de servicio: ${P.det.length}</p>
  </body></html>`;
}

export function csv(d: D, l: Movimiento[]) {
  const head = ["Fecha", "Tipo", "Empresa", "Producto/Ítem", "Cantidad", "Monto", "Cliente/Proveedor", "Turno", "Equipo", "Cargó", "Estado", "Observaciones"];
  const q = (v: unknown) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = l.map((m) => [m.fecha, TIPOS_MOV[m.tipo], d.empN(m.empresa), m.producto, String(m.cantidad).replace(".", ","), m.monto != null ? String(m.monto).replace(".", ",") : "",
    m.contraparte, m.turno, m.equipo, m.operario_nombre, ESTADOS_MOV[m.estado]?.[0], [m.obs, m.nota].filter(Boolean).join(" / ")].map(q).join(";"));
  return "﻿" + [head.join(";"), ...rows].join("\r\n");
}
