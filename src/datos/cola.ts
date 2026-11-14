// Cola de envíos: toda carga pasa por acá. Con señal se envía al momento; sin señal queda guardada
// en el celular (IndexedDB) y se sincroniza sola al volver la señal.
// (En esta versión se envía directo; la persistencia sin señal se completa en el paso 6.)
import { useEffect, useState } from "react";
import { sb, mensajeError, falla } from "./supabase";

type Escucha = () => void;
const escuchas = new Set<Escucha>();
const estado = { cantidad: 0, rechazadas: 0 };
export function usePendientes() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((x) => x + 1); escuchas.add(f); return () => { escuchas.delete(f); }; }, []);
  return estado;
}

/** Inserta (o reenvía sin duplicar) una fila. */
export async function insertar(tabla: string, fila: Record<string, unknown>) {
  const { data, error } = await sb().from(tabla).insert(fila).select().single();
  if (error) throw falla(mensajeError(error));
  return data;
}
export async function actualizar(tabla: string, id: string, cambios: Record<string, unknown>, clave = "id") {
  const { data, error } = await sb().from(tabla).update(cambios).eq(clave, id).select();
  if (error) throw falla(mensajeError(error));
  if (!data || !data.length) throw falla("No se pudo guardar: tu perfil no tiene permiso o el registro no existe.");
  return data[0];
}
export async function llamar<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw falla(mensajeError(error));
  return data as T;
}
