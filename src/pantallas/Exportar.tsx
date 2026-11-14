// Exportar todos los datos (jefe y dirección): Excel con una hoja por tabla, o CSV.
import { useState } from "react";
import { useSesion } from "../datos/sesion";
import { csvZip, juntarDatos, xlsx } from "../comun/exportar";
import { descargar } from "../comun/ui";
import { Ico } from "../sistema/iconos";
import { hoy } from "../comun/formato";

export function Exportar() {
  const s = useSesion();
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function bajar(formato: "xlsx" | "csv") {
    setError(null);
    try {
      const hojas = await juntarDatos((t) => setEstado("Leyendo " + t + "…"));
      setEstado("Armando el archivo…");
      const f = hoy();
      if (formato === "xlsx") descargar(`mantenimiento-${f}.xlsx`, xlsx(hojas)); else descargar(`mantenimiento-${f}-csv.zip`, csvZip(hojas));
    } catch (e) { setError("No se pudo exportar: " + ((e as Error)?.message || "revisá la conexión") + "."); }
    setEstado(null);
  }
  return (
    <>
      <div className="encabezado"><div><h1>Exportar datos</h1>
        <p>Todos los datos que tu perfil puede ver, una hoja (o un archivo) por tabla: equipos, órdenes, fichas, costos, compras, movimientos, reportes, usuarios y el registro de cambios. Las empresas, usuarios, equipos y órdenes aparecen por su nombre o código.</p></div></div>
      <section className="panel form">
        <div className="botones">
          <button className="boton pri grande" disabled={!!estado} onClick={() => bajar("xlsx")}><Ico n="descargar" />Excel (.xlsx)</button>
          <button className="boton grande" disabled={!!estado} onClick={() => bajar("csv")}><Ico n="descargar" />CSV (un archivo por tabla, en .zip)</button>
        </div>
        {estado && <p className="chico suave" role="status">{estado}</p>}
        {error && <p className="nota critico" role="alert">{error}</p>}
        <p className="chico suave">Necesita señal (se lee todo del servidor en el momento). {s.usuario!.perfil === "jefe" ? "Sirve también como copia de respaldo: guardala en un lugar seguro, porque incluye los datos de todas las empresas." : ""} Las fotos y los documentos no se incluyen: quedan en Supabase Storage.</p>
      </section>
    </>
  );
}
