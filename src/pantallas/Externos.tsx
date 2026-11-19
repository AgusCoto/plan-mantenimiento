// Intervenciones externas: equipos que salieron a reparar afuera y trabajos de contratistas en planta.
// Cada caso tiene su informe en PDF (se arma solo con lo cargado) y el listado se exporta a Excel.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDatos } from "../datos/store";
import { useTema } from "../sistema/tema";
import { Codigo, Emp, Pastilla, avisar, descargar } from "../comun/ui";
import { fd, pesos } from "../comun/formato";
import { intervenciones, pdfIntervencion, type Intervencion } from "../comun/informes";
import { xlsx } from "../comun/exportar";
import { Ico } from "../sistema/iconos";
import { hoy } from "../comun/formato";

export function Externos() {
  const d = useDatos(), tema = useTema();
  const [emp, setEmp] = useState(""); const [tipo, setTipo] = useState(""); const [desde, setDesde] = useState(""); const [hasta, setHasta] = useState(""); const [q, setQ] = useState("");
  const [armando, setArmando] = useState<string | null>(null);
  const todas = useMemo(() => intervenciones(d), [d]);
  const l = todas.filter((x) => {
    const e = d.equipo(x.equipoId), f = x.fecha.slice(0, 10), ql = q.trim().toLowerCase();
    return (!emp || e?.empresa_duena_id === emp || e?.empresa_ubicacion_id === emp) && (!tipo || x.tipo === tipo) && (!desde || f >= desde) && (!hasta || f <= hasta)
      && (!ql || [e?.codigo, e?.nombre, x.quien, x.detalle].join(" ").toLowerCase().includes(ql));
  });
  const nombreTipo = (x: Intervencion) => (x.tipo === "reparacion_externa" ? tema.t("reparacion_externa") : "Trabajo de " + tema.t("contratista").toLowerCase());
  async function pdf(x: Intervencion) {
    setArmando(x.id);
    try { descargar(`intervencion-externa-${d.equipo(x.equipoId)?.codigo || ""}-${x.fecha.slice(0, 10)}.pdf`, await pdfIntervencion(d, tema.tokens, x, tema.t("orden_abrev"))); }
    catch { avisar("No se pudo armar el informe. Probá de nuevo con señal."); }
    setArmando(null);
  }
  function excel() {
    const cols = ["Fecha", "Tipo", "Equipo", "Nombre del equipo", "Empresa dueña", "Externo", "Detalle", "Estado", "Costo", "Remito", "Garantía hasta", "Vuelta", "Orden"];
    const filas = l.map((x) => { const e = d.equipo(x.equipoId); return [fd(x.fecha), nombreTipo(x), e?.codigo || "", e?.nombre || "", d.empresa(e?.empresa_duena_id)?.sigla || "", x.quien, x.detalle, x.estado,
      x.costo ?? "", x.mov?.remito || x.ficha?.remito || "", x.mov?.garantia_hasta ? fd(x.mov.garantia_hasta) : "", x.mov?.fecha_vuelta ? fd(x.mov.fecha_vuelta) : "",
      x.orden ? tema.t("orden_abrev") + "-" + String(x.orden.numero).padStart(4, "0") : ""]; });
    descargar(`intervenciones-externas-${hoy()}.xlsx`, xlsx([{ nombre: "Intervenciones externas", cols, filas }]));
  }
  const fuera = todas.filter((x) => x.tipo === "reparacion_externa" && x.mov?.estado === "en_curso").length;
  return (
    <>
      <div className="encabezado"><div><h1>Intervenciones externas</h1>
        <p>Cada vez que un equipo sale de planta para repararlo, o un {tema.t("contratista").toLowerCase()} trabaja en él, queda acá con su informe en PDF.{fuera ? ` Ahora hay ${fuera} ${fuera === 1 ? "equipo" : "equipos"} fuera de planta.` : ""}</p></div><span className="sp" />
        <button className="boton" onClick={excel} disabled={!l.length}><Ico n="descargar" />Excel</button></div>
      <div className="filtros">
        <input type="search" placeholder="Buscar equipo, taller o trabajo" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Buscar" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo"><option value="">Todos los casos</option><option value="reparacion_externa">{tema.t("reparacion_externa")}</option><option value="contratista">Trabajos de {tema.t("contratista").toLowerCase()}s</option></select>
        <select value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Empresa"><option value="">Todas las empresas</option>{d.empresas.map((e) => <option key={e.id} value={e.id}>{e.sigla} · {e.nombre}</option>)}</select>
        <label className="chico" style={{ display: "flex", gap: 4, alignItems: "center" }}>Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="chico" style={{ display: "flex", gap: 4, alignItems: "center" }}>Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      <section className="panel">{l.length ? (
        <div className="tabla"><table><thead><tr><th>Fecha</th><th>Equipo</th><th>Caso</th><th>Quién</th><th>Detalle</th><th className="n">Costo</th><th></th></tr></thead><tbody>
          {l.map((x) => { const e = d.equipo(x.equipoId), due = d.empresa(e?.empresa_duena_id); return (
            <tr key={x.id}>
              <td className="num">{fd(x.fecha)}</td>
              <td>{e && <Link to={"/equipos/" + e.id}><Codigo>{e.codigo}</Codigo></Link>}<div className="chico">{e?.nombre}</div>{due && <div className="chico"><Emp sigla={due.sigla} nombre={due.sigla} /></div>}</td>
              <td>{nombreTipo(x)}<div><Pastilla c={x.mov?.estado === "en_curso" ? "alerta" : "ok"}>{x.estado}</Pastilla></div></td>
              <td>{x.quien}</td>
              <td className="chico">{x.detalle}{x.orden && <div><Link to={"/ordenes/" + x.orden.id}>{tema.t("orden_abrev")}-{String(x.orden.numero).padStart(4, "0")}</Link></div>}</td>
              <td className="n">{x.costo != null ? pesos(x.costo) : "—"}</td>
              <td><button className="boton chico" disabled={armando === x.id} onClick={() => pdf(x)}><Ico n="descargar" />{armando === x.id ? "Armando…" : "Informe PDF"}</button></td>
            </tr>); })}
        </tbody></table></div>
      ) : <p className="vacio">{todas.length ? "Ningún caso coincide con el filtro." : `Todavía no hay intervenciones externas. Aparecen cuando un equipo se manda a reparar afuera (botón «${tema.t("reparacion_externa")}» en la ficha del equipo) o cuando el jefe carga una ficha a nombre de un ${tema.t("contratista").toLowerCase()}.`}</p>}</section>
    </>
  );
}
