// Fotos, videos y PDF en Supabase Storage (buckets privados: se ven con enlaces temporales).
import { useEffect, useState } from "react";
import { sb } from "./supabase";
import { abrirModal, Modal } from "./ui";
import type { Adjunto } from "./tipos";

/** Achica la foto en el celular antes de subirla (1600 px, JPEG 82 %, como el prototipo). */
export async function achicar(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
    return b || file;
  } catch { return file; }
}

/** MP4 y también MOV del iPhone (video/quicktime). Algunos celulares no informan el tipo: se deduce de la extensión. */
export function tipoVideo(f: File): string | null {
  const t = (f.type || "").toLowerCase();
  if (["video/mp4", "video/quicktime", "video/webm"].includes(t)) return t;
  if (/\.mov$/i.test(f.name)) return "video/quicktime";
  if (/\.(mp4|m4v)$/i.test(f.name)) return "video/mp4";
  if (/\.webm$/i.test(f.name)) return "video/webm";
  return null;
}

const cache = new Map<string, { url: string; vence: number }>();
export async function urlFirmada(bucket: string, ruta: string): Promise<string | null> {
  if (ruta.startsWith("data:")) return ruta;  // fotos migradas de W-Main
  const k = bucket + "/" + ruta;
  const c = cache.get(k);
  if (c && c.vence > Date.now()) return c.url;
  const { data, error } = await sb().storage.from(bucket).createSignedUrl(ruta, 3600);
  if (error || !data) return null;
  cache.set(k, { url: data.signedUrl, vence: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}
export function useUrlFirmada(bucket: string | null | undefined, ruta: string | null | undefined) {
  const [u, setU] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    if (bucket && ruta) urlFirmada(bucket, ruta).then((x) => vivo && setU(x));
    return () => { vivo = false; };
  }, [bucket, ruta]);
  return u;
}

function Item({ a }: { a: Adjunto }) {
  const u = useUrlFirmada(a.bucket, a.ruta);
  if (!u) return <div className="ph">Cargando…</div>;
  if (a.tipo === "video") {
    const mov = (a.mime || "").includes("quicktime");
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
        <video src={u} controls preload="metadata" playsInline />
        {mov && <a className="small" href={u} target="_blank" rel="noopener">¿No se ve? Descargar video</a>}
      </span>
    );
  }
  return <img src={u} alt="Foto del reporte" loading="lazy" onClick={() => abrirModal(<Modal title="Foto"><img className="lightbox" src={u} alt="Foto del reporte" /></Modal>)} />;
}
export function Medios({ adjuntos }: { adjuntos: Adjunto[] }) {
  if (!adjuntos.length) return <p className="muted small">Sin fotos ni videos.</p>;
  return <div className="media">{adjuntos.map((a) => <Item key={a.id} a={a} />)}</div>;
}
export function Miniatura({ a }: { a?: Adjunto }) {
  const u = useUrlFirmada(a && a.tipo === "foto" ? a.bucket : null, a?.ruta);
  if (!a) return <div className="thumb" style={{ background: "var(--surface-2)" }} />;
  if (a.tipo === "video") return <div className="thumb" style={{ display: "grid", placeItems: "center", background: "var(--surface-2)" }}>▶</div>;
  return u ? <img className="thumb" src={u} alt="" loading="lazy" /> : <div className="thumb" style={{ background: "var(--surface-2)" }} />;
}
