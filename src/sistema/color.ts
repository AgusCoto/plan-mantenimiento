// Cálculos de color: contraste WCAG, variantes (suave, texto sobre el color, modo oscuro)
// y corrección sugerida cuando un texto no se lee.

export type RGB = [number, number, number];
export const esHex = (s: unknown): s is string => typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);

export function rgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export const hex = ([r, g, b]: RGB) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();

export function luminancia(h: string) {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Relación de contraste WCAG entre dos colores (1 a 21). */
export function contraste(a: string, b: string) {
  const la = luminancia(a), lb = luminancia(b);
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
}
export const AA = 4.5;

/** Mezcla a con b (t = cuánto de b). */
export function mezclar(a: string, b: string, t: number) {
  const x = rgb(a), y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

function aHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function deHsl(h: number, s: number, l: number): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}
export function conLuz(h: string, l: number) {
  const [hh, s] = aHsl(rgb(h));
  return hex(deHsl(hh, s, Math.max(0, Math.min(1, l))));
}
export const luz = (h: string) => aHsl(rgb(h))[2];

/** Texto que mejor se lee sobre un color: blanco o casi negro. */
export function textoSobre(fondo: string, oscuro = "#111820", claro = "#FFFFFF") {
  return contraste(claro, fondo) >= contraste(oscuro, fondo) ? claro : oscuro;
}

/**
 * Corrige un color de texto hasta que alcance el contraste pedido sobre un fondo, moviendo solo la luz
 * (conserva el tono). Devuelve null si ya cumple.
 */
export function corregir(texto: string, fondo: string, objetivo = AA): string | null {
  if (contraste(texto, fondo) >= objetivo) return null;
  const haciaOscuro = luminancia(fondo) > 0.18;
  const l0 = luz(texto);
  for (let i = 1; i <= 100; i++) {
    const l = haciaOscuro ? l0 - i / 100 : l0 + i / 100;
    if (l < 0 || l > 1) break;
    const c = conLuz(texto, l);
    if (contraste(c, fondo) >= objetivo) return c;
  }
  return haciaOscuro ? "#000000" : "#FFFFFF";
}

/** Versión de un color de acento para modo oscuro: más clara hasta leerse sobre el fondo oscuro. */
export function paraOscuro(color: string, fondoOscuro: string) {
  return contraste(color, fondoOscuro) >= AA ? color : corregir(color, fondoOscuro, AA) || color;
}
