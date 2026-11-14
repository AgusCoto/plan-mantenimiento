// Ayudas compartidas por las pantallas de órdenes, reportes y compras.
import { useDatos } from "../../datos/store";
import { Pastilla, type ColorEstado } from "../../comun/ui";
import type { Equipo, EstadoOrden, Orden, Prioridad } from "../../datos/tipos";

/** Número de 4 cifras; una orden cargada sin señal todavía no tiene número (lo da el servidor). */
export const num4 = (n: number | null | undefined) => (n == null ? "(sin n.º)" : String(n).padStart(4, "0"));
export const ACTIVAS: EstadoOrden[] = ["abierta", "asignada", "esperando_repuesto", "en_curso"];
export const TERMINADAS: EstadoOrden[] = ["terminada", "verificada"];
export const esActiva = (o: Orden) => ACTIVAS.includes(o.estado);

const C_ESTADO: Record<EstadoOrden, ColorEstado> = {
  abierta: "info", asignada: "info", esperando_repuesto: "alerta", en_curso: "alerta", terminada: "ok", verificada: "ok", cerrada: "", anulada: "",
};
export function EstadoOT({ o }: { o: Orden }) {
  const d = useDatos();
  return <Pastilla c={C_ESTADO[o.estado]}>{d.item("estado_orden", o.estado)?.nombre || o.estado}</Pastilla>;
}
export const PRIORIDADES: Prioridad[] = ["urgente", "alta", "media", "baja"];
export const NOMBRE_PRIORIDAD: Record<Prioridad, string> = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };
export const rangoPrioridad = (p: Prioridad) => PRIORIDADES.indexOf(p);
export function PrioridadOT({ p }: { p: Prioridad }) {
  return <Pastilla c={p === "urgente" ? "critico" : p === "alta" ? "alerta" : ""}>{NOMBRE_PRIORIDAD[p]}</Pastilla>;
}
/** Igual que public.prioridad_de en la base (criticidad del equipo + máquina parada). */
export function prioridadDe(criticidad: string, parada: boolean): Prioridad {
  if (parada) return criticidad === "alta" ? "urgente" : criticidad === "media" ? "alta" : "media";
  return criticidad === "alta" ? "alta" : criticidad === "media" ? "media" : "baja";
}
/** Técnicos y encargados activos con acceso a la empresa dueña o a la empresa donde está el equipo. */
export function tecnicosPara(d: ReturnType<typeof useDatos>, e: Equipo | undefined) {
  const emp = new Set([e?.empresa_duena_id, e?.empresa_ubicacion_id]);
  return d.usuarios.filter((u) => u.activo && ["tecnico", "encargado"].includes(u.perfil)
    && (!e || d.usuario_empresas.some((x) => x.usuario_id === u.id && emp.has(x.empresa_id))));
}
/** Costo total de una orden: horas de las fichas por el valor hora, más repuestos y servicios. */
export function costoOrden(d: ReturnType<typeof useDatos>, ordenId: string) {
  const vh = Number(d.conf("valor_hora_tecnico", 0)) || 0;
  const horas = d.fichas.filter((f) => f.orden_id === ordenId && f.tecnico_id).reduce((a, f) => a + Number(f.horas), 0);
  const items = d.costos_orden.filter((c) => c.orden_id === ordenId);
  const materiales = items.reduce((a, c) => a + Number(c.cantidad) * Number(c.costo_unitario), 0);
  return { horas, valorHora: vh, manoDeObra: horas * vh, materiales, total: horas * vh + materiales, items };
}
export const vencida = (o: Orden) => !!o.vence && esActiva(o) && o.vence < new Date().toISOString().slice(0, 10);
