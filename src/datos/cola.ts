// Cola de envíos: toda carga pasa por acá. Con señal se envía al momento; sin señal (o si la red
// falla a mitad de camino) queda guardada en el celular (IndexedDB), con sus fotos, y se envía sola
// al volver la señal, en el mismo orden en que se hizo.
// · Los registros nuevos llevan su id generado en el celular: reenviar lo mismo no duplica.
// · Ediciones: gana la última modificación. Si alguien cambió el mismo registro mientras este
//   celular estaba sin señal, se registra el conflicto en el registro de cambios.
// · Lo que el servidor rechaza (por permisos o reglas) queda a la vista como «rechazado» para revisarlo.
import { useEffect, useState } from "react";
import { sb, mensajeError, falla } from "./supabase";
import { baseLocal } from "./local";

export interface Op {
  id: string; ts: number; usuario: string; etiqueta: string;
  tipo: "insertar" | "actualizar" | "llamar" | "subir";
  tabla?: string; fila?: Record<string, unknown>;
  registro?: string; clave?: string; cambios?: Record<string, unknown>; base?: string | null;
  fn?: string; args?: Record<string, unknown>;
  bucket?: string; ruta?: string; mime?: string;
  error?: string; intentos: number;
}

/* ---------- Estado y avisos a la pantalla ---------- */
let ops: Op[] = [];
let usuarioActual = "";
let cargada = false;
let version = 0;
const escuchas = new Set<() => void>();
const avisarCambio = () => { version++; escuchas.forEach((f) => f()); };
const mias = () => ops.filter((o) => o.usuario === usuarioActual);
export function estadoCola() {
  const m = mias();
  return { ops: m, version, cantidad: m.filter((o) => !o.error).length, rechazadas: m.filter((o) => o.error).length };
}
export function useCola() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((x) => x + 1); escuchas.add(f); return () => { escuchas.delete(f); }; }, []);
  return estadoCola();
}
/** Compatibilidad con la barra de conexión */
export const usePendientes = useCola;

/** El almacén de datos registra cómo buscar una fila (para saber qué versión se editó) y qué hacer al sincronizar. */
let buscarFila: (tabla: string, clave: string, valor: string) => Record<string, unknown> | undefined = () => undefined;
let alSincronizar: () => void = () => {};
export function conectarDatos(usuarioId: string, buscar: typeof buscarFila, sincronizado: () => void) {
  usuarioActual = usuarioId; buscarFila = buscar; alSincronizar = sincronizado;
  cargar().then(() => sincronizar());
}

async function cargar() {
  if (cargada) return;
  try { ops = ((await (await baseLocal()).getAll("cola")) as Op[]).sort((a, b) => a.ts - b.ts); } catch { ops = []; }
  cargada = true; avisarCambio();
}
async function guardarOp(o: Op, archivo?: Blob) {
  ops = [...ops.filter((x) => x.id !== o.id), o].sort((a, b) => a.ts - b.ts);
  avisarCambio();
  try {
    const db = await baseLocal();
    if (archivo) await db.put("archivos", archivo, o.id);
    await db.put("cola", o);
  } catch { /* sin espacio: queda en memoria mientras la app siga abierta */ }
}
async function quitarOp(id: string) {
  ops = ops.filter((x) => x.id !== id); avisarCambio();
  try { const db = await baseLocal(); await db.delete("cola", id); await db.delete("archivos", id); } catch { /* */ }
}

/* ---------- ¿Falta de señal o rechazo del servidor? ---------- */

const textoDe = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e ?? ""));
export function esFaltaDeSenal(e: unknown, status?: number) {
  // 401: el permiso de acceso venció y se renueva al volver la señal (no es un rechazo)
  if (status === 0 || status === 401 || status === 502 || status === 503 || status === 504) return true;
  return /Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|ERR_INTERNET|ERR_NAME|ECONNREFUSED|timed? ?out|JWT expired|invalid JWT/i.test(textoDe(e));
}
const yaExiste = (e: unknown) => /duplicate key|already exists|23505|Duplicate/i.test(textoDe(e) + " " + JSON.stringify(e ?? ""));
const nuevo = () => crypto.randomUUID();
const conSenal = () => typeof navigator === "undefined" || navigator.onLine;

/* ---------- Ejecutar una operación contra el servidor ---------- */
async function ejecutar(o: Op, archivo?: Blob | null): Promise<unknown> {
  if (o.tipo === "insertar") {
    const r = await sb().from(o.tabla!).insert(o.fila!).select().single();
    if (r.error) { if (yaExiste(r.error)) return o.fila; throw { e: r.error, status: r.status }; }
    return r.data;
  }
  if (o.tipo === "actualizar") {
    // Gana la última modificación; si el servidor cambió desde que este celular leyó el registro, queda registrado
    if (o.base !== undefined) {
      const act = await sb().from(o.tabla!).select("modificado_en").eq(o.clave!, o.registro!).maybeSingle();
      if (act.error) throw { e: act.error, status: act.status };
      const srv = (act.data as { modificado_en?: string } | null)?.modificado_en;
      if (srv && o.base && Date.parse(srv) > Date.parse(o.base)) {
        const ganaServidor = Date.parse(srv) > o.ts;
        await sb().rpc("registrar_conflicto", { p_tabla: o.tabla, p_registro: o.registro, p_detalle: {
          cambios_de_este_celular: o.cambios, hechos_en: new Date(o.ts).toISOString(), version_leida: o.base, version_del_servidor: srv,
          gano: ganaServidor ? "la modificación del servidor (es más nueva)" : "la modificación de este celular (es más nueva)" } });
        if (ganaServidor) return null;
      }
    }
    const r = await sb().from(o.tabla!).update(o.cambios!).eq(o.clave!, o.registro!).select();
    if (r.error) throw { e: r.error, status: r.status };
    if (!r.data?.length) throw { e: falla("No se pudo guardar: tu perfil no tiene permiso o el registro no existe.") };
    return r.data[0];
  }
  if (o.tipo === "llamar") {
    const r = await sb().rpc(o.fn!, o.args);
    if (r.error) throw { e: r.error, status: r.status };
    return r.data;
  }
  // subir
  const blob = archivo ?? (await (await baseLocal()).get("archivos", o.id) as Blob | undefined);
  if (!blob) throw { e: falla("Se perdió el archivo guardado en el celular.") };
  const r = await sb().storage.from(o.bucket!).upload(o.ruta!, blob, { contentType: o.mime || blob.type || "application/octet-stream" });
  if (r.error && !yaExiste(r.error)) throw { e: r.error, status: (r.error as { statusCode?: string }).statusCode ? Number((r.error as { statusCode?: string }).statusCode) : undefined };
  return o.ruta;
}

/** Con señal y sin nada pendiente, se envía ya; si no, queda en la cola (y se devuelve lo cargado, marcado como pendiente). */
async function enviarOEncolar(o: Op, local: unknown, archivo?: Blob) {
  await cargar();
  const hayPendientes = mias().some((x) => !x.error);
  if (conSenal() && !hayPendientes) {
    try { return await ejecutar(o, archivo); }
    catch (x) {
      const { e, status } = (x as { e?: unknown; status?: number }) || {};
      if (!esFaltaDeSenal(e ?? x, status)) throw falla((e as { msg?: string })?.msg || mensajeError(e ?? x));
    }
  }
  await guardarOp(o, archivo);
  if (conSenal()) setTimeout(sincronizar, 1500);
  return local;
}

/* ---------- API para las pantallas ---------- */
const TABLAS_UUID = new Set(["equipos", "documentos", "reportes_falla", "ordenes", "fichas", "costos_orden", "pedidos_compra", "adjuntos", "movimientos_equipo", "proveedores", "areas", "empresas"]);
const ETIQUETAS: Record<string, string> = {
  reportes_falla: "Reporte de falla", fichas: "Ficha de trabajo", adjuntos: "Foto o video", costos_orden: "Costo", ordenes: "Orden de trabajo",
  equipos: "Equipo", documentos: "Documento", pedidos_compra: "Pedido de compra", config: "Configuración", preferencias_usuario: "Preferencias",
};

/** Inserta (o reenvía sin duplicar) una fila. Sin señal devuelve la fila con `_pendiente: true`. */
export async function insertar(tabla: string, fila: Record<string, unknown>) {
  const f = { ...fila };
  if (TABLAS_UUID.has(tabla) && !f.id) f.id = nuevo();
  const o: Op = { id: nuevo(), ts: Date.now(), usuario: usuarioActual, etiqueta: ETIQUETAS[tabla] || tabla, tipo: "insertar", tabla, fila: f, intentos: 0 };
  return enviarOEncolar(o, { ...f, _pendiente: true, creado_por: usuarioActual, creado_en: new Date().toISOString(), modificado_en: new Date().toISOString() }) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export async function actualizar(tabla: string, id: string, cambios: Record<string, unknown>, clave = "id") {
  const actual = buscarFila(tabla, clave, id);
  const o: Op = { id: nuevo(), ts: Date.now(), usuario: usuarioActual, etiqueta: "Cambio en " + (ETIQUETAS[tabla] || tabla).toLowerCase(), tipo: "actualizar",
    tabla, registro: id, clave, cambios, base: (actual?.modificado_en as string | undefined) ?? null, intentos: 0 };
  return enviarOEncolar(o, { ...(actual || {}), ...cambios, _pendiente: true }) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
/** Acciones que se pueden hacer sin señal (se validan al llegar). El resto necesita señal: depende del estado actual del servidor. */
const SIN_SENAL: Record<string, string> = {
  cargar_horometro: "Lectura de horómetro", orden_estado: "Cambio de estado de una orden", pedir_repuesto: "Pedido de repuesto",
  descartar_reporte: "Reporte descartado", estado_equipo: "Estado del equipo",
};
export async function llamar<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!SIN_SENAL[fn]) {
    await cargar();
    if (mias().some((x) => !x.error)) { sincronizar(); throw falla("Primero se tienen que enviar las cargas pendientes. Esperá a tener señal e intentá de nuevo."); }
    const r = await sb().rpc(fn, args);
    if (r.error) throw falla(esFaltaDeSenal(r.error, r.status) ? "Para esto hace falta señal (depende de lo que está cargado en el servidor). Intentá de nuevo con conexión." : mensajeError(r.error));
    return r.data as T;
  }
  const o: Op = { id: nuevo(), ts: Date.now(), usuario: usuarioActual, etiqueta: SIN_SENAL[fn], tipo: "llamar", fn, args, intentos: 0 };
  return enviarOEncolar(o, null) as Promise<T>;
}
/** Sube un archivo (sin reemplazar: cada archivo tiene una ruta única). Sin señal queda guardado en el celular. */
export async function subirArchivo(bucket: string, ruta: string, blob: Blob, mime?: string) {
  const o: Op = { id: nuevo(), ts: Date.now(), usuario: usuarioActual, etiqueta: mime?.startsWith("video") ? "Video" : "Archivo", tipo: "subir", bucket, ruta, mime: mime || blob.type, intentos: 0 };
  pendientesArchivo.set(bucket + "/" + ruta, blob);
  return enviarOEncolar(o, ruta, blob) as Promise<string>;
}
/** Para mostrar una foto que todavía no se subió */
const pendientesArchivo = new Map<string, Blob>();
export async function archivoPendiente(bucket: string, ruta: string): Promise<Blob | null> {
  const k = bucket + "/" + ruta;
  if (pendientesArchivo.has(k)) return pendientesArchivo.get(k)!;
  const o = ops.find((x) => x.tipo === "subir" && x.bucket === bucket && x.ruta === ruta);
  if (!o) return null;
  try { return ((await (await baseLocal()).get("archivos", o.id)) as Blob) || null; } catch { return null; }
}

/* ---------- Sincronización ---------- */
let corriendo = false;
export async function sincronizar() {
  if (corriendo || !usuarioActual) return;
  corriendo = true;
  let enviadas = 0;
  try {
    await cargar();
    for (const o of mias().filter((x) => !x.error)) {
      if (!conSenal()) break;
      try {
        await ejecutar(o);
        await quitarOp(o.id); enviadas++;
      } catch (x) {
        const { e, status } = (x as { e?: unknown; status?: number }) || {};
        if (esFaltaDeSenal(e ?? x, status)) break;               // sin señal: se reintenta después, en el mismo orden
        await guardarOp({ ...o, intentos: o.intentos + 1, error: (e as { msg?: string })?.msg || mensajeError(e ?? x) });
      }
    }
  } finally {
    corriendo = false;
    if (enviadas) alSincronizar();
  }
}
/** El usuario descarta una carga rechazada (o pendiente) después de revisarla. */
export async function descartarOp(id: string) { await quitarOp(id); }
export async function reintentarOp(id: string) {
  const o = ops.find((x) => x.id === id);
  if (o) { await guardarOp({ ...o, error: undefined }); sincronizar(); }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setTimeout(sincronizar, 500));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sincronizar(); });
  setInterval(() => { if (estadoCola().cantidad) sincronizar(); }, 20000);
}
