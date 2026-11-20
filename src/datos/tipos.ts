// Filas de la base (ver supabase/migrations). Fechas y horas llegan como texto ISO.
import type { Perfil, Tokens } from "../sistema/tokens";

interface Control { creado_por: string | null; creado_en: string; modificado_por: string | null; modificado_en: string }
export interface Empresa extends Control { id: string; sigla: string; nombre: string; color: string; activa: boolean; orden: number }
export interface Usuario extends Control { id: string; usuario: string; nombre: string; perfil: Perfil; telefono: string | null; activo: boolean; ejemplo: boolean; eliminado?: boolean }
export interface UsuarioEmpresa { usuario_id: string; empresa_id: string }
export interface Area extends Control { id: string; nombre: string; activa: boolean; orden: number }
export interface CampoTipo { clave: string; etiqueta: string; tipo: "texto" | "numero" | "fecha" | "lista" | "foto"; unidad?: string; opciones?: string[]; obligatorio?: boolean }
export interface TipoEquipo extends Control { sigla: string; nombre: string; icono: string; campos: CampoTipo[]; activo: boolean; orden: number }
export interface ItemLista extends Control { lista: "tipo_falla" | "causa" | "estado_orden" | "destino_baja"; clave: string; nombre: string; color: string | null; icono: string | null; orden: number; activo: boolean }
export interface Config { clave: string; valor: unknown }
export interface Tema extends Control { id: number; version: number; nombre: string; tokens: Tokens; activo: boolean; de_fabrica: boolean; nota: string | null }
export interface Proveedor extends Control { id: string; nombre: string; rubro: string | null; contacto: string | null; telefono: string | null; email: string | null; notas: string | null; activo: boolean }
export type EstadoEquipo = "operativo" | "detenido" | "en_reparacion" | "reparacion_externa" | "baja";
export interface Equipo extends Control {
  id: string; codigo: string; empresa_duena_id: string; tipo: string; numero: number; nombre: string; marca: string | null; modelo: string | null;
  serie: string | null; potencia: string | null; tension: string | null; proveedor_id: string | null; planos: string | null;
  criticidad: "alta" | "media" | "baja"; empresa_ubicacion_id: string; area_id: string | null; ubicacion: string | null; estado: EstadoEquipo;
  campos: Record<string, unknown>; horometro: number | null; horometro_fecha: string | null; notas: string | null; ejemplo: boolean;
}
export interface Alias { alias: string; equipo_id: string }
export interface Documento extends Control { id: string; equipo_id: string; categoria: string; nombre: string; bucket: string | null; ruta: string | null; url: string | null; mime: string | null; bytes: number | null; activo: boolean }
export interface Movimiento extends Control {
  id: string; equipo_id: string; tipo: "prestamo" | "reparacion_externa" | "baja" | "reubicacion"; estado: "solicitado" | "aprobado" | "rechazado" | "en_curso" | "cerrado";
  empresa_origen_id: string | null; area_origen_id: string | null; ubicacion_origen: string | null; empresa_destino_id: string | null; area_destino_id: string | null;
  ubicacion_destino: string | null; motivo: string | null; destino_baja: string | null; proveedor_id: string | null; fecha_salida: string | null;
  fecha_vuelta_prevista: string | null; fecha_vuelta: string | null; presupuesto: number | null; remito: string | null; garantia_hasta: string | null;
  resuelto_por: string | null; resuelto_en: string | null; respuesta: string | null; receptor: string | null; valor_recupero: number | null;
}
export interface Reporte extends Control {
  id: string; equipo_id: string; tipo_falla: string; parada: boolean; texto: string | null; operario_id: string | null;
  estado: "nuevo" | "en_orden" | "descartado"; orden_id: string | null; motivo_descarte: string | null; hecho_en: string;
}
export type EstadoOrden = "abierta" | "asignada" | "esperando_repuesto" | "en_curso" | "terminada" | "verificada" | "cerrada" | "anulada";
export type Prioridad = "urgente" | "alta" | "media" | "baja";
export interface Orden extends Control {
  id: string; numero: number; equipo_id: string; reporte_id: string | null; titulo: string; descripcion: string | null; tipo: "correctiva" | "preventiva" | "mejora";
  estado: EstadoOrden; parada: boolean; prioridad_calculada: Prioridad; prioridad: Prioridad; prioridad_por: string | null; prioridad_en: string | null;
  asignado_a: string | null; contratista_id: string | null; vence: string | null; empresa_cargo_id: string; requiere_verificacion: boolean;
  terminada_en: string | null; cerrada_en: string | null; motivo_anulacion: string | null; preventivo_id?: string | null;
}
export type UnidadPreventivo = "dias" | "semanas" | "meses" | "anios" | "horas";
export interface Preventivo extends Control {
  id: string; equipo_id: string; titulo: string; descripcion: string | null; frecuencia: number; unidad: UnidadPreventivo;
  aviso_dias: number; aviso_horas: number; ultima_fecha: string | null; ultima_horas: number | null; asignado_a: string | null; activo: boolean; ejemplo: boolean;
}
export interface Ficha extends Control {
  id: string; orden_id: string; tecnico_id: string | null; contratista_id: string | null; es_cierre: boolean; trabajo: string; horas: number; horas_parada: number;
  causa: string | null; supervisor_nombre: string | null; firma_ruta: string | null; remito: string | null; hecho_en: string;
}
export interface Costo extends Control { id: string; orden_id: string; tipo: "repuesto" | "servicio" | "otro"; descripcion: string; cantidad: number; costo_unitario: number; proveedor_id: string | null; remito: string | null }
export interface Pedido extends Control {
  id: string; numero: number; orden_id: string | null; equipo_id: string | null; empresa_id: string; descripcion: string; cantidad: number; monto_estimado: number | null;
  proveedor_id: string | null; estado: "pendiente" | "aprobado" | "rechazado" | "recibido" | "anulado"; resuelto_por: string | null; resuelto_en: string | null; respuesta: string | null;
}
export interface Adjunto extends Control { id: string; tabla: string; registro_id: string; bucket: string; ruta: string; tipo: "foto" | "video"; momento: "antes" | "despues" | null; mime: string | null; bytes: number | null; segundos: number | null }
export interface Cambio {
  id: number; ts: string; usuario_id: string | null; nombre: string; perfil: Perfil | null; operacion: string; tabla: string; registro: string | null;
  resumen: string; cambios: Record<string, unknown> | null; aprobo_id: string | null; aprobo_nombre: string | null;
}

export interface Aviso { id: number; usuario_id: string; tipo: string; titulo: string; cuerpo: string | null; url: string | null; creado_en: string; leido_en: string | null; enviado_en: string | null; error: string | null }

export interface Datos {
  empresas: Empresa[]; usuarios: Usuario[]; usuario_empresas: UsuarioEmpresa[]; areas: Area[]; tipos_equipo: TipoEquipo[]; listas: ItemLista[]; config: Config[];
  proveedores: Proveedor[]; equipos: Equipo[]; equipo_alias: Alias[]; documentos: Documento[]; movimientos_equipo: Movimiento[]; reportes_falla: Reporte[];
  ordenes: Orden[]; fichas: Ficha[]; costos_orden: Costo[]; pedidos_compra: Pedido[]; adjuntos: Adjunto[]; registro_cambios: Cambio[]; temas: Tema[]; avisos: Aviso[]; preventivos: Preventivo[];
}
export type Tabla = keyof Datos;
