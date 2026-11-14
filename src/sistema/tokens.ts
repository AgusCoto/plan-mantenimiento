// Tokens de diseño: tipos, valores de fábrica y cálculo de las variables CSS.
// Ningún componente usa colores, tipografías ni medidas escritos a mano: todo sale de acá.
import fabrica from "./fabrica.json";
import { AA, contraste, esHex, mezclar, paraOscuro, textoSobre, corregir } from "./color";

export type Modo = "claro" | "oscuro";
export type AreaId = "mant" | "prod" | "admin" | "dir" | "op";
export type Perfil = "jefe" | "encargado" | "tecnico" | "operario" | "direccion";
export interface Base { fondo: string; superficie: string; superficie_2: string; tinta: string; tinta_suave: string; linea: string; placa: string; placa_borde: string }
export interface Estados { ok: string; alerta: string; critico: string; sin_datos: string }
export interface AreaTokens { nombre: string; principal: string; detalle: string; barra: string; logo: string; logo_url: string | null; integrar_w: boolean }
export interface Tokens {
  marca: { nombre: string; logo_url: string | null; icono_192: string | null; icono_512: string | null; fondo_carga: string };
  modo: "claro" | "oscuro" | "sistema";
  colores: Record<Modo, Base>;
  estados: Record<Modo, Estados>;
  areas: Record<AreaId, AreaTokens>;
  perfil_area: Record<Perfil, AreaId>;
  fuentes: { titulos: string; texto: string; codigos: string; tamano: "chico" | "normal" | "grande" };
  forma: { radio: "recto" | "suave" | "redondeado"; densidad: "compacta" | "comoda" | "auto"; borde: number; franja: "rayada" | "lisa" | "oculta" };
  vocabulario: Record<string, string>;
  etiqueta: { tamano: "50x30" | "70x40" | "100x50"; campos: string[]; logo: boolean; hoja: "a4" | "rollo" };
  informes: { secciones: string[]; destinatarios: string[]; dia: string; hora: string };
  oficina: { tarjetas: string[]; empresas: string[]; rotacion_seg: number; tamano_texto: "normal" | "grande" | "enorme" };
}
export const FABRICA = fabrica as Tokens;
export const AREAS: AreaId[] = ["mant", "prod", "admin", "dir", "op"];

/** Completa un tema guardado con los valores de fábrica que falten (temas viejos o importados a medias). */
export function completar(t: Partial<Tokens> | null | undefined): Tokens {
  const f = FABRICA;
  const x = (t || {}) as Partial<Tokens>;
  const areas = { ...f.areas } as Tokens["areas"];
  for (const a of AREAS) areas[a] = { ...f.areas[a], ...(x.areas?.[a] || {}) };
  return {
    ...f, ...x,
    marca: { ...f.marca, ...(x.marca || {}) },
    colores: { claro: { ...f.colores.claro, ...(x.colores?.claro || {}) }, oscuro: { ...f.colores.oscuro, ...(x.colores?.oscuro || {}) } },
    estados: { claro: { ...f.estados.claro, ...(x.estados?.claro || {}) }, oscuro: { ...f.estados.oscuro, ...(x.estados?.oscuro || {}) } },
    areas,
    perfil_area: { ...f.perfil_area, ...(x.perfil_area || {}) },
    fuentes: { ...f.fuentes, ...(x.fuentes || {}) },
    forma: { ...f.forma, ...(x.forma || {}) },
    vocabulario: { ...(x.vocabulario || {}) },
    etiqueta: { ...f.etiqueta, ...(x.etiqueta || {}) },
    informes: { ...f.informes, ...(x.informes || {}) },
    oficina: { ...f.oficina, ...(x.oficina || {}) },
  };
}

/* ---------- Tipografías (lista curada de Google Fonts, con fuentes de respaldo) ---------- */
export const FUENTES: { nombre: string; uso: ("titulos" | "texto" | "codigos")[]; pesos: string; respaldo: string }[] = [
  { nombre: "Archivo", uso: ["titulos", "texto"], pesos: "500;700;800", respaldo: '"Helvetica Neue", Arial, sans-serif' },
  { nombre: "IBM Plex Sans", uso: ["titulos", "texto"], pesos: "400;500;600;700", respaldo: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { nombre: "IBM Plex Mono", uso: ["codigos"], pesos: "500;600", respaldo: "ui-monospace, Menlo, Consolas, monospace" },
  { nombre: "Barlow", uso: ["titulos", "texto"], pesos: "400;500;600;700;800", respaldo: "Arial, sans-serif" },
  { nombre: "Barlow Condensed", uso: ["titulos"], pesos: "600;700;800", respaldo: '"Arial Narrow", Arial, sans-serif' },
  { nombre: "Oswald", uso: ["titulos"], pesos: "500;600;700", respaldo: '"Arial Narrow", Arial, sans-serif' },
  { nombre: "Inter", uso: ["titulos", "texto"], pesos: "400;500;600;700;800", respaldo: "system-ui, Arial, sans-serif" },
  { nombre: "Roboto", uso: ["titulos", "texto"], pesos: "400;500;700", respaldo: "Arial, sans-serif" },
  { nombre: "Source Sans 3", uso: ["texto"], pesos: "400;600;700", respaldo: "Arial, sans-serif" },
  { nombre: "Atkinson Hyperlegible", uso: ["titulos", "texto"], pesos: "400;700", respaldo: "Arial, sans-serif" },
  { nombre: "Roboto Mono", uso: ["codigos"], pesos: "500;600", respaldo: "ui-monospace, Menlo, Consolas, monospace" },
  { nombre: "JetBrains Mono", uso: ["codigos"], pesos: "500;600", respaldo: "ui-monospace, Menlo, Consolas, monospace" },
  { nombre: "Space Mono", uso: ["codigos"], pesos: "400;700", respaldo: "ui-monospace, Menlo, Consolas, monospace" },
];
const fuente = (n: string) => FUENTES.find((f) => f.nombre === n);
export const pilaFuente = (n: string, por: "titulos" | "texto" | "codigos") =>
  `"${n}", ${fuente(n)?.respaldo || (por === "codigos" ? "ui-monospace, Menlo, monospace" : "system-ui, Arial, sans-serif")}`;

/** Carga desde Google Fonts las tipografías del tema (una sola vez cada combinación). */
export function cargarFuentes(t: Tokens) {
  const familias = [...new Set([t.fuentes.titulos, t.fuentes.texto, t.fuentes.codigos])]
    .map((n) => fuente(n)).filter(Boolean)
    .map((f) => "family=" + encodeURIComponent(f!.nombre).replace(/%20/g, "+") + ":wght@" + f!.pesos);
  if (!familias.length) return;
  const href = "https://fonts.googleapis.com/css2?" + familias.join("&") + "&display=swap";
  if (document.querySelector(`link[data-fuentes="${href}"]`)) return;
  document.querySelectorAll("link[data-fuentes]").forEach((l) => l.remove());
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = href; l.dataset.fuentes = href;
  document.head.appendChild(l);
}

/* ---------- Variables CSS ---------- */
export interface Opciones { modo: Modo; area: AreaId; empresas?: { sigla: string; color: string }[]; tamano?: "chico" | "normal" | "grande" | null; tactil?: boolean }

export function variables(tk: Tokens, o: Opciones): Record<string, string> {
  const t = completar(tk);
  const c = t.colores[o.modo], e = t.estados[o.modo], a = t.areas[o.area] || t.areas.mant;
  const oscuro = o.modo === "oscuro";
  // En modo oscuro, el acento se aclara hasta leerse sobre el fondo
  const acento = oscuro ? paraOscuro(a.principal, c.superficie) : a.principal;
  const detalle = oscuro ? paraOscuro(a.detalle, c.superficie) : a.detalle;
  const barra = oscuro ? mezclar(a.barra, "#000000", 0.25) : a.barra;
  const v: Record<string, string> = {
    "--fondo": c.fondo, "--superficie": c.superficie, "--superficie-2": c.superficie_2, "--tinta": c.tinta, "--tinta-suave": c.tinta_suave,
    "--linea": c.linea, "--placa": c.placa, "--placa-borde": c.placa_borde,
    "--acento": acento, "--acento-tinta": textoSobre(acento), "--acento-suave": mezclar(acento, c.superficie, oscuro ? 0.8 : 0.86),
    "--detalle": detalle, "--marca": a.principal, "--marca-tinta": textoSobre(a.principal), "--dorado": t.areas.dir.detalle,
    "--barra": barra, "--barra-tinta": textoSobre(barra), "--barra-tinta-suave": textoSobre(barra) === "#FFFFFF" ? "rgba(255,255,255,.74)" : "rgba(17,24,32,.7)",
    "--franja-1": acento, "--franja-2": o.area === "op" ? barra : detalle,
    "--f-titulos": pilaFuente(t.fuentes.titulos, "titulos"), "--f-texto": pilaFuente(t.fuentes.texto, "texto"), "--f-codigos": pilaFuente(t.fuentes.codigos, "codigos"),
    "--t-base": { chico: "14px", normal: "15px", grande: "17px" }[o.tamano || t.fuentes.tamano] || "15px",
    "--borde": Math.max(0, Math.min(4, Number(t.forma.borde) || 1)) + "px",
    "--toque": "48px",
  };
  for (const [k, col] of Object.entries(e) as [keyof Estados, string][]) {
    const nombre = k.replace("_", "-");
    v[`--${nombre}`] = col;
    v[`--${nombre}-suave`] = mezclar(col, c.superficie, oscuro ? 0.78 : 0.86);
  }
  const r = { recto: [0, 0, 0], suave: [4, 6, 10], redondeado: [8, 12, 18] }[t.forma.radio] || [4, 6, 10];
  v["--r-s"] = r[0] + "px"; v["--r-m"] = r[1] + "px"; v["--r-l"] = r[2] + "px";
  v["--r-pildora"] = t.forma.radio === "recto" ? "0px" : "999px";
  const dens = t.forma.densidad === "auto" ? (o.tactil ? "comoda" : "compacta") : t.forma.densidad;
  v["--esp"] = dens === "comoda" ? "1.15" : "0.9";
  v["--franja-alto"] = t.forma.franja === "oculta" ? "0px" : "5px";
  v["--franja"] = t.forma.franja === "rayada"
    ? "repeating-linear-gradient(-45deg, var(--franja-1) 0 9px, var(--franja-2) 9px 18px)"
    : "var(--franja-1)";
  for (const emp of o.empresas || []) {
    if (esHex(emp.color)) v[`--emp-${emp.sigla}`] = oscuro ? paraOscuro(emp.color, c.superficie) : emp.color;
  }
  return v;
}
export function aplicar(el: HTMLElement, vars: Record<string, string>) {
  for (const [k, val] of Object.entries(vars)) el.style.setProperty(k, val);
}

/* ---------- Revisión de contraste (la misma que hace la base al guardar, más los colores de área) ---------- */
export interface Problema { modo: Modo; par: string; contraste: number; texto: string; fondo: string; sugerido: string | null; ruta?: string }
export function revisarContraste(tk: Tokens): Problema[] {
  const t = completar(tk);
  const res: Problema[] = [];
  for (const m of ["claro", "oscuro"] as Modo[]) {
    const c = t.colores[m];
    const pares: [string, string, string, string?][] = [
      ["Texto sobre el fondo", c.tinta, c.fondo, `colores.${m}.tinta`],
      ["Texto sobre las tarjetas", c.tinta, c.superficie, `colores.${m}.tinta`],
      ["Texto secundario sobre las tarjetas", c.tinta_suave, c.superficie, `colores.${m}.tinta_suave`],
      ["Código de equipo sobre la placa", c.tinta, c.placa, `colores.${m}.tinta`],
    ];
    for (const [k, col] of Object.entries(t.estados[m])) pares.push([`Estado «${k.replace("_", " ")}» sobre las tarjetas`, col, c.superficie, `estados.${m}.${k}`]);
    for (const a of AREAS) {
      const ar = t.areas[a];
      const acento = m === "oscuro" ? paraOscuro(ar.principal, c.superficie) : ar.principal;
      pares.push([`${ar.nombre}: texto de los botones`, textoSobre(acento), acento]);
      pares.push([`${ar.nombre}: texto de la barra`, textoSobre(ar.barra), ar.barra]);
      if (m === "claro") pares.push([`${ar.nombre}: enlaces y acentos sobre las tarjetas`, ar.principal, c.superficie, `areas.${a}.principal`]);
    }
    for (const [nombre, tx, fo, ruta] of pares) {
      if (!esHex(tx) || !esHex(fo)) continue;
      const k = contraste(tx, fo);
      if (k < AA) res.push({ modo: m, par: nombre, contraste: k, texto: tx, fondo: fo, sugerido: ruta ? corregir(tx, fo) : null, ruta });
    }
  }
  return res;
}
