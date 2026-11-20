// Escanear QR / NFC (como en W-Main): la cámara lee la etiqueta y abre el equipo según el perfil
// (operario → reporte de falla; técnico → historial y órdenes; jefe → ficha completa).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDatos } from "../datos/store";
import { VistaEscaner, hayEscaner } from "../comun/Escaner";
import { codigoDesde, hayNFC, leerNFC } from "../comun/qr";
import { Codigo, avisar } from "../comun/ui";
import { Ico } from "../sistema/iconos";

export function Escanear() {
  const d = useDatos(), nav = useNavigate();
  const [q, setQ] = useState("");
  const [nfc, setNfc] = useState(false);
  const ir = (texto: string) => {
    const c = codigoDesde(texto), e = d.buscarEquipo(c);
    if (e) nav("/e/" + encodeURIComponent(e.codigo)); else avisar("La etiqueta " + c + " no corresponde a ningún equipo cargado.");
  };
  const ql = q.trim().toLowerCase();
  const l = ql.length < 2 ? [] : d.equipos.filter((e) => [e.codigo, e.nombre, e.ubicacion].join(" ").toLowerCase().includes(ql)).slice(0, 12);
  return (
    <>
      <div className="encabezado"><div><h1>Escanear QR / NFC</h1><p>Apuntá la cámara al código QR de la etiqueta del equipo.</p></div></div>
      {hayEscaner() ? <VistaEscaner alLeer={ir} /> : <p className="nota">Este navegador no deja usar la cámara desde la app. Usá la cámara del celular: el QR abre el equipo directamente.</p>}
      {hayNFC() && <button className="boton grande" onClick={async () => {
        try { setNfc(true); await leerNFC((t) => { setNfc(false); ir(t); }); } catch { setNfc(false); avisar("No se pudo leer NFC. Activá el NFC del celular."); }
      }}><Ico n="nfc" />{nfc ? "Acercá el celular al chip…" : "Leer el chip NFC"}</button>}
      <label className="campo"><span>…o buscá el equipo por código o nombre</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: INY-INY-001 o inyectora" onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) ir(q); }} /></label>
      {l.length > 0 && <div className="lista">{l.map((e) => (
        <button key={e.id} className="item" onClick={() => nav("/e/" + encodeURIComponent(e.codigo))}><div className="cuerpo-item"><div className="t">{e.nombre}</div>
          <div className="meta"><Codigo>{e.codigo}</Codigo><span>{e.ubicacion}</span></div></div></button>))}</div>}
    </>
  );
}
