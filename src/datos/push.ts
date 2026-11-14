// Notificaciones push en este celular: activar, desactivar y saber en qué estado están.
// En iPhone funcionan con iOS 16.4 o más nuevo y solo con la app agregada a la pantalla de inicio.
import { sb, falla, mensajeError } from "./supabase";

export const CLAVE_VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || "";
export const esIPhone = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const instalada = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
export const soportaPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export type EstadoPush = "sin_configurar" | "no_soportado" | "instalar_iphone" | "bloqueado" | "activo" | "inactivo";
export async function estadoPush(): Promise<EstadoPush> {
  if (!CLAVE_VAPID) return "sin_configurar";
  if (!soportaPush()) return esIPhone() && !instalada() ? "instalar_iphone" : "no_soportado";
  if (Notification.permission === "denied") return "bloqueado";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "activo" : "inactivo";
}

const aBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const b64 = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "");

export async function activarPush() {
  if (!CLAVE_VAPID) throw falla("Los avisos todavía no están configurados (falta la clave VAPID: ver README).");
  if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted")
    throw falla("No diste permiso para las notificaciones. Se habilita desde la configuración del navegador.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(CLAVE_VAPID) }); }
    catch (e) {
      throw falla("El navegador no pudo registrarse en el servicio de notificaciones" + (navigator.onLine ? "" : " (no hay señal)")
        + ". Probá de nuevo; si sigue, revisá que el navegador tenga permitidas las notificaciones y los servicios de Google (Android) o que la app esté instalada (iPhone). Detalle: " + ((e as Error)?.message || e));
    }
  }
  const { error } = await sb().rpc("suscribir_push", { p_endpoint: sub.endpoint, p_p256dh: b64(sub.getKey("p256dh")), p_auth: b64(sub.getKey("auth")), p_agente: navigator.userAgent });
  if (error) throw falla(mensajeError(error));
}
export async function desactivarPush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await sb().rpc("desuscribir_push", { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}
/** Al salir de la cuenta, este celular deja de recibir los avisos de ese usuario. */
export async function olvidarEsteCelular() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) await sb().rpc("desuscribir_push", { p_endpoint: sub.endpoint });
  } catch { /* sin señal: la suscripción pasa al próximo que ingrese */ }
}
