// Cálculo del plan de preventivos (igual que public.preventivo_estado en la base).
import type { Equipo, Orden, Preventivo, UnidadPreventivo } from "../../datos/tipos";
import { hoy, parseD, ymd, nf } from "../../comun/formato";

export type EstadoPrev = "vencida" | "proxima" | "al_dia" | "sin_datos";
export const ESTADOS_PREV: Record<EstadoPrev, [string, "critico" | "alerta" | "ok" | ""]> = {
  vencida: ["Vencida", "critico"], proxima: ["Próxima", "alerta"], al_dia: ["Al día", "ok"], sin_datos: ["Sin datos", ""],
};
export const ORDEN_ESTADO: EstadoPrev[] = ["vencida", "proxima", "sin_datos", "al_dia"];
export const UNIDADES: Record<UnidadPreventivo, [string, string]> = {
  dias: ["día", "días"], semanas: ["semana", "semanas"], meses: ["mes", "meses"], anios: ["año", "años"], horas: ["hora de uso", "horas de uso"],
};
export const cadaCuanto = (p: Preventivo) => `Cada ${p.frecuencia === 1 ? "" : nf.format(p.frecuencia) + " "}${UNIDADES[p.unidad][p.frecuencia === 1 ? 0 : 1]}`;

function sumar(fecha: string, n: number, u: UnidadPreventivo): Date {
  const d = parseD(fecha)!; const x = new Date(d);
  if (u === "dias") x.setDate(x.getDate() + n);
  else if (u === "semanas") x.setDate(x.getDate() + 7 * n);
  else if (u === "meses") { x.setMonth(x.getMonth() + n); if (x.getDate() !== d.getDate()) x.setDate(0); }
  else { x.setFullYear(x.getFullYear() + n); if (x.getMonth() !== d.getMonth()) x.setDate(0); }
  return x;
}
/** Próxima vez: fecha (tareas por tiempo) u horómetro (tareas por horas de uso). */
export function proxima(p: Preventivo): { fecha?: string; horas?: number } {
  if (p.unidad === "horas") return p.ultima_horas == null ? {} : { horas: Number(p.ultima_horas) + p.frecuencia };
  return p.ultima_fecha ? { fecha: ymd(sumar(p.ultima_fecha, p.frecuencia, p.unidad)) } : {};
}
export function estadoPrev(p: Preventivo, e: Equipo | undefined): EstadoPrev {
  const px = proxima(p);
  if (p.unidad === "horas") {
    const h = e?.horometro;
    if (px.horas == null || h == null) return "sin_datos";
    if (h >= px.horas) return "vencida";
    return h >= px.horas - Number(p.aviso_horas) ? "proxima" : "al_dia";
  }
  if (!px.fecha) return "sin_datos";
  const t = hoy();
  if (t > px.fecha) return "vencida";
  const aviso = new Date(parseD(px.fecha)!); aviso.setDate(aviso.getDate() - p.aviso_dias);
  return t >= ymd(aviso) ? "proxima" : "al_dia";
}
export const ordenAbierta = (ordenes: Orden[], p: Preventivo) =>
  ordenes.find((o) => o.preventivo_id === p.id && ["abierta", "asignada", "esperando_repuesto", "en_curso"].includes(o.estado));
