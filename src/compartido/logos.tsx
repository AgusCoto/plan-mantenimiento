// Logos por área con la W integrada (idénticos al prototipo).
import type { Area } from "./catalogos";

function gearPath(cx: number, cy: number, ro: number, ri: number, n: number) {
  const st = (2 * Math.PI) / n;
  const pt = (r: number, a: number) => (cx + r * Math.cos(a)).toFixed(2) + " " + (cy + r * Math.sin(a)).toFixed(2);
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = i * st - Math.PI / 2;
    d += (i ? "L" : "M") + pt(ri, a - 0.32 * st) + "L" + pt(ro, a - 0.18 * st) + "L" + pt(ro, a + 0.18 * st) + "L" + pt(ri, a + 0.32 * st);
  }
  return d + "Z";
}
const LOGO_GEAR = gearPath(10, 14, 7.6, 5.7, 8);

/** SVG del logo. `mark` y `gold` permiten fijar colores cuando no hay CSS (íconos de la app). */
export function logoSvg(area: Area, colores?: { mark: string; gold: string }) {
  const M = colores ? colores.mark : "var(--mark)";
  const G = colores ? colores.gold : "var(--gold)";
  const S = 'fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const g: Record<Area, string> = {
    /* Llave por detrás del engranaje, y la W grabada en el centro */
    mant: `<path d="M5 19 15.4 8.6" ${S} stroke-width="2.6"/><path d="M15.4 8.6a3.4 3.4 0 0 1 4.3-4.5l-1.9 1.9.4 1.5 1.5.4 1.9-1.9a3.4 3.4 0 0 1-4.5 4.3" ${S}/><path d="${LOGO_GEAR}" fill="${M}" ${S.replace('fill="none" ', "")}/><path d="M7.1 12.3l1.3 3.9 1.6-2.6 1.6 2.6 1.3-3.9" ${S} stroke-width="1.7"/>`,
    /* La línea de tendencia sube dibujando una W y termina en flecha */
    prod: `<path d="M3.5 21h17" ${S}/><path d="M6 21v-2.5M10.5 21v-4M15 21v-5.5M19.5 21v-8" ${S} stroke-width="2.2"/><path d="M3 5.5l3 6.5 3.3-4.6 3.3 4.6L20 3.5" ${S}/><path d="M15.6 3.3h4.6v4.6" ${S}/>`,
    /* La W dentro de la carpeta cierra con un trazo largo, como un tilde */
    admin: `<path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" ${S}/><path d="M6.8 11.4l1.9 4.6 2.4-3.6 2.4 3.6 3.9-6.6" ${S} stroke-width="2"/>`,
    /* La cima de la pirámide es una W dorada y de su pico central sale la bandera */
    dir: `<path d="M2.5 20.5h19M4.5 20.5v-3.4h15v3.4M7.5 17.1v-3.4h9v3.4" ${S}/><path d="M8.2 10.2l1.7 3.5 2.1-2.9 2.1 2.9 1.7-3.5" fill="none" stroke="${G}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 10.8V2.6" ${S} stroke-width="1.5"/><path d="M12 2.8h5.4l-1.5 1.7 1.5 1.7H12z" fill="${G}" stroke="${G}" stroke-width="1" stroke-linejoin="round"/>`,
    /* Casco con la W como escudo en el frente */
    op: `<path d="M4.5 16.2a7.5 7.5 0 0 1 15 0" ${S}/><path d="M2.5 16.2h19v2.6h-19z" ${S}/><path d="M8.8 10.2l1.4 3.9 1.8-2.8 1.8 2.8 1.4-3.9" ${S} stroke-width="1.7"/>`,
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${g[area] || g.mant}</svg>`;
}

export function Mark({ area, size }: { area: Area; size: number }) {
  return <span className="mark" data-area={area} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: logoSvg(area) }} />;
}
