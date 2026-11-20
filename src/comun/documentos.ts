// Subir un documento de un equipo (manual en PDF, plano, programa de PLC, foto…) a Storage y registrarlo.
import { achicarFoto, subir } from "./archivos";
import { insertar } from "../datos/cola";
import { falla } from "../datos/supabase";

export async function subirDocumento(equipoId: string, archivo: File, categoria: string, nombre: string | null, maxMb: number) {
  if (archivo.size > maxMb * 1048576) throw falla(`«${archivo.name}» supera los ${maxMb} MB.`);
  const foto = archivo.type.startsWith("image/");
  const blob = foto ? await achicarFoto(archivo) : archivo;
  const ext = foto ? "jpg" : (archivo.name.match(/\.([a-z0-9]{1,6})$/i)?.[1] || "bin").toLowerCase();
  const mime = foto ? "image/jpeg" : archivo.type || "application/octet-stream";
  const ruta = await subir("documentos", `${equipoId}/${crypto.randomUUID()}.${ext}`, blob, mime);
  const sinExt = archivo.name.replace(/\.[a-z0-9]{1,6}$/i, "");
  await insertar("documentos", { equipo_id: equipoId, categoria, nombre: (nombre || "").trim() || sinExt || "Documento", bucket: "documentos", ruta, mime, bytes: blob.size });
  return ruta;
}
