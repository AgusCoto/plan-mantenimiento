// Conexión con Supabase. Cada app guarda su sesión aparte: en el mismo celular o PC
// puede haber una sesión de Gestión y otra de Operarios sin pisarse.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, "") || "";
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || "";
export const configurado = !!(SUPABASE_URL && SUPABASE_KEY);

export type App = "gestion" | "operarios";
export const CLAVE_SESION: Record<App, string> = { gestion: "planta-gestion", operarios: "planta-operarios" };

let actual: SupabaseClient | null = null;
export function cliente(app: App): SupabaseClient {
  if (!actual) {
    actual = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { storageKey: CLAVE_SESION[app], persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return actual;
}
export const sb = () => {
  if (!actual) throw new Error("Cliente no iniciado");
  return actual;
};

/** Las cuentas ingresan con usuario; en Supabase Auth se guardan con este email interno (nunca recibe correos). */
export const emailDe = (usuario: string) => usuario.trim().toLowerCase() + "@cuentas.gestion-planta.app";
/** ¿Hay una sesión guardada de la otra app en este dispositivo? */
export const haySesion = (app: App) => {
  try { return !!localStorage.getItem(CLAVE_SESION[app]); } catch { return false; }
};

/** Texto claro para los errores que devuelve Supabase. */
export function mensajeError(e: unknown): string {
  const m = (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e || "")).trim();
  if (/Invalid login credentials/i.test(m)) return "Usuario o contraseña incorrectos.";
  if (/banned/i.test(m)) return "Esta cuenta está desactivada. Hablá con tu gerente.";
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return "Sin conexión. Revisá internet e intentá de nuevo.";
  if (/row-level security|permission denied|42501/i.test(m)) return "Tu perfil no tiene permiso para hacer eso.";
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(m)) return "El archivo es demasiado grande.";
  if (/mime type .* is not supported|invalid_mime_type/i.test(m)) return "Ese tipo de archivo no se puede subir.";
  if (/JWT expired|refresh_token/i.test(m)) return "La sesión venció. Volvé a ingresar.";
  return m || "No se pudo completar. Revisá la conexión e intentá de nuevo.";
}

/** Lanza un error legible si la respuesta de Supabase trae error. */
export function ok<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw { msg: mensajeError(r.error) };
  return r.data;
}

/** Dirección pública de la app (para los QR). */
export function urlPublica(config?: string | null): string {
  const env = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.trim();
  let u = env || config || "";
  if (!u) {
    u = location.origin + location.pathname.replace(/[^/]*$/, "");
    u = u.replace(/\/operarios\/$/, "/");
  }
  return u.endsWith("/") ? u : u + "/";
}
export const urlEquipo = (codigo: string, base?: string | null) => urlPublica(base) + "operarios/?equipo=" + encodeURIComponent(codigo);
