// Etiquetas de equipos: QR + datos (código, nombre, empresa, área, teléfono de mantenimiento) y logo.
// Vista previa en escala real (milímetros) y PDF para imprimir en hoja A4 o en rollo.
import { useEffect, useState } from "react";
import { jsPDF } from "jspdf";
import { enlaceEquipo, qrDataUrl } from "./qr";
import { logoSvg } from "../sistema/logos";
import { textoSobre } from "../sistema/color";
import type { Tokens } from "../sistema/tokens";

export interface DatosEtiqueta { codigo: string; nombre: string; empresa: string; area: string }
export const MEDIDAS: Record<Tokens["etiqueta"]["tamano"], [number, number]> = { "50x30": [50, 30], "70x40": [70, 40], "100x50": [100, 50] };
// Tamaños de letra (pt) y lado del QR (mm) según el tamaño de la etiqueta
const ESCALA: Record<string, { qr: number; cod: number; nom: number; chico: number }> = {
  "50x30": { qr: 24, cod: 8.5, nom: 6.5, chico: 5.2 }, "70x40": { qr: 32, cod: 11, nom: 8, chico: 6.2 }, "100x50": { qr: 40, cod: 14, nom: 10.5, chico: 7.5 },
};

/** Logo del área de mantenimiento (o el logo del grupo) como PNG, para la etiqueta. */
export async function logoPng(tk: Tokens): Promise<string | null> {
  const a = tk.areas.mant;
  let src = tk.marca.logo_url || a.logo_url;
  if (!src) {
    const svg = logoSvg(a.logo, a.integrar_w).replace(/var\(--marca-tinta\)/g, textoSobre(a.principal)).replace(/var\(--marca\)/g, a.principal)
      .replace(/var\(--dorado\)/g, tk.areas.dir.detalle).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" ');
    src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  try {
    const img = await new Promise<HTMLImageElement>((r, j) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => r(i); i.onerror = j; i.src = src!; });
    const c = document.createElement("canvas"); c.width = 200; c.height = 200;
    const x = c.getContext("2d")!;
    if (!tk.marca.logo_url) { x.fillStyle = a.principal; x.fillRect(0, 0, 200, 200); }
    const e = Math.min(180 / img.width, 180 / img.height);
    x.drawImage(img, (200 - img.width * e) / 2, (200 - img.height * e) / 2, img.width * e, img.height * e);
    return c.toDataURL("image/png");
  } catch { return null; }
}

/** Vista previa en escala real (1 mm de pantalla ≈ 1 mm de etiqueta, según la pantalla). */
export function EtiquetaVista({ d, tk, telefono }: { d: DatosEtiqueta; tk: Tokens; telefono: string }) {
  const [qr, setQr] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => { qrDataUrl(enlaceEquipo(d.codigo)).then(setQr); }, [d.codigo]);
  useEffect(() => { if (tk.etiqueta.logo) logoPng(tk).then(setLogo); }, [tk]);
  const [w, h] = MEDIDAS[tk.etiqueta.tamano], e = ESCALA[tk.etiqueta.tamano], c = tk.etiqueta.campos;
  // Colores fijos a propósito: la etiqueta se imprime en blanco y negro, igual en modo claro u oscuro
  return (
    <div role="img" aria-label={`Etiqueta de ${d.codigo}`} style={{ width: `${w}mm`, height: `${h}mm`, background: "#FFFFFF", color: "#000000", border: "0.3mm solid #000000",
      borderRadius: "2mm", display: "flex", gap: "2mm", padding: "2mm", alignItems: "center", fontFamily: "Arial, sans-serif", overflow: "hidden", flex: "none" }}>
      {qr && <img src={qr} alt="" style={{ width: `${e.qr}mm`, height: `${e.qr}mm`, flex: "none" }} />}
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: "0.6mm", lineHeight: 1.1 }}>
        {c.includes("codigo") && <b style={{ fontFamily: "'Courier New', monospace", fontSize: `${e.cod}pt` }}>{d.codigo}</b>}
        {c.includes("nombre") && <span style={{ fontSize: `${e.nom}pt`, fontWeight: 700, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{d.nombre}</span>}
        {c.includes("empresa") && <span style={{ fontSize: `${e.chico}pt` }}>{d.empresa}</span>}
        {c.includes("area") && d.area && <span style={{ fontSize: `${e.chico}pt` }}>{d.area}</span>}
        {c.includes("telefono") && telefono && <span style={{ fontSize: `${e.chico}pt` }}>Mantenimiento: {telefono}</span>}
      </div>
      {tk.etiqueta.logo && logo && <img src={logo} alt="" style={{ width: `${e.qr / 3.2}mm`, height: `${e.qr / 3.2}mm`, alignSelf: "flex-start", flex: "none", borderRadius: "1mm" }} />}
    </div>
  );
}

/** PDF de etiquetas: hoja A4 con todas las que entran, o rollo (una por página, del tamaño de la etiqueta). */
export async function pdfEtiquetas(lista: DatosEtiqueta[], tk: Tokens, telefono: string): Promise<Blob> {
  const [w, h] = MEDIDAS[tk.etiqueta.tamano], e = ESCALA[tk.etiqueta.tamano], c = tk.etiqueta.campos;
  const rollo = tk.etiqueta.hoja === "rollo";
  const doc = rollo ? new jsPDF({ unit: "mm", format: [w, h], orientation: w > h ? "landscape" : "portrait" }) : new jsPDF({ unit: "mm", format: "a4" });
  const logo = tk.etiqueta.logo ? await logoPng(tk) : null;
  const margen = 8, sep = 3;
  const cols = rollo ? 1 : Math.max(1, Math.floor((210 - 2 * margen + sep) / (w + sep)));
  const filas = rollo ? 1 : Math.max(1, Math.floor((297 - 2 * margen + sep) / (h + sep)));
  const pt = (p: number) => p * 0.3528; // puntos a milímetros
  for (let i = 0; i < lista.length; i++) {
    const pos = i % (cols * filas);
    if (i > 0 && pos === 0) doc.addPage(rollo ? [w, h] : "a4", rollo ? (w > h ? "landscape" : "portrait") : "portrait");
    const x = rollo ? 0 : margen + (pos % cols) * (w + sep), y = rollo ? 0 : margen + Math.floor(pos / cols) * (h + sep);
    const d = lista[i];
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.roundedRect(x + 0.2, y + 0.2, w - 0.4, h - 0.4, 2, 2);
    doc.addImage(await qrDataUrl(enlaceEquipo(d.codigo), 600), "PNG", x + 2, y + (h - e.qr) / 2, e.qr, e.qr);
    const tx = x + 4 + e.qr, ancho = w - e.qr - 6 - (logo ? e.qr / 3.2 + 1 : 0);
    let ty = y + 3;
    const linea = (txt: string, tam: number, fuente: "helvetica" | "courier", estilo: "normal" | "bold", max = 1) => {
      doc.setFont(fuente, estilo); doc.setFontSize(tam);
      const partes = (doc.splitTextToSize(txt, ancho) as string[]).slice(0, max);
      for (const p of partes) { ty += pt(tam) * 1.05; doc.text(p, tx, ty); }
      ty += pt(tam) * 0.25;
    };
    if (c.includes("codigo")) linea(d.codigo, e.cod, "courier", "bold");
    if (c.includes("nombre")) linea(d.nombre, e.nom, "helvetica", "bold", 2);
    if (c.includes("empresa")) linea(d.empresa, e.chico, "helvetica", "normal");
    if (c.includes("area") && d.area) linea(d.area, e.chico, "helvetica", "normal");
    if (c.includes("telefono") && telefono) linea("Mantenimiento: " + telefono, e.chico, "helvetica", "normal");
    if (logo) doc.addImage(logo, "PNG", x + w - 2 - e.qr / 3.2, y + 2, e.qr / 3.2, e.qr / 3.2);
  }
  return doc.output("blob");
}
