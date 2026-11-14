// Fotos, videos y documentos en Supabase Storage (privados: se ven con enlaces temporales).
import { useEffect, useState } from "react";
import { sb, falla, mensajeError } from "../datos/supabase";
import { Ventana, abrir } from "./ui";
import type { Adjunto } from "../datos/tipos";

/** Achica la foto en el celular antes de subirla (1600 px de lado mayor, JPEG 82 %). */
export async function achicarFoto(file: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return (await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82))) || file;
  } catch { return file; }
}
/** MP4 y MOV del iPhone (algunos celulares no informan el tipo: se deduce de la extensión). */
export function tipoVideo(f: File): string | null {
  const t = (f.type || "").toLowerCase();
  if (["video/mp4", "video/quicktime", "video/webm"].includes(t)) return t;
  if (/\.mov$/i.test(f.name)) return "video/quicktime";
  if (/\.(mp4|m4v)$/i.test(f.name)) return "video/mp4";
  if (/\.webm$/i.test(f.name)) return "video/webm";
  return null;
}
/** Duración de un video en segundos (se controla en el celular antes de subirlo). */
export function duracionVideo(f: Blob): Promise<number | null> {
  return new Promise((res) => {
    const v = document.createElement("video"); v.preload = "metadata";
    const u = URL.createObjectURL(f);
    v.onloadedmetadata = () => { URL.revokeObjectURL(u); res(isFinite(v.duration) ? v.duration : null); };
    v.onerror = () => { URL.revokeObjectURL(u); res(null); };
    v.src = u;
  });
}
export async function subir(bucket: string, ruta: string, blob: Blob, tipo?: string) {
  // Sin reemplazar: cada archivo tiene una ruta única (y nadie tiene permiso para pisar archivos ajenos)
  const { error } = await sb().storage.from(bucket).upload(ruta, blob, { contentType: tipo || blob.type || "application/octet-stream" });
  if (error) throw falla("No se pudo subir el archivo: " + mensajeError(error));
  return ruta;
}

const cache = new Map<string, { url: string; vence: number }>();
export async function urlFirmada(bucket: string, ruta: string): Promise<string | null> {
  if (ruta.startsWith("data:")) return ruta;  // fotos migradas de W-Main
  const k = bucket + "/" + ruta, c = cache.get(k);
  if (c && c.vence > Date.now()) return c.url;
  const { data, error } = await sb().storage.from(bucket).createSignedUrl(ruta, 3600);
  if (error || !data) return null;
  cache.set(k, { url: data.signedUrl, vence: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}
export function useUrl(bucket: string | null | undefined, ruta: string | null | undefined) {
  const [u, setU] = useState<string | null>(null);
  useEffect(() => { let vivo = true; if (bucket && ruta) urlFirmada(bucket, ruta).then((x) => vivo && setU(x)); return () => { vivo = false; }; }, [bucket, ruta]);
  return u;
}
function Medio({ a, alt }: { a: Adjunto; alt: string }) {
  const u = useUrl(a.bucket, a.ruta);
  if (!u) return <div className="ph">Cargando…</div>;
  if (a.tipo === "video") return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <video src={u} controls preload="metadata" playsInline aria-label={alt} />
      {(a.mime || "").includes("quicktime") && <a className="chico" href={u} target="_blank" rel="noopener">¿No se ve? Descargar el video</a>}
    </span>);
  return <img src={u} alt={alt} loading="lazy" onClick={() => abrir(<Ventana titulo={alt}><img src={u} alt={alt} style={{ maxWidth: "100%", borderRadius: "var(--r-m)" }} /></Ventana>)} />;
}
export function Medios({ adjuntos, alt = "Foto adjunta" }: { adjuntos: Adjunto[]; alt?: string }) {
  if (!adjuntos.length) return <p className="suave chico">Sin fotos ni videos.</p>;
  return <div className="medios">{adjuntos.map((a) => <Medio key={a.id} a={a} alt={(a.momento === "antes" ? "Antes: " : a.momento === "despues" ? "Después: " : "") + alt} />)}</div>;
}
