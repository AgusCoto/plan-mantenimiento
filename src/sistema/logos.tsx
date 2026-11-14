// Biblioteca de logos SVG propios del sistema. Los cinco de área son los del prototipo, con la W
// integrada al dibujo; cada logo de la biblioteca puede dibujarse con o sin la W («integrar la W»).
// Los colores salen de los tokens: el trazo usa el color de texto sobre la marca y el relleno, la marca.
import type { AreaId, Tokens } from "./tokens";

function engranaje(cx: number, cy: number, ro: number, ri: number, n: number) {
  const st = (2 * Math.PI) / n, pt = (r: number, a: number) => (cx + r * Math.cos(a)).toFixed(2) + " " + (cy + r * Math.sin(a)).toFixed(2);
  let d = "";
  for (let i = 0; i < n; i++) { const a = i * st - Math.PI / 2; d += (i ? "L" : "M") + pt(ri, a - 0.32 * st) + "L" + pt(ro, a - 0.18 * st) + "L" + pt(ro, a + 0.18 * st) + "L" + pt(ri, a + 0.32 * st); }
  return d + "Z";
}
const RUEDA = engranaje(10, 14, 7.6, 5.7, 8);
const t = (ancho = 1.8) => `fill="none" stroke="var(--marca-tinta)" stroke-width="${ancho}" stroke-linecap="round" stroke-linejoin="round"`;
const W = (d: string, ancho = 1.7, color = "var(--marca-tinta)") => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${ancho}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Cada logo: dibujo base y la W integrada (o lo que la reemplaza si se elige sin W). */
export const LOGOS: Record<string, { nombre: string; base: string; w: string; sinW: string }> = {
  mant: { nombre: "Llave y engranaje",
    base: `<path d="M5 19 15.4 8.6" ${t(2.6)}/><path d="M15.4 8.6a3.4 3.4 0 0 1 4.3-4.5l-1.9 1.9.4 1.5 1.5.4 1.9-1.9a3.4 3.4 0 0 1-4.5 4.3" ${t()}/><path d="${RUEDA}" fill="var(--marca)" stroke="var(--marca-tinta)" stroke-width="1.8" stroke-linejoin="round"/>`,
    w: W("M7.1 12.3l1.3 3.9 1.6-2.6 1.6 2.6 1.3-3.9"), sinW: `<circle cx="10" cy="14" r="2.2" ${t()}/>` },
  prod: { nombre: "Barras y tendencia",
    base: `<path d="M3.5 21h17" ${t()}/><path d="M6 21v-2.5M10.5 21v-4M15 21v-5.5M19.5 21v-8" ${t(2.2)}/><path d="M15.6 3.3h4.6v4.6" ${t()}/>`,
    w: W("M3 5.5l3 6.5 3.3-4.6 3.3 4.6L20 3.5", 1.8), sinW: W("M3 12l5-4 4 3 8-7.5", 1.8) },
  admin: { nombre: "Carpeta",
    base: `<path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" ${t()}/>`,
    w: W("M6.8 11.4l1.9 4.6 2.4-3.6 2.4 3.6 3.9-6.6", 2), sinW: W("M8 13.5l3 2.5 5-5", 2) },
  dir: { nombre: "Pirámide con bandera",
    base: `<path d="M2.5 20.5h19M4.5 20.5v-3.4h15v3.4M7.5 17.1v-3.4h9v3.4" ${t()}/><path d="M12 10.8V2.6" ${t(1.5)}/><path d="M12 2.8h5.4l-1.5 1.7 1.5 1.7H12z" fill="var(--dorado)" stroke="var(--dorado)" stroke-width="1" stroke-linejoin="round"/>`,
    w: W("M8.2 10.2l1.7 3.5 2.1-2.9 2.1 2.9 1.7-3.5", 1.9, "var(--dorado)"), sinW: W("M9 13.7l3-3.4 3 3.4", 1.9, "var(--dorado)") },
  op: { nombre: "Casco",
    base: `<path d="M4.5 16.2a7.5 7.5 0 0 1 15 0" ${t()}/><path d="M2.5 16.2h19v2.6h-19z" ${t()}/>`,
    w: W("M8.8 10.2l1.4 3.9 1.8-2.8 1.8 2.8 1.4-3.9"), sinW: `<path d="M12 8.7v5" ${t()}/>` },
  escudo: { nombre: "Escudo",
    base: `<path d="M12 2.8 19.5 5.6v5.8c0 4.6-3.2 8.2-7.5 9.8-4.3-1.6-7.5-5.2-7.5-9.8V5.6z" ${t()}/>`,
    w: W("M7.6 9.4l1.8 5.4 2.6-3.8 2.6 3.8 1.8-5.4", 1.9), sinW: W("M8.5 12l2.5 2.5 4.5-5", 1.9) },
  fabrica: { nombre: "Fábrica",
    base: `<path d="M3 20.5V10l5 3V10l5 3V7.5l2-4.5h3l1 4.5v13z" ${t()}/><path d="M2 20.5h20" ${t()}/>`,
    w: W("M6 15.4l1.2 2.9 1.5-2 1.5 2 1.2-2.9", 1.6), sinW: `<path d="M6 16.5h4" ${t()}/>` },
  rayo: { nombre: "Rayo",
    base: `<path d="M13.5 2.5 5 13.5h6l-1.5 8 9-11.5h-6z" ${t()}/>`,
    w: W("M8.5 6.2l1 3 1.3-1.9 1.3 1.9 1-3", 1.3), sinW: "" },
  gota: { nombre: "Gota",
    base: `<path d="M12 2.8c3.6 4.6 6.4 8.2 6.4 11.5a6.4 6.4 0 0 1-12.8 0c0-3.3 2.8-6.9 6.4-11.5z" ${t()}/>`,
    w: W("M8.6 13l1.3 3.6 1.6-2.4 1.6 2.4 1.3-3.6", 1.6), sinW: `<path d="M9.2 15.2a3 3 0 0 0 2.8 2.2" ${t()}/>` },
};

export const logoSvg = (id: string, integrarW = true) => {
  const l = LOGOS[id] || LOGOS.mant;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${l.base}${integrarW ? l.w : l.sinW}</svg>`;
};

/** Logo del área según el tema: SVG propio subido, o uno de la biblioteca (con o sin W). */
export function Logo({ tema, area, tam, titulo }: { tema: Tokens; area: AreaId; tam: number; titulo?: string }) {
  const a = tema.areas[area] || tema.areas.mant;
  return (
    <span className="logo" data-area={area} style={{ width: tam, height: tam }} role={titulo ? "img" : undefined} aria-label={titulo}>
      {a.logo_url ? <img src={a.logo_url} alt="" /> : <span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: logoSvg(a.logo, a.integrar_w) }} />}
    </span>
  );
}
