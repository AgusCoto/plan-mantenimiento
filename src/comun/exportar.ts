// Exportar todos los datos: un Excel (.xlsx, una hoja por tabla) o un .zip con un CSV por tabla.
// Se exporta lo que el perfil puede ver; los identificadores internos se reemplazan por nombres legibles
// (empresa → sigla, usuario → nombre, equipo → código, orden → número).
import { zipSync, strToU8 } from "fflate";
import { sb } from "../datos/supabase";
import type { Tabla } from "../datos/tipos";

export const HOJAS: [Tabla, string][] = [
  ["empresas", "Empresas"], ["usuarios", "Usuarios"], ["usuario_empresas", "Accesos"], ["areas", "Áreas"], ["tipos_equipo", "Tipos de equipo"],
  ["listas", "Listas"], ["config", "Configuración"], ["proveedores", "Proveedores"], ["equipos", "Equipos"], ["equipo_alias", "Códigos anteriores"],
  ["documentos", "Documentos"], ["movimientos_equipo", "Movimientos"], ["reportes_falla", "Reportes de falla"], ["ordenes", "Órdenes"],
  ["fichas", "Fichas de trabajo"], ["costos_orden", "Costos"], ["pedidos_compra", "Pedidos de compra"], ["adjuntos", "Fotos y videos"],
  ["registro_cambios", "Registro de cambios"],
];

async function todo(t: string) {
  const filas: Record<string, unknown>[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb().from(t).select("*").range(desde, desde + 999);
    if (error) { if (/permission|row-level|42501/i.test(error.message)) return null; throw error; }
    filas.push(...((data || []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

type Mapa = Map<string, string>;
function legibles(datos: Record<string, Record<string, unknown>[] | null>) {
  const m = (t: string, k: (r: Record<string, unknown>) => string) => new Map((datos[t] || []).map((r) => [String(r.id), k(r)])) as Mapa;
  const usuarios = m("usuarios", (r) => String(r.nombre)), empresas = m("empresas", (r) => String(r.sigla)), equipos = m("equipos", (r) => String(r.codigo));
  const ordenes = m("ordenes", (r) => "OT-" + String(r.numero).padStart(4, "0")), proveedores = m("proveedores", (r) => String(r.nombre)), areas = m("areas", (r) => String(r.nombre));
  const reportes = m("reportes_falla", (r) => (equipos.get(String(r.equipo_id)) || "") + " " + String(r.hecho_en).slice(0, 16).replace("T", " "));
  const col: Record<string, Mapa> = {
    creado_por: usuarios, modificado_por: usuarios, usuario_id: usuarios, operario_id: usuarios, asignado_a: usuarios, tecnico_id: usuarios, resuelto_por: usuarios,
    prioridad_por: usuarios, aprobo_id: usuarios, empresa_id: empresas, empresa_duena_id: empresas, empresa_ubicacion_id: empresas, empresa_origen_id: empresas,
    empresa_destino_id: empresas, empresa_cargo_id: empresas, equipo_id: equipos, orden_id: ordenes, proveedor_id: proveedores, contratista_id: proveedores,
    area_id: areas, area_origen_id: areas, area_destino_id: areas, reporte_id: reportes,
  };
  return (_t: string, k: string, v: unknown) => {
    if (v == null) return "";
    if (k in col) return col[k].get(String(v)) ?? String(v);
    if (typeof v === "object") return JSON.stringify(v);
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) { const d = new Date(v); return isNaN(+d) ? v : d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }); }
    return v as string | number | boolean;
  };
}

export async function juntarDatos(alAvanzar?: (t: string) => void) {
  const datos: Record<string, Record<string, unknown>[] | null> = {};
  for (const [t, n] of HOJAS) { alAvanzar?.(n); datos[t] = await todo(t); }
  const valor = legibles(datos);
  return HOJAS.filter(([t]) => datos[t]).map(([t, nombre]) => {
    const filas = datos[t]!;
    const cols = [...new Set(filas.flatMap((r) => Object.keys(r)))];
    return { nombre, cols, filas: filas.map((r) => cols.map((c) => valor(t, c, r[c]))) };
  });
}
type Hoja = Awaited<ReturnType<typeof juntarDatos>>[number];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colLetra = (i: number) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
function celda(v: unknown, ref: string, estilo = 0) {
  if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${estilo ? ` s="${estilo}"` : ""}><v>${v}</v></c>`;
  if (typeof v === "boolean") return `<c r="${ref}" t="inlineStr"><is><t>${v ? "Sí" : "No"}</t></is></c>`;
  const s = String(v ?? ""); if (!s) return "";
  return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ""}><is><t xml:space="preserve">${esc(s.slice(0, 32000))}</t></is></c>`;
}
/** Excel de verdad (.xlsx), sin bibliotecas externas: una hoja por tabla, con encabezado en negrita y fijo. */
export function xlsx(hojas: Hoja[]): Blob {
  const archivos: Record<string, Uint8Array> = {};
  const nombres = hojas.map((h) => h.nombre.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  archivos["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  archivos["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  archivos["xl/workbook.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  archivos["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  archivos["xl/styles.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`);
  hojas.forEach((h, i) => {
    const filas = [`<row r="1">${h.cols.map((c, j) => celda(c, colLetra(j) + "1", 1)).join("")}</row>`,
      ...h.filas.map((f, k) => `<row r="${k + 2}">${f.map((v, j) => celda(v, colLetra(j) + (k + 2))).join("")}</row>`)];
    archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${filas.join("")}</sheetData>${h.cols.length ? `<autoFilter ref="A1:${colLetra(h.cols.length - 1)}${h.filas.length + 1}"/>` : ""}</worksheet>`);
  });
  return new Blob([zipSync(archivos, { level: 6 })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
/** Un CSV por tabla (separado con «;» y con BOM, como lo abre el Excel en castellano), en un .zip */
export function csvZip(hojas: Hoja[]): Blob {
  const q = (v: unknown) => { const s = typeof v === "boolean" ? (v ? "Sí" : "No") : typeof v === "number" ? String(v).replace(".", ",") : String(v ?? ""); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const archivos: Record<string, Uint8Array> = {};
  for (const h of hojas) archivos[h.nombre + ".csv"] = strToU8("﻿" + [h.cols.map(q).join(";"), ...h.filas.map((f) => f.map(q).join(";"))].join("\r\n"));
  return new Blob([zipSync(archivos, { level: 6 })], { type: "application/zip" });
}
