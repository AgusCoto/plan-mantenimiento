// Conexión con Supabase (clave pública: los permisos los controla la base).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, "") || "";
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || "";
export const configurado = !!(SUPABASE_URL && SUPABASE_KEY);

let cliente: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(SUPABASE_URL || "http://sin-configurar.invalid", SUPABASE_KEY || "sin-clave", {
      auth: { storageKey: "mant-sesion", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return cliente;
}

/** Se ingresa con usuario; en Supabase Auth se guarda con este email interno (nunca recibe correos). */
export const emailDe = (usuario: string) => usuario.trim().toLowerCase() + "@cuentas.mantenimiento.app";

/** Texto claro para los errores que devuelve Supabase. */
export function mensajeError(e: unknown): string {
  const m = (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e || "")).trim();
  if (/Invalid login credentials/i.test(m)) return "Usuario o contraseña incorrectos.";
  if (/banned/i.test(m)) return "Este usuario está desactivado. Hablá con el jefe de mantenimiento.";
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return "Sin señal. Revisá la conexión e intentá de nuevo.";
  if (/row-level security|permission denied|42501/i.test(m) && !/[áéíóú]/.test(m)) return "Tu perfil no tiene permiso para hacer eso.";
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(m)) return "El archivo es demasiado grande.";
  if (/mime type .* is not supported|invalid_mime_type/i.test(m)) return "Ese tipo de archivo no se puede subir.";
  if (/duplicate key/i.test(m)) return "Eso ya estaba cargado.";
  if (/JWT expired|refresh_token/i.test(m)) return "La sesión venció. Volvé a ingresar.";
  return m || "No se pudo completar. Intentá de nuevo.";
}
export interface ErrorUsuario { msg: string }
export const falla = (msg: string): ErrorUsuario => ({ msg });
/** Devuelve los datos o lanza un error legible. */
export function ok<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw falla(mensajeError(r.error));
  return r.data;
}
