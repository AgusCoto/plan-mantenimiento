// Escanear el QR de la etiqueta desde la app (Android con Chrome trae el lector incorporado).
// En iPhone se usa la cámara del celular: el QR abre el enlace directamente.
import { useEffect, useRef, useState } from "react";
import { Ventana, cerrar } from "./ui";

export const hayEscaner = () => typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;

export function Escaner({ alLeer }: { alLeer: (texto: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true, stream: MediaStream | null = null, t = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const det = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((s) => {
      stream = s;
      if (!vivo || !video.current) return;
      video.current.srcObject = s; video.current.play();
      const buscar = async () => {
        if (!vivo || !video.current) return;
        try {
          const r = await det.detect(video.current);
          if (r[0]?.rawValue) { vivo = false; cerrar(); alLeer(r[0].rawValue); return; }
        } catch { /* cuadro sin imagen todavía */ }
        t = window.setTimeout(buscar, 250);
      };
      buscar();
    }).catch(() => setError("No se pudo usar la cámara. Revisá el permiso del navegador."));
    return () => { vivo = false; clearTimeout(t); stream?.getTracks().forEach((x) => x.stop()); };
  }, [alLeer]);
  return (
    <Ventana titulo="Escaneá la etiqueta">
      {error ? <p className="nota critico">{error}</p>
        : <video ref={video} playsInline muted style={{ width: "100%", borderRadius: "var(--r-m)", background: "#000", aspectRatio: "1" , objectFit: "cover" }} />}
      <p className="chico suave">Apuntá al código QR de la etiqueta de la máquina.</p>
    </Ventana>
  );
}
