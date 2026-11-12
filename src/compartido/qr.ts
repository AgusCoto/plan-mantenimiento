// Códigos QR de los equipos: etiqueta individual (PNG) y hoja de etiquetas para imprimir.
import QRCode from "qrcode";
import { urlEquipo } from "./supabase";
import { fd, hoy } from "./formato";
import type { Equipo } from "./tipos";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const qrDataUrl = (texto: string, size: number) =>
  QRCode.toDataURL(texto, { width: size, margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });

function wrapText(x: CanvasRenderingContext2D, t: string, X: number, Y: number, w: number, lh: number) {
  const ws = String(t).split(" ");
  let line = "";
  for (const wd of ws) {
    const tt = line ? line + " " + wd : wd;
    if (x.measureText(tt).width > w && line) { x.fillText(line, X, Y); Y += lh; line = wd; } else line = tt;
  }
  x.fillText(line, X, Y);
}
const imagen = (src: string) => new Promise<HTMLImageElement>((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = src; });

/** Etiqueta de 900×420 px igual a la del prototipo */
export async function etiquetaPng(e: Equipo, empresa: string, area: string, base?: string | null): Promise<Blob> {
  const c = document.createElement("canvas"); c.width = 900; c.height = 420;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff"; x.fillRect(0, 0, 900, 420); x.strokeStyle = "#16202A"; x.lineWidth = 4; x.strokeRect(6, 6, 888, 408);
  x.drawImage(await imagen(await qrDataUrl(urlEquipo(e.codigo, base), 340)), 40, 40, 340, 340);
  await document.fonts?.ready;
  x.fillStyle = "#16202A"; x.font = "600 44px 'IBM Plex Mono',monospace"; x.fillText(e.codigo, 410, 110);
  x.font = "700 34px Archivo,Arial,sans-serif"; wrapText(x, e.nombre, 410, 170, 450, 40);
  x.font = "26px 'IBM Plex Sans',Arial,sans-serif"; x.fillStyle = "#566472"; x.fillText(empresa, 410, 300); x.fillText(area, 410, 338);
  x.font = "22px 'IBM Plex Sans',Arial,sans-serif"; x.fillText("Escaneá para reportar un problema", 410, 384);
  return new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
}

export async function hojaEtiquetas(l: Equipo[], empN: (s: string) => string, areaN: (s: string) => string, base?: string | null) {
  const cards = await Promise.all(l.map(async (e) =>
    `<div class="l"><img src="${await qrDataUrl(urlEquipo(e.codigo, base), 220)}" alt=""><div><b>${esc(e.codigo)}</b><span>${esc(e.nombre)}</span><small>${esc(empN(e.empresa))} · ${esc(areaN(e.area))}</small></div></div>`));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas QR de equipos</title><style>body{font-family:Arial,sans-serif;margin:10mm}h1{font-size:14pt}.g{display:grid;grid-template-columns:1fr 1fr;gap:6mm}.l{border:1.5px solid #000;border-radius:3mm;padding:3mm;display:flex;gap:4mm;align-items:center;break-inside:avoid}.l img{width:32mm;height:32mm}.l b{font-family:monospace;font-size:12pt;display:block}.l span{display:block;font-size:11pt;margin:1mm 0}.l small{color:#444}</style></head><body><h1>Etiquetas QR · ${l.length} equipos · ${fd(hoy())}</h1><p style="font-size:9pt">Imprimir en papel autoadhesivo o plastificar. Cada QR abre el reporte de problemas del equipo (o su ficha, si quien escanea es de Gestión).</p><div class="g">${cards.join("")}</div></body></html>`;
}
export { esc };
