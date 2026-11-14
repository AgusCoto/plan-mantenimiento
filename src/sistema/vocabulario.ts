// Términos de la interfaz que se pueden renombrar desde Apariencia sin tocar código
// (por ejemplo «Orden de trabajo» → «OT»). Los tipos de equipo, áreas, tipos de falla, causas y
// estados de orden se renombran en sus propias listas.
export const VOCABULARIO: Record<string, { texto: string; grupo: string }> = {
  orden: { texto: "Orden de trabajo", grupo: "Órdenes" },
  ordenes: { texto: "Órdenes de trabajo", grupo: "Órdenes" },
  orden_abrev: { texto: "OT", grupo: "Órdenes" },
  ficha: { texto: "Ficha de trabajo", grupo: "Órdenes" },
  ficha_cierre: { texto: "Ficha de cierre", grupo: "Órdenes" },
  pedido: { texto: "Pedido de compra", grupo: "Órdenes" },
  pedidos: { texto: "Pedidos de compra", grupo: "Órdenes" },
  reporte: { texto: "Reporte de falla", grupo: "Reportes" },
  reportes: { texto: "Reportes de falla", grupo: "Reportes" },
  reportar: { texto: "Reportar una falla", grupo: "Reportes" },
  equipo: { texto: "Equipo", grupo: "Equipos" },
  equipos: { texto: "Equipos", grupo: "Equipos" },
  chapa: { texto: "Chapa", grupo: "Equipos" },
  horometro: { texto: "Horómetro", grupo: "Equipos" },
  relevamiento: { texto: "Relevamiento", grupo: "Equipos" },
  movimientos: { texto: "Movimientos", grupo: "Equipos" },
  prestamo: { texto: "Préstamo", grupo: "Equipos" },
  reparacion_externa: { texto: "Reparación externa", grupo: "Equipos" },
  panol: { texto: "Pañol", grupo: "Mantenimiento" },
  contratista: { texto: "Contratista", grupo: "Mantenimiento" },
  proveedor: { texto: "Proveedor", grupo: "Mantenimiento" },
  jefe: { texto: "Jefe de mantenimiento", grupo: "Perfiles" },
  encargado: { texto: "Encargado", grupo: "Perfiles" },
  tecnico: { texto: "Técnico", grupo: "Perfiles" },
  operario: { texto: "Operario", grupo: "Perfiles" },
  direccion: { texto: "Dirección", grupo: "Perfiles" },
  supervisor: { texto: "Supervisor de producción", grupo: "Perfiles" },
};
export type Termino = keyof typeof VOCABULARIO;
export const termino = (voc: Record<string, string> | undefined, k: Termino) => (voc && voc[k]) || VOCABULARIO[k]?.texto || k;
