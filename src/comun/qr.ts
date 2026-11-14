// Enlace de cada equipo (el mismo en el QR y en el chip NFC) y generación del QR.
import QRCode from "qrcode";

/** https://<dominio>/e/<código> */
export const enlaceEquipo = (codigo: string) => location.origin + "/e/" + encodeURIComponent(codigo);
export const qrDataUrl = (texto: string, px = 480) =>
  QRCode.toDataURL(texto, { width: px, margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#FFFFFF" } });

/** Lee un código de equipo desde lo que devuelve un QR o una etiqueta NFC (enlace o código suelto). */
export function codigoDesde(texto: string): string {
  const t = texto.trim();
  const m = /\/e\/([^/?#]+)/.exec(t) || /[?&]equipo=([^&#]+)/.exec(t) || /#(?:eq-)?([^/?#]+)$/.exec(t);
  try { return decodeURIComponent(m ? m[1] : t); } catch { return m ? m[1] : t; }
}

/** Grabar el enlace en un chip NFC (Android con Chrome). */
export const hayNFC = () => typeof window !== "undefined" && "NDEFReader" in window;
export async function grabarNFC(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (!hayNFC()) throw new Error("Grabar NFC desde la app funciona en celulares Android con Chrome.");
  const n = new w.NDEFReader();
  await n.write({ records: [{ recordType: "url", data: url }] });
}
export async function leerNFC(alLeer: (texto: string) => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const n = new w.NDEFReader();
  await n.scan();
  n.onreading = (ev: { message: { records: { recordType: string; data: DataView }[] } }) => {
    for (const r of ev.message.records) if (["url", "absolute-url", "text"].includes(r.recordType)) { alLeer(new TextDecoder().decode(r.data)); return; }
  };
}
