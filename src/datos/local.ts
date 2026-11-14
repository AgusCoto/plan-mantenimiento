// Copia local en IndexedDB: los datos de la última conexión, para abrir la app y trabajar sin señal.
// (La cola de envíos pendientes vive en la misma base local: ver cola.ts.)
import { openDB, type IDBPDatabase } from "idb";

let db: Promise<IDBPDatabase> | null = null;
export function baseLocal() {
  if (!db) {
    db = openDB("mantenimiento", 1, {
      upgrade(b) {
        if (!b.objectStoreNames.contains("copias")) b.createObjectStore("copias");
        if (!b.objectStoreNames.contains("cola")) b.createObjectStore("cola", { keyPath: "id" });
        if (!b.objectStoreNames.contains("archivos")) b.createObjectStore("archivos");
      },
    });
  }
  return db;
}

let pendiente: { id: string; datos: unknown } | null = null;
let timer: number | undefined;
/** Guarda la copia (agrupando cambios seguidos, como mucho una vez por segundo). */
export function guardarCopia(usuarioId: string, datos: unknown) {
  pendiente = { id: usuarioId, datos };
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const p = pendiente; pendiente = null;
    if (!p) return;
    try { await (await baseLocal()).put("copias", { ts: Date.now(), datos: p.datos }, p.id); } catch { /* sin espacio o modo privado */ }
  }, 1000);
}
export async function leerCopia(usuarioId: string): Promise<Record<string, unknown> | null> {
  try { const c = await (await baseLocal()).get("copias", usuarioId); return c?.datos || null; } catch { return null; }
}
export async function borrarCopias() {
  try { await (await baseLocal()).clear("copias"); } catch { /* */ }
}
