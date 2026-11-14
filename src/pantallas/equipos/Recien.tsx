// Después del alta: el código generado, su QR, grabar el chip NFC y la etiqueta.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useTema } from "../../sistema/tema";
import { enlaceEquipo, grabarNFC, hayNFC, qrDataUrl } from "../../comun/qr";
import { EtiquetaVista, pdfEtiquetas } from "../../comun/etiquetas";
import { avisar, descargar } from "../../comun/ui";
import { Ico } from "../../sistema/iconos";
import type { Equipo } from "../../datos/tipos";

export function BotonNFC({ codigo }: { codigo: string }) {
  const [estado, setEstado] = useState<"" | "esperando" | "ok">("");
  if (!hayNFC()) return <p className="chico suave">Para grabar el chip NFC usá un celular Android con Chrome. En iPhone, el chip se lee solo al acercarlo, pero no se puede grabar desde la web.</p>;
  return (
    <button type="button" className="boton" onClick={async () => {
      setEstado("esperando");
      try { await grabarNFC(enlaceEquipo(codigo)); setEstado("ok"); avisar("Chip NFC grabado"); }
      catch (e) { setEstado(""); avisar(e instanceof Error && e.name === "NotAllowedError" ? "Hay que permitir el uso de NFC." : "No se pudo grabar. Acercá el chip y probá de nuevo."); }
    }}><Ico n="nfc" />{estado === "esperando" ? "Acercá el chip al celular…" : estado === "ok" ? "Grabado: grabar otro" : "Grabar el chip NFC"}</button>
  );
}
export const datosEtiqueta = (d: ReturnType<typeof useDatos>, e: Equipo) => ({
  codigo: e.codigo, nombre: e.nombre, empresa: d.empresa(e.empresa_duena_id)?.nombre || "", area: d.areas.find((a) => a.id === e.area_id)?.nombre || "",
});

export function Recien({ e, otro }: { e: Equipo; otro: () => void }) {
  const d = useDatos(), tema = useTema();
  const [qr, setQr] = useState("");
  useEffect(() => { qrDataUrl(enlaceEquipo(e.codigo)).then(setQr); }, [e.codigo]);
  const tel = d.conf<string>("telefono_mantenimiento", "");
  return (
    <>
      <div className="encabezado"><div><h1>Equipo dado de alta</h1><p>{e.nombre}</p></div></div>
      <section className="panel form" style={{ alignItems: "start" }}>
        {(e as { _pendiente?: boolean })._pendiente ? <p className="nota">Sin señal: el equipo quedó guardado en el celular. El código, el QR y la etiqueta se generan cuando llegue al servidor (al volver la señal); después los encontrás en su ficha.</p> : <>
        <span className="codigo" style={{ fontSize: "var(--t-2xl)" }}>{e.codigo}</span>
        {qr && <div className="qr"><img src={qr} alt={"QR de " + e.codigo} /></div>}
        <p className="chico suave">El QR y el chip NFC llevan el mismo enlace: {enlaceEquipo(e.codigo)}</p>
        <EtiquetaVista d={datosEtiqueta(d, e)} tk={tema.tokens} telefono={tel} />
        <div className="botones">
          <BotonNFC codigo={e.codigo} />
          <button type="button" className="boton" onClick={async () => descargar(`etiqueta-${e.codigo}.pdf`, await pdfEtiquetas([datosEtiqueta(d, e)], { ...tema.tokens, etiqueta: { ...tema.tokens.etiqueta, hoja: "rollo" } }, tel))}>
            <Ico n="descargar" />Etiqueta en PDF</button>
        </div></>}
        <div className="botones">
          <button type="button" className="boton pri" onClick={otro}>Relevar otro equipo</button>
          <Link className="boton" to={"/equipos/" + e.id}>Ver la ficha</Link>
        </div>
      </section>
    </>
  );
}
