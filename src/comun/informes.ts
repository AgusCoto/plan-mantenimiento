// Documentos en PDF que arma la app con los datos cargados (sin escribir nada a mano):
//   · Remito interno de cada orden de trabajo (constancia del trabajo hecho, al cerrarla).
//   · Informe de intervención externa (un contratista trabajó en el equipo, o el equipo salió a reparar afuera).
// Son documentos internos: no reemplazan al remito ni a la factura fiscal (ARCA).
import { jsPDF } from "jspdf";
import { logoPng } from "./etiquetas";
import { urlFirmada } from "./archivos";
import { fd, fdt, nf, pesos } from "./formato";
import type { useDatos } from "../datos/store";
import type { Adjunto, Movimiento, Orden, Ficha } from "../datos/tipos";
import type { Tokens } from "../sistema/tokens";

type D = ReturnType<typeof useDatos>;
const num4 = (n: number | null | undefined) => (n == null ? "(sin n.º)" : String(n).padStart(4, "0"));

/* ---------- Armado de páginas ---------- */
class Doc {
  pdf = new jsPDF({ unit: "mm", format: "a4" });
  y = 15; readonly m = 15; readonly w = 210 - 30;
  constructor(private pie: string) {}
  espacio(h: number) { if (this.y + h > 282) { this.pdf.addPage(); this.y = 15; } }
  async encabezado(tk: Tokens, titulo: string, numero: string, sub: string) {
    const logo = await logoPng(tk).catch(() => null);
    if (logo) this.pdf.addImage(logo, "PNG", this.m, this.y, 16, 16);
    const x = this.m + (logo ? 20 : 0);
    this.pdf.setFont("helvetica", "bold").setFontSize(15).text(titulo, x, this.y + 6);
    this.pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(90).text(tk.marca.nombre + " · " + sub, x, this.y + 11.5);
    this.pdf.setTextColor(0).setFont("helvetica", "bold").setFontSize(13).text(numero, 195, this.y + 6, { align: "right" });
    this.pdf.setFont("helvetica", "normal").setFontSize(8).setTextColor(90).text("Documento interno · no válido como factura ni remito fiscal", 195, this.y + 11.5, { align: "right" });
    this.pdf.setTextColor(0).setDrawColor(180).line(this.m, this.y + 18, 195, this.y + 18);
    this.y += 24;
  }
  seccion(t: string) {
    this.espacio(12);
    this.pdf.setFont("helvetica", "bold").setFontSize(11).text(t, this.m, this.y);
    this.y += 2; this.pdf.setDrawColor(220).line(this.m, this.y, 195, this.y); this.y += 5;
  }
  datos(filas: [string, string | null | undefined][]) {
    for (const [k, v] of filas) {
      if (v == null || v === "") continue;
      const lineas = this.pdf.setFontSize(9.5).splitTextToSize(v, this.w - 45) as string[];
      this.espacio(lineas.length * 4.6 + 1);
      this.pdf.setFont("helvetica", "normal").setTextColor(100).text(k, this.m, this.y);
      this.pdf.setTextColor(0).text(lineas, this.m + 45, this.y);
      this.y += lineas.length * 4.6 + 0.8;
    }
    this.y += 2;
  }
  parrafo(t: string, chico = false) {
    const lineas = this.pdf.setFont("helvetica", "normal").setFontSize(chico ? 8.5 : 9.5).splitTextToSize(t, this.w) as string[];
    for (const l of lineas) { this.espacio(5); this.pdf.text(l, this.m, this.y); this.y += chico ? 4 : 4.6; }
    this.y += 1.5;
  }
  tabla(cols: { t: string; w: number; der?: boolean }[], filas: string[][], total?: [string, string]) {
    const fila = (celdas: string[], negrita = false) => {
      this.pdf.setFont("helvetica", negrita ? "bold" : "normal").setFontSize(9);
      const partes = celdas.map((c, i) => this.pdf.splitTextToSize(c, cols[i].w - 2) as string[]);
      const h = Math.max(...partes.map((p) => p.length)) * 4.3 + 2;
      this.espacio(h);
      let x = this.m;
      partes.forEach((p, i) => { this.pdf.text(p, cols[i].der ? x + cols[i].w - 1 : x + 1, this.y + 3.5, { align: cols[i].der ? "right" : "left" }); x += cols[i].w; });
      this.y += h; this.pdf.setDrawColor(230).line(this.m, this.y - 0.5, 195, this.y - 0.5);
    };
    fila(cols.map((c) => c.t), true);
    filas.forEach((f) => fila(f));
    if (total) { this.pdf.setFont("helvetica", "bold").setFontSize(10); this.espacio(7); this.pdf.text(total[0], 150, this.y + 4, { align: "right" }); this.pdf.text(total[1], 195, this.y + 4, { align: "right" }); this.y += 8; }
    this.y += 2;
  }
  async fotos(adj: Adjunto[], titulo = "Fotos") {
    const fotos = adj.filter((a) => a.tipo === "foto").slice(0, 8);
    if (!fotos.length) return;
    const imgs = (await Promise.all(fotos.map(async (a) => ({ a, img: await imagen(a.bucket, a.ruta) })))).filter((x) => x.img);
    if (!imgs.length) return;
    this.seccion(titulo);
    const ancho = 42, alto = 32, sep = 4.6;
    imgs.forEach(({ a, img }, i) => {
      const col = i % 4;
      if (col === 0) this.espacio(alto + 10);
      const x = this.m + col * (ancho + sep);
      this.pdf.addImage(img!.url, "JPEG", x, this.y, ancho, alto, undefined, "FAST");
      this.pdf.setFontSize(7.5).setTextColor(100).text(a.momento === "antes" ? "Antes" : a.momento === "despues" ? "Después" : "", x, this.y + alto + 3.5);
      this.pdf.setTextColor(0);
      if (col === 3 || i === imgs.length - 1) this.y += alto + 10;
    });
  }
  async imagenFirma(ruta: string, nombre: string) {
    const img = await imagen("adjuntos", ruta);
    this.espacio(32);
    if (img) this.pdf.addImage(img.url, "JPEG", this.m, this.y, 50, 22);
    this.pdf.setDrawColor(120).line(this.m, this.y + 24, this.m + 70, this.y + 24);
    this.pdf.setFontSize(8.5).text("Verificó: " + nombre + " (supervisor de producción)", this.m, this.y + 28);
    this.y += 32;
  }
  firmas(quienes: string[]) {
    this.espacio(24); this.y += 12;
    const ancho = (this.w - (quienes.length - 1) * 10) / quienes.length;
    quienes.forEach((q, i) => {
      const x = this.m + i * (ancho + 10);
      this.pdf.setDrawColor(120).line(x, this.y, x + ancho, this.y);
      this.pdf.setFontSize(8.5).setTextColor(80).text(q, x, this.y + 4); this.pdf.setTextColor(0);
    });
    this.y += 10;
  }
  terminar() {
    const n = this.pdf.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.pdf.setPage(i).setFontSize(7.5).setTextColor(130);
      this.pdf.text(this.pie, this.m, 290); this.pdf.text(`Página ${i} de ${n}`, 195, 290, { align: "right" });
    }
    return this.pdf.output("blob");
  }
}

/** Foto del almacenamiento como JPEG (achicada) para el PDF. */
async function imagen(bucket: string, ruta: string): Promise<{ url: string } | null> {
  try {
    const u = await urlFirmada(bucket, ruta);
    if (!u) return null;
    const img = await new Promise<HTMLImageElement>((r, j) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => r(i); i.onerror = j; i.src = u; });
    const s = Math.min(1, 900 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    return { url: c.toDataURL("image/jpeg", 0.8) };
  } catch { return null; }
}
const quien = (d: D, f: Ficha) => d.usuarioDe(f.tecnico_id)?.nombre || d.proveedores.find((p) => p.id === f.contratista_id)?.nombre || "—";
const generado = () => "Generado el " + fdt(new Date().toISOString());

/* ---------- Remito interno de una orden de trabajo ---------- */
export async function pdfRemito(d: D, tk: Tokens, o: Orden, otTexto: string): Promise<Blob> {
  const e = d.equipo(o.equipo_id), emp = d.empresa(o.empresa_cargo_id), ubi = d.empresa(e?.empresa_ubicacion_id);
  const fichas = d.fichas.filter((f) => f.orden_id === o.id).sort((a, b) => a.hecho_en.localeCompare(b.hecho_en));
  const cierre = [...fichas].reverse().find((f) => f.es_cierre);
  const costos = d.costos_orden.filter((c) => c.orden_id === o.id);
  const vh = Number(d.conf("valor_hora_tecnico", 0)) || 0;
  const horas = fichas.filter((f) => f.tecnico_id).reduce((a, f) => a + Number(f.horas), 0);
  const parada = fichas.reduce((a, f) => a + Number(f.horas_parada), 0);
  const r = d.reportes_falla.find((x) => x.id === o.reporte_id);
  const doc = new Doc(`Remito interno RI-${num4(o.numero)} · ${otTexto} · ${generado()}`);
  await doc.encabezado(tk, "Remito interno de trabajo", "RI-" + num4(o.numero), otTexto + " · " + (o.cerrada_en ? "cerrada el " + fd(o.cerrada_en) : o.terminada_en ? "terminada el " + fd(o.terminada_en) : "en trámite"));
  doc.seccion("Equipo");
  doc.datos([["Equipo", `${e?.codigo || ""} · ${e?.nombre || ""}`], ["Marca / modelo", [e?.marca, e?.modelo].filter(Boolean).join(" · ")], ["N.º de serie", e?.serie],
    ["Dónde está", [ubi?.nombre, d.areas.find((a) => a.id === e?.area_id)?.nombre, e?.ubicacion].filter(Boolean).join(" · ")], ["Se carga a", emp ? `${emp.sigla} · ${emp.nombre}` : ""]]);
  doc.seccion("Orden de trabajo");
  doc.datos([["Trabajo", o.titulo], ["Descripción", o.descripcion], ["Tipo", { correctiva: "Correctiva", preventiva: "Preventiva", mejora: "Mejora" }[o.tipo]],
    ["Prioridad", o.prioridad.charAt(0).toUpperCase() + o.prioridad.slice(1) + (o.prioridad_por ? ` (confirmada por ${d.usuarioDe(o.prioridad_por)?.nombre || "el jefe"})` : "")], ["Origen", r ? `Reporte de falla de ${d.usuarioDe(r.operario_id)?.nombre || "—"} (${fdt(r.hecho_en)})${r.parada ? ", con la máquina parada" : ""}` : "Cargada por mantenimiento"],
    ["Abierta", fdt(o.creado_en) + " · " + (d.usuarioDe(o.creado_por)?.nombre || "")], ["Terminada", o.terminada_en ? fdt(o.terminada_en) : null], ["Cerrada", o.cerrada_en ? fdt(o.cerrada_en) : null],
    ["Causa de la falla", cierre?.causa ? d.item("causa", cierre.causa)?.nombre || cierre.causa : null]]);
  doc.seccion("Trabajos realizados");
  if (fichas.length) doc.tabla([{ t: "Fecha", w: 28 }, { t: "Quién", w: 35 }, { t: "Trabajo", w: 89 }, { t: "Horas", w: 14, der: true }, { t: "Parada", w: 14, der: true }],
    fichas.map((f) => [fdt(f.hecho_en), quien(d, f) + (f.contratista_id ? " (externo)" : ""), f.trabajo + (f.remito ? ` · Remito ${f.remito}` : "") + (f.es_cierre ? " · CIERRE" : ""), nf.format(Number(f.horas)), nf.format(Number(f.horas_parada))]));
  else doc.parrafo("No se cargaron fichas de trabajo.");
  doc.datos([["Horas de trabajo", nf.format(horas) + " h"], ["Máquina parada", nf.format(parada) + " h"]]);
  doc.seccion("Repuestos, servicios y costos");
  doc.tabla([{ t: "Detalle", w: 92 }, { t: "Tipo", w: 24 }, { t: "Cant.", w: 16, der: true }, { t: "Unitario", w: 24, der: true }, { t: "Subtotal", w: 24, der: true }],
    [["Mano de obra propia", "horas", nf.format(horas), pesos(vh), pesos(horas * vh)],
     ...costos.map((c) => [c.descripcion + (c.remito ? ` · Remito ${c.remito}` : "") + (c.proveedor_id ? ` · ${d.proveedores.find((p) => p.id === c.proveedor_id)?.nombre || ""}` : ""), c.tipo, nf.format(Number(c.cantidad)), pesos(Number(c.costo_unitario)), pesos(Number(c.cantidad) * Number(c.costo_unitario))])],
    ["Total", pesos(horas * vh + costos.reduce((a, c) => a + Number(c.cantidad) * Number(c.costo_unitario), 0))]);
  await doc.fotos(d.adjuntos.filter((a) => a.tabla === "fichas" && fichas.some((f) => f.id === a.registro_id)), "Fotos del trabajo");
  if (cierre?.supervisor_nombre && cierre.firma_ruta) { doc.seccion("Verificación de producción"); await doc.imagenFirma(cierre.firma_ruta, cierre.supervisor_nombre); }
  doc.firmas(["Entregó: mantenimiento (firma y aclaración)", "Recibió conforme: producción (firma y aclaración)"]);
  return doc.terminar();
}

/* ---------- Intervenciones externas ---------- */
export interface Intervencion {
  id: string; tipo: "reparacion_externa" | "contratista"; fecha: string; equipoId: string; quien: string;
  detalle: string; costo: number | null; estado: string; mov?: Movimiento; ficha?: Ficha; orden?: Orden;
}
/** Todos los casos: equipos que salieron a reparar afuera y trabajos de contratistas en planta. */
export function intervenciones(d: D): Intervencion[] {
  const l: Intervencion[] = [];
  for (const m of d.movimientos_equipo.filter((x) => x.tipo === "reparacion_externa"))
    l.push({ id: "m" + m.id, tipo: "reparacion_externa", fecha: m.fecha_salida || m.creado_en, equipoId: m.equipo_id, quien: d.proveedores.find((p) => p.id === m.proveedor_id)?.nombre || "—",
      detalle: m.motivo || "", costo: m.presupuesto != null ? Number(m.presupuesto) : null, estado: m.estado === "en_curso" ? "Fuera de planta" : m.estado === "cerrado" ? "Volvió" : m.estado, mov: m });
  for (const f of d.fichas.filter((x) => x.contratista_id)) {
    const o = d.ordenes.find((x) => x.id === f.orden_id);
    const serv = d.costos_orden.filter((c) => c.orden_id === f.orden_id && c.tipo === "servicio" && (!c.proveedor_id || c.proveedor_id === f.contratista_id));
    l.push({ id: "f" + f.id, tipo: "contratista", fecha: f.hecho_en, equipoId: o?.equipo_id || "", quien: d.proveedores.find((p) => p.id === f.contratista_id)?.nombre || "—",
      detalle: f.trabajo, costo: serv.length ? serv.reduce((a, c) => a + Number(c.cantidad) * Number(c.costo_unitario), 0) : null, estado: f.es_cierre ? "Cierre de la orden" : "Trabajo en planta", ficha: f, orden: o });
  }
  return l.sort((a, b) => b.fecha.localeCompare(a.fecha));
}
export async function pdfIntervencion(d: D, tk: Tokens, x: Intervencion, otAbrev: string): Promise<Blob> {
  const e = d.equipo(x.equipoId), due = d.empresa(e?.empresa_duena_id), ubi = d.empresa(e?.empresa_ubicacion_id);
  const prov = d.proveedores.find((p) => p.id === (x.mov?.proveedor_id || x.ficha?.contratista_id));
  const numero = (x.tipo === "reparacion_externa" ? "RE-" : "CT-") + x.id.slice(1, 9).toUpperCase();
  const doc = new Doc(`Informe de intervención externa ${numero} · ${e?.codigo || ""} · ${generado()}`);
  await doc.encabezado(tk, x.tipo === "reparacion_externa" ? "Informe de reparación externa" : "Informe de trabajo de contratista", numero,
    x.tipo === "reparacion_externa" ? "el equipo salió de planta para repararlo" : "personal externo intervino el equipo");
  doc.seccion("Equipo");
  doc.datos([["Equipo", `${e?.codigo || ""} · ${e?.nombre || ""}`], ["Marca / modelo", [e?.marca, e?.modelo].filter(Boolean).join(" · ")], ["N.º de serie", e?.serie],
    ["Empresa dueña", due ? `${due.sigla} · ${due.nombre}` : ""], ["Dónde está", [ubi?.nombre, e?.ubicacion].filter(Boolean).join(" · ")], ["Criticidad", e?.criticidad]]);
  doc.seccion("Quién intervino");
  doc.datos([["Empresa / taller", prov?.nombre || x.quien], ["Rubro", prov?.rubro], ["Contacto", [prov?.contacto, prov?.telefono, prov?.email].filter(Boolean).join(" · ")]]);
  if (x.mov) {
    const m = x.mov;
    const dias = m.fecha_salida ? Math.round(((m.fecha_vuelta ? new Date(m.fecha_vuelta) : new Date()).getTime() - new Date(m.fecha_salida).getTime()) / 864e5) : null;
    doc.seccion("Reparación externa");
    doc.datos([["Motivo", m.motivo], ["Salida de planta", fd(m.fecha_salida)], ["Vuelta prevista", m.fecha_vuelta_prevista ? fd(m.fecha_vuelta_prevista) : null],
      ["Vuelta", m.fecha_vuelta ? fd(m.fecha_vuelta) : "Todavía no volvió"], ["Días fuera de planta", dias != null ? String(dias) : null],
      [m.fecha_vuelta ? "Costo final" : "Presupuesto", m.presupuesto != null ? pesos(Number(m.presupuesto)) : null], ["Remito", m.remito],
      ["Garantía hasta", m.garantia_hasta ? fd(m.garantia_hasta) : null], ["Registró", d.usuarioDe(m.creado_por)?.nombre]]);
    const ots = d.ordenes.filter((o) => o.equipo_id === m.equipo_id && m.fecha_salida && o.creado_en.slice(0, 10) >= m.fecha_salida.slice(0, 10) && (!m.fecha_vuelta || o.creado_en.slice(0, 10) <= m.fecha_vuelta));
    if (ots.length) { doc.seccion("Órdenes del equipo en ese período"); doc.tabla([{ t: "Orden", w: 24 }, { t: "Trabajo", w: 120 }, { t: "Estado", w: 36 }], ots.map((o) => [otAbrev + "-" + num4(o.numero), o.titulo, d.item("estado_orden", o.estado)?.nombre || o.estado])); }
    await doc.fotos(d.adjuntos.filter((a) => a.tabla === "movimientos_equipo" && a.registro_id === m.id), "Fotos (remito, estado del equipo)");
  }
  if (x.ficha) {
    const f = x.ficha, o = x.orden;
    doc.seccion("Trabajo realizado en planta");
    doc.datos([["Orden de trabajo", o ? `${otAbrev}-${num4(o.numero)} · ${o.titulo}` : null], ["Fecha", fdt(f.hecho_en)], ["Trabajo", f.trabajo], ["Horas", nf.format(Number(f.horas)) + " h"],
      ["Máquina parada", Number(f.horas_parada) ? nf.format(Number(f.horas_parada)) + " h" : null], ["Causa", f.causa ? d.item("causa", f.causa)?.nombre || f.causa : null],
      ["Remito del contratista", f.remito], ["Costo del servicio", x.costo != null ? pesos(x.costo) : null], ["Cargó", d.usuarioDe(f.creado_por)?.nombre]]);
    await doc.fotos(d.adjuntos.filter((a) => a.tabla === "fichas" && a.registro_id === f.id), "Fotos del trabajo");
    if (f.supervisor_nombre && f.firma_ruta) { doc.seccion("Verificación de producción"); await doc.imagenFirma(f.firma_ruta, f.supervisor_nombre); }
  }
  doc.firmas(["Jefe de mantenimiento (firma y aclaración)", "Externo (firma y aclaración)"]);
  return doc.terminar();
}
