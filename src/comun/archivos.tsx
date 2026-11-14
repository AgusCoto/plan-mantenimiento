// Fotos, videos y documentos en Supabase Storage (privados: se ven con enlaces temporales).
import { useEffect, useState } from "react";
import { sb, falla, mensajeError } from "../datos/supabase";
import { Ventana, abrir } from "./ui";
import { Ico } from "../sistema/iconos";
import { useDatos } from "../datos/store";
import { archivoPendiente, insertar, subirArchivo } from "../datos/cola";
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
/** Sube un archivo por la cola de envíos: sin señal queda guardado en el celular y se sube después. */
export async function subir(bucket: string, ruta: string, blob: Blob, tipo?: string) {
  // Sin reemplazar: cada archivo tiene una ruta única (y nadie tiene permiso para pisar archivos ajenos)
  try { return await subirArchivo(bucket, ruta, blob, tipo); }
  catch (e) { throw falla("No se pudo subir el archivo: " + ((e as { msg?: string }).msg || mensajeError(e))); }
}

const cache = new Map<string, { url: string; vence: number }>();
export async function urlFirmada(bucket: string, ruta: string): Promise<string | null> {
  if (ruta.startsWith("data:")) return ruta;  // fotos migradas de W-Main
  const k = bucket + "/" + ruta, c = cache.get(k);
  if (c && c.vence > Date.now()) return c.url;
  const local = await archivoPendiente(bucket, ruta);   // todavía en el celular, sin subir
  if (local) { const u = URL.createObjectURL(local); cache.set(k, { url: u, vence: Date.now() + 10 * 60 * 1000 }); return u; }
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

/* ---------- Fotos y videos para reportes y fichas ---------- */
export interface Medio { id: string; blob: Blob; tipo: "foto" | "video"; mime: string; segundos: number | null; vista: string }

/** Prepara un archivo elegido en el celular: achica la foto; controla duración y peso del video. */
export async function prepararMedio(f: File, maxSeg: number, maxMb: number): Promise<Medio> {
  const id = crypto.randomUUID();
  const tv = tipoVideo(f);
  if (tv) {
    if (f.size > maxMb * 1048576) throw falla(`El video pesa más de ${maxMb} MB. Grabá uno más corto.`);
    const s = await duracionVideo(f);
    if (s != null && s > maxSeg + 0.5) throw falla(`El video dura ${Math.round(s)} s: el máximo es ${maxSeg} s.`);
    return { id, blob: f, tipo: "video", mime: tv, segundos: s, vista: URL.createObjectURL(f) };
  }
  if (!f.type.startsWith("image/") && !/\.(jpe?g|png|heic|webp)$/i.test(f.name)) throw falla("Ese archivo no es una foto ni un video.");
  const b = await achicarFoto(f);
  return { id, blob: b, tipo: "foto", mime: b.type || "image/jpeg", segundos: null, vista: URL.createObjectURL(b) };
}
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };
/** Sube las fotos y videos y los asocia al registro (reporte, ficha, costo o movimiento). */
export async function subirAdjuntos(usuarioId: string, tabla: string, registroId: string, medios: Medio[], momento: "antes" | "despues" | null = null) {
  for (const m of medios) {
    const ruta = await subir("adjuntos", `${usuarioId}/${m.id}.${EXT[m.mime] || "bin"}`, m.blob, m.mime);
    await insertar("adjuntos", { id: m.id, tabla, registro_id: registroId, bucket: "adjuntos", ruta, tipo: m.tipo, momento, mime: m.mime, bytes: m.blob.size, segundos: m.segundos });
  }
}

/** Botones para sacar fotos o grabar videos, con miniaturas y quitar. */
export function Captura({ medios, setMedios, video = true, titulo, compacto }: { medios: Medio[]; setMedios: (m: Medio[]) => void; video?: boolean; titulo?: string; compacto?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const d = useDatos();
  const maxSeg = Number(d.conf("video_max_segundos", 60)), maxMb = Number(d.conf("video_max_mb", 50));
  async function elegir(fs: FileList | null) {
    if (!fs?.length) return;
    setOcupado(true); setError(null);
    const nuevos: Medio[] = [];
    for (const f of Array.from(fs)) {
      try { nuevos.push(await prepararMedio(f, maxSeg, maxMb)); } catch (e) { setError((e as { msg?: string }).msg || "No se pudo usar el archivo."); }
    }
    setMedios([...medios, ...nuevos]); setOcupado(false);
  }
  return (
    <div className="captura">
      {titulo && <b>{titulo}</b>}
      <div className="botones">
        <label className={"boton" + (compacto ? "" : " grande")}><Ico n="camara" />{ocupado ? "Preparando…" : "Foto"}
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { elegir(e.target.files); e.target.value = ""; }} /></label>
        {video && <label className={"boton" + (compacto ? "" : " grande")}><Ico n="video" />Video (hasta {maxSeg} s)
          <input type="file" accept="video/*" capture="environment" hidden onChange={(e) => { elegir(e.target.files); e.target.value = ""; }} /></label>}
        <label className="boton chico" style={{ alignSelf: "center" }}>De la galería
          <input type="file" accept={video ? "image/*,video/*" : "image/*"} multiple hidden onChange={(e) => { elegir(e.target.files); e.target.value = ""; }} /></label>
      </div>
      {error && <p className="nota critico" role="alert">{error}</p>}
      {medios.length > 0 && <div className="medios">{medios.map((m) => (
        <span key={m.id} style={{ position: "relative" }}>
          {m.tipo === "video" ? <video src={m.vista} muted playsInline /> : <img src={m.vista} alt="Foto elegida" />}
          <button type="button" className="quitar" aria-label="Quitar" onClick={() => setMedios(medios.filter((x) => x.id !== m.id))}>×</button>
        </span>))}</div>}
    </div>
  );
}
