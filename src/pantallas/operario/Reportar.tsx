// Reporte de falla en tres toques: 1) qué le pasa, 2) ¿está parada?, 3) enviar.
// Foto, video y comentario son opcionales. Lo puede hacer cualquier usuario activo.
import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { insertar } from "../../datos/cola";
import { Captura, subirAdjuntos, type Medio } from "../../comun/archivos";
import { Codigo, Emp, Pastilla, abrir, avisar } from "../../comun/ui";
import { Ico } from "../../sistema/iconos";
import { hace } from "../../comun/formato";
import { estadoEquipo } from "../Inicio";
import { Escaner, hayEscaner } from "../../comun/Escaner";
import { codigoDesde, hayNFC, leerNFC } from "../../comun/qr";

/** Buscar el equipo: escanear el QR, leer el chip NFC o escribir el código. */
export function ElegirEquipo() {
  const d = useDatos(), nav = useNavigate(), tema = useTema();
  const [q, setQ] = useState("");
  const [nfc, setNfc] = useState(false);
  const ir = useCallback((texto: string) => {
    const e = d.buscarEquipo(codigoDesde(texto));
    if (e) nav("/reportar/" + e.id); else avisar("No encontramos el equipo " + codigoDesde(texto));
  }, [d, nav]);
  const ql = q.trim().toLowerCase();
  const l = ql.length < 2 ? [] : d.equipos.filter((e) => e.estado !== "baja" && [e.codigo, e.nombre, e.ubicacion].join(" ").toLowerCase().includes(ql)).slice(0, 12);
  return (
    <>
      <div><Link to="/" className="chico">← Inicio</Link><h1>{tema.t("reportar")}</h1>
        <p className="suave">Lo más rápido: abrí la cámara del celular y apuntá a la etiqueta de la máquina.</p></div>
      <div className="botones">
        {hayEscaner() && <button className="boton pri grande" onClick={() => abrir(<Escaner alLeer={ir} />)}><Ico n="escanear" />Escanear la etiqueta</button>}
        {hayNFC() && <button className="boton grande" onClick={async () => {
          try { setNfc(true); await leerNFC((t) => { setNfc(false); ir(t); }); } catch { setNfc(false); avisar("No se pudo leer NFC. Activá el NFC del celular."); }
        }}><Ico n="nfc" />{nfc ? "Acercá el celular al chip…" : "Leer el chip NFC"}</button>}
      </div>
      <label className="campo"><span>…o buscá el equipo por código o nombre</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: INY-INY-001 o inyectora" autoCapitalize="characters"
          onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) ir(q); }} /></label>
      {l.length > 0 && <div className="lista">{l.map((e) => (
        <Link key={e.id} className="item" to={"/reportar/" + e.id}><div className="cuerpo-item"><div className="t">{e.nombre}</div>
          <div className="meta"><Codigo>{e.codigo}</Codigo><span>{e.ubicacion}</span></div></div></Link>))}</div>}
      {ql.length >= 2 && !l.length && <p className="vacio">Ningún equipo coincide.</p>}
    </>
  );
}

export function Reportar() {
  const { id } = useParams();
  const d = useDatos(), s = useSesion(), tema = useTema(), nav = useNavigate();
  const [falla, setFalla] = useState<string | null>(null);
  const [parada, setParada] = useState<boolean | null>(null);
  const [texto, setTexto] = useState("");
  const [medios, setMedios] = useState<Medio[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ parada: boolean } | null>(null);
  const e = d.equipo(id);
  if (!e) return <><h1>{tema.t("reportar")}</h1><p className="suave">No encontramos el equipo, o es de una empresa a la que no tenés acceso.</p><Link className="boton" to="/reportar">Buscar otro equipo</Link></>;
  const ubi = d.empresa(e.empresa_ubicacion_id);
  const fallas = d.listas.filter((x) => x.lista === "tipo_falla" && x.activo);
  const recientes = d.reportes_falla.filter((r) => r.equipo_id === e.id && r.estado === "nuevo");
  const tel = d.conf<string>("telefono_mantenimiento", "");
  const [est, c] = estadoEquipo(e.estado);

  if (listo) return (
    <div className="listo">
      <div className="ic" aria-hidden="true">✓</div>
      <h1>Reporte enviado</h1>
      <p>Mantenimiento ya recibió el aviso de <b>{e.nombre}</b>{listo.parada ? ", con la máquina parada" : ""}.</p>
      {listo.parada && tel && <a className="boton grande" href={"tel:" + tel.replace(/[^\d+]/g, "")}>Llamar a mantenimiento ({tel})</a>}
      <Link className="boton pri grande" to="/">Volver al inicio</Link>
    </div>
  );
  if (e.estado === "baja") return <><h1>{e.nombre}</h1><p className="nota">Este equipo está dado de baja.</p><Link className="boton" to="/">Volver</Link></>;

  async function enviar() {
    if (!falla || parada === null) return;
    setOcupado(true); setError(null);
    try {
      const rid = crypto.randomUUID();
      await insertar("reportes_falla", { id: rid, equipo_id: e!.id, tipo_falla: falla, parada, texto: texto.trim() || null, hecho_en: new Date().toISOString() });
      if (medios.length) {
        try { await subirAdjuntos(s.usuario!.id, "reportes_falla", rid, medios); }
        catch { avisar("El reporte se envió, pero no se pudieron subir las fotos."); }
      }
      await d.recargar("reportes_falla", "adjuntos", "equipos");
      setListo({ parada }); window.scrollTo(0, 0);
    } catch (x) { setError((x as { msg?: string }).msg || "No se pudo enviar."); }
    setOcupado(false);
  }

  return (
    <>
      <div className="placa" style={{ gridTemplateColumns: "1fr" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Codigo>{e.codigo}</Codigo><Pastilla c={c}>{est}</Pastilla></div>
        <div><b style={{ fontSize: "var(--t-l)" }}>{e.nombre}</b><div className="chico suave">{ubi && <Emp sigla={ubi.sigla} nombre={ubi.nombre} />} {e.ubicacion}</div></div>
      </div>
      {recientes.length > 0 && <p className="nota">Ya hay {recientes.length === 1 ? "un reporte" : recientes.length + " reportes"} sin atender: {recientes.map((r) => `${d.item("tipo_falla", r.tipo_falla)?.nombre} (${hace(r.hecho_en)})`).join(", ")}. Si es otra cosa, reportala igual.</p>}
      <section className="form">
        <h2 style={{ margin: 0 }}>1. ¿Qué le pasa?</h2>
        <div className="fallas">{fallas.map((f) => (
          <button key={f.clave} type="button" className="falla" aria-pressed={falla === f.clave} onClick={() => setFalla(f.clave)}><Ico n={f.icono || "pregunta"} />{f.nombre}</button>))}</div>
        <h2 style={{ margin: 0 }}>2. ¿La máquina está parada?</h2>
        <div className="si-no">
          <button type="button" className="si" aria-pressed={parada === true} onClick={() => setParada(true)}>Sí, parada</button>
          <button type="button" className="no" aria-pressed={parada === false} onClick={() => setParada(false)}>No, funciona</button>
        </div>
        <details>
          <summary className="chico" style={{ cursor: "pointer", minHeight: 48, display: "flex", alignItems: "center" }}>Agregar foto, video o comentario (opcional)</summary>
          <div className="form" style={{ paddingTop: "var(--e2)" }}>
            <Captura medios={medios} setMedios={setMedios} compacto />
            <label className="campo"><span>Comentario</span><textarea value={texto} onChange={(x) => setTexto(x.target.value)} placeholder="Ej.: hace ruido al cerrar el molde" /></label>
          </div>
        </details>
        {error && <p className="nota critico" role="alert">{error}</p>}
        <div className="enviar"><button type="button" className="boton pri grande" disabled={!falla || parada === null || ocupado} onClick={enviar}>
          {ocupado ? "Enviando…" : !falla ? "Elegí qué le pasa" : parada === null ? "Indicá si está parada" : "3. Enviar reporte"}</button></div>
        <button type="button" className="boton" onClick={() => nav(-1)}>Cancelar</button>
      </section>
    </>
  );
}

/** Los reportes que hizo el usuario y en qué quedaron. */
export function MisReportes({ limite }: { limite?: number }) {
  const d = useDatos(), s = useSesion(), tema = useTema();
  const l = d.reportes_falla.filter((r) => r.operario_id === s.usuario!.id).slice(0, limite);
  if (!l.length) return <p className="vacio">Todavía no hiciste {tema.t("reportes").toLowerCase()}.</p>;
  return <div className="lista">{l.map((r) => {
    const e = d.equipo(r.equipo_id);
    const [t, c] = r.estado === "nuevo" ? ["Recibido", "info"] as const : r.estado === "en_orden" ? (e?.estado === "operativo" ? ["Atendido", "ok"] as const : ["En reparación", "alerta"] as const) : ["Descartado", ""] as const;
    return <div key={r.id} className="item"><div className="cuerpo-item"><div className="t">{d.item("tipo_falla", r.tipo_falla)?.nombre || r.tipo_falla} · {e?.nombre}</div>
      <div className="meta"><Codigo>{e?.codigo}</Codigo><span>{hace(r.hecho_en)}</span>{r.parada && <span>máquina parada</span>}{r.motivo_descarte && <span>Motivo: {r.motivo_descarte}</span>}</div></div>
      <Pastilla c={c}>{t}</Pastilla></div>;
  })}</div>;
}
