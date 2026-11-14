// Bandeja de reportes de falla: el jefe o el encargado crean la orden o descartan el reporte.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { llamar } from "../../datos/cola";
import { Campo, Codigo, Emp, Pastilla, Ventana, abrir, avisar } from "../../comun/ui";
import { Medios } from "../../comun/archivos";
import { fdt, hace } from "../../comun/formato";
import { Ico } from "../../sistema/iconos";
import { num4 } from "./comun";
import type { Reporte } from "../../datos/tipos";

function Descartar({ r }: { r: Reporte }) {
  const d = useDatos();
  return (
    <Ventana titulo="Descartar el reporte" ok="Descartar" peligro onSubmit={async (v) => {
      await llamar("descartar_reporte", { p_reporte: r.id, p_motivo: v.motivo });
      await d.recargar("reportes_falla"); avisar("Reporte descartado");
    }}>
      <p>El operario va a ver el motivo en «Mis reportes».</p>
      <Campo label="Motivo *"><input type="text" name="motivo" required placeholder="Ej.: ya resuelto en la OT-0012, falsa alarma…" /></Campo>
    </Ventana>
  );
}

export function TarjetaReporte({ r, acciones = true }: { r: Reporte; acciones?: boolean }) {
  const d = useDatos(), s = useSesion(), tema = useTema();
  const e = d.equipo(r.equipo_id), ubi = d.empresa(e?.empresa_ubicacion_id);
  const gestiona = ["jefe", "encargado"].includes(s.usuario!.perfil);
  const orden = d.ordenes.find((o) => o.id === r.orden_id);
  const adj = d.adjuntos.filter((a) => a.tabla === "reportes_falla" && a.registro_id === r.id);
  return (
    <article className="panel" style={{ display: "flex", flexDirection: "column", gap: "var(--e2)" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <b style={{ fontSize: "var(--t-l)" }}>{d.item("tipo_falla", r.tipo_falla)?.nombre || r.tipo_falla}</b>
        {r.parada && <Pastilla c="critico">Máquina parada</Pastilla>}
        {r.estado === "en_orden" && <Pastilla c="info">En orden</Pastilla>}
        {r.estado === "descartado" && <Pastilla>Descartado</Pastilla>}
        <span className="sp" style={{ flex: 1 }} /><span className="chico suave" title={fdt(r.hecho_en)}>{hace(r.hecho_en)}</span>
      </div>
      <div className="meta" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {e && <Link to={"/equipos/" + e.id}><Codigo>{e.codigo}</Codigo></Link>}<span>{e?.nombre}</span>
        {ubi && <Emp sigla={ubi.sigla} nombre={ubi.nombre} />}<span className="suave">{e?.ubicacion}</span>
      </div>
      {r.texto && <p style={{ margin: 0 }}>«{r.texto}»</p>}
      <div className="chico suave">Reportó {d.usuarioDe(r.operario_id)?.nombre || "—"} · {fdt(r.hecho_en)}</div>
      {adj.length > 0 && <Medios adjuntos={adj} alt={"Reporte de " + (e?.codigo || "")} />}
      {r.motivo_descarte && <div className="chico">Motivo del descarte: {r.motivo_descarte}</div>}
      {orden && <div><Link to={"/ordenes/" + orden.id}>{tema.t("orden_abrev")}-{num4(orden.numero)} · {orden.titulo}</Link></div>}
      {acciones && gestiona && r.estado === "nuevo" && <div className="botones">
        <Link className="boton pri" to={"/ordenes/nueva?reporte=" + r.id}><Ico n="ordenes" />Crear {tema.t("orden_abrev")}</Link>
        <button className="boton" onClick={() => abrir(<Descartar r={r} />)}>Descartar</button>
      </div>}
    </article>
  );
}

export function Reportes() {
  const d = useDatos(), tema = useTema();
  const [ver, setVer] = useState<"nuevo" | "todos">("nuevo");
  const nuevos = d.reportes_falla.filter((r) => r.estado === "nuevo");
  // Primero los de máquina parada
  const l = ver === "nuevo" ? [...nuevos].sort((a, b) => Number(b.parada) - Number(a.parada) || b.hecho_en.localeCompare(a.hecho_en)) : d.reportes_falla.slice(0, 200);
  return (
    <>
      <div className="encabezado"><div><h1>{tema.t("reportes")}</h1><p>Lo que reportan los operarios desde la etiqueta de cada máquina.</p></div><span className="sp" />
        <Link className="boton" to="/reportar"><Ico n="mas" />{tema.t("reportar")}</Link></div>
      <div className="pestanas" role="tablist">
        <button role="tab" aria-selected={ver === "nuevo"} className={ver === "nuevo" ? "activa" : ""} onClick={() => setVer("nuevo")}>Sin atender ({nuevos.length})</button>
        <button role="tab" aria-selected={ver === "todos"} className={ver === "todos" ? "activa" : ""} onClick={() => setVer("todos")}>Todos</button>
      </div>
      {l.length ? <div className="grilla g2">{l.map((r) => <TarjetaReporte key={r.id} r={r} />)}</div>
        : <p className="vacio">{ver === "nuevo" ? "No hay reportes sin atender." : "Todavía no hay reportes."}</p>}
    </>
  );
}
