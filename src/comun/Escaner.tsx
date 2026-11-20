// Escanear el QR de la etiqueta desde la app. Usa el lector del navegador si lo tiene (Android con Chrome)
// y si no (iPhone), lee la imagen de la cámara con jsQR, como hacía W-Main.
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Ventana, cerrar } from "./ui";

export const hayEscaner = () => typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Cámara con lector de QR. */
export function VistaEscaner({ alLeer }: { alLeer: (texto: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const leer = useRef(alLeer); leer.current = alLeer;
  useEffect(() => {
    let vivo = true, stream: MediaStream | null = null, t = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nativo = "BarcodeDetector" in window ? new (window as any).BarcodeDetector({ formats: ["qr_code"] }) : null;
    const lienzo = document.createElement("canvas"), ctx = lienzo.getContext("2d", { willReadFrequently: true })!;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((s) => {
      stream = s;
      if (!vivo || !video.current) { s.getTracks().forEach((x) => x.stop()); return; }
      video.current.srcObject = s; video.current.play().catch(() => {});
      const buscar = async () => {
        const v = video.current;
        if (!vivo || !v) return;
        try {
          let texto: string | null = null;
          if (v.readyState >= 2 && v.videoWidth) {
            if (nativo) texto = (await nativo.detect(v))[0]?.rawValue || null;
            else {
              const k = Math.min(1, 640 / v.videoWidth);
              lienzo.width = Math.round(v.videoWidth * k); lienzo.height = Math.round(v.videoHeight * k);
              ctx.drawImage(v, 0, 0, lienzo.width, lienzo.height);
              texto = jsQR(ctx.getImageData(0, 0, lienzo.width, lienzo.height).data, lienzo.width, lienzo.height, { inversionAttempts: "dontInvert" })?.data || null;
            }
          }
          if (texto) { vivo = false; stream?.getTracks().forEach((x) => x.stop()); leer.current(texto); return; }
        } catch { /* cuadro sin imagen todavía */ }
        t = window.setTimeout(buscar, 200);
      };
      buscar();
    }).catch(() => setError("No se pudo usar la cámara. Revisá el permiso de la cámara para esta app (en iPhone: Ajustes → Safari → Cámara)."));
    return () => { vivo = false; clearTimeout(t); stream?.getTracks().forEach((x) => x.stop()); };
  }, []);
  return error ? <p className="nota critico">{error}</p>
    : <div className="escaner"><video ref={video} playsInline muted /><div className="mira" aria-hidden="true" /></div>;
}

export function Escaner({ alLeer }: { alLeer: (texto: string) => void }) {
  return (
    <Ventana titulo="Escaneá la etiqueta">
      <VistaEscaner alLeer={(t) => { cerrar(); alLeer(t); }} />
      <p className="chico suave">Apuntá al código QR de la etiqueta de la máquina.</p>
    </Ventana>
  );
}
