// Pantallas que se van sumando por etapa (equipos, órdenes, reportes, movimientos y compras).
import type { ReactNode } from "react";
import type { Perfil } from "../sistema/tokens";
import type { Termino } from "../sistema/vocabulario";
import type { ItemMenu } from "../App";

export function menuExtra(_t: (k: Termino) => string, _c: { nuevos: number }): ItemMenu[] {
  return [];
}
export function rutasExtra(_perfil: Perfil): ReactNode[] {
  return [];
}
