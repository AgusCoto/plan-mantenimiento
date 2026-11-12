// Filas de la base (ver supabase/migrations). Fechas y horas llegan como texto ISO.
import type { Rol } from "./catalogos";

interface Sellos { creado_por: string | null; creado: string; modificado_por: string | null; modificado: string }

export interface Empresa extends Sellos { sigla: string; nombre: string; orden: number }
export interface Area { codigo: string; nombre: string; orden: number }
export interface TipoEquipo { codigo: string; nombre: string; orden: number }
export interface Producto { id: number; empresa: string; nombre: string; orden: number; activo: boolean }
export interface Config { clave: string; valor: unknown }
export interface Cuenta extends Sellos { id: string; usuario: string; nombre: string; rol: Rol; empresa: string | null; activo: boolean; ejemplo: boolean }
export interface Equipo extends Sellos {
  codigo: string; empresa: string; area: string; tipo: string; nombre: string; marca: string | null; modelo: string | null;
  ubicacion: string | null; notas: string | null; estado: string; alta: string; autorizo_id: string | null; ejemplo: boolean;
}
export interface Alias { alias: string; equipo: string }
export interface Evento extends Sellos { id: number; equipo: string; fecha: string; texto: string }
export interface Manual extends Sellos { id: string; equipo: string; nombre: string; bucket: string | null; ruta: string | null; url: string | null; fecha: string }
export interface Orden extends Sellos {
  id: string; numero: number; equipo: string; titulo: string; descripcion: string | null; tipo: string; prioridad: string;
  vence: string | null; asignado: string | null; estado: string; reporte_id: string | null; cerrada: string | null;
  cerrada_por: string | null; cerrada_por_nombre: string | null; ejemplo: boolean;
}
export interface Ficha extends Sellos {
  id: string; orden_id: string; tecnico_id: string | null; tecnico_nombre: string | null; fecha: string; trabajo: string;
  horas: number; parada: number; repuestos: string | null; resultado: string;
}
export interface Preventivo extends Sellos { id: string; equipo: string; tarea: string; frecuencia: number; ultima: string | null; responsable: string | null; ejemplo: boolean }
export interface Ejecucion extends Sellos { id: string; preventivo_id: string; fecha: string; tecnico_id: string | null; tecnico_nombre: string | null; horas: number; obs: string | null }
export interface Reporte extends Sellos {
  id: string; equipo: string; tipo: string; detenida: boolean; descripcion: string; operario_id: string | null; operario_nombre: string | null;
  empresa: string | null; estado: string; nota: string | null; orden_id: string | null; ts: string; ejemplo: boolean;
}
export interface Adjunto extends Sellos { id: string; reporte_id: string; bucket: string; ruta: string; tipo: "foto" | "video"; mime: string | null; bytes: number | null }
export interface Movimiento extends Sellos {
  id: string; tipo: "produccion" | "venta" | "compra"; empresa: string; fecha: string; producto: string; cantidad: number; monto: number | null;
  contraparte: string | null; turno: string | null; equipo: string | null; destino: string | null; obs: string | null; estado: string;
  nota: string | null; revisor_id: string | null; operario_id: string | null; operario_nombre: string | null; ts: string; ejemplo: boolean;
}
export interface Auditoria {
  id: number; ts: string; usuario_id: string | null; nombre: string; rol: Rol | null; operacion: string; tabla: string;
  registro: string | null; resumen: string; cambios: Record<string, unknown> | null; autorizo_id: string | null; autorizo_nombre: string | null;
}

export interface Datos {
  empresas: Empresa[]; areas: Area[]; tipos_equipo: TipoEquipo[]; productos: Producto[]; config: Config[]; cuentas: Cuenta[];
  equipos: Equipo[]; equipo_alias: Alias[]; equipo_eventos: Evento[]; manuales: Manual[]; ordenes: Orden[]; fichas: Ficha[];
  preventivos: Preventivo[]; preventivo_ejecuciones: Ejecucion[]; reportes: Reporte[]; adjuntos: Adjunto[]; movimientos: Movimiento[];
  auditoria: Auditoria[];
}
export type Tabla = keyof Datos;
