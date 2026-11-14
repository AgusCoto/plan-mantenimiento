// Listado de equipos con filtros, y hoja de etiquetas (vista previa en escala real y PDF).
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { Codigo, Emp, Pastilla, descargar, avisar } from "../../comun/ui";
import { estadoEquipo } from "../Inicio";
import { EtiquetaVista, pdfEtiquetas } from "../../comun/etiquetas";
import { datosEtiqueta } from "./Recien";
import { Ico } from "../../sistema/iconos";

export function useFiltroEquipos() {
  const d = useDatos();
  const [q, setQ] = useState(""); const [emp, setEmp] = useState(""); const [tipo, setTipo] = useState(""); const [est, setEst] = useState("activos");
  const l = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return d.equipos.filter((e) => (!emp || e.empresa_duena_id === emp || e.empresa_ubicacion_id === emp) && (!tipo || e.tipo === tipo)
      && (est === "activos" ? e.estado !== "baja" : !est || e.estado === est)
      && (!ql || [e.codigo, e.nombre, e.marca, e.modelo, e.serie, e.ubicacion].join(" ").toLowerCase().includes(ql)));
  }, [d.equipos, q, emp, tipo, est]);
  const filtros = (
    <div className="filtros">
      <input type="search" placeholder="Buscar por código, nombre, marca, serie o lugar" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} aria-label="Buscar" />
      <select value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Empresa"><option value="">Todas las empresas</option>{d.empresas.map((e) => <option key={e.id} value={e.id}>{e.sigla} · {e.nombre}</option>)}</select>
      <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo"><option value="">Todos los tipos</option>{d.tipos_equipo.map((t) => <option key={t.sigla} value={t.sigla}>{t.sigla} · {t.nombre}</option>)}</select>
      <select value={est} onChange={(e) => setEst(e.target.value)} aria-label="Estado"><option value="activos">Activos</option><option value="">Todos</option>
        {["operativo", "detenido", "en_reparacion", "reparacion_externa", "baja"].map((k) => <option key={k} value={k}>{estadoEquipo(k)[0]}</option>)}</select>
    </div>
  );
  return { l, filtros };
}

export function Equipos() {
  const d = useDatos(), s = useSesion(), tema = useTema(), nav = useNavigate();
  const { l, filtros } = useFiltroEquipos();
  const jefe = s.usuario!.perfil === "jefe";
  return (
    <>
      <div className="encabezado"><div><h1>{tema.t("equipos")}</h1><p>Código: empresa dueña · tipo · número. Cada equipo tiene su QR y su chip NFC.</p></div><span className="sp" />
        <div className="botones">
          {jefe && <Link className="boton" to="/equipos/etiquetas"><Ico n="qr" />Etiquetas</Link>}
          {jefe && <Link className="boton pri" to="/equipos/nuevo"><Ico n="mas" />{tema.t("relevamiento")}</Link>}
        </div></div>
      {filtros}
      <section className="panel">{l.length ? (
        <div className="tabla"><table><thead><tr><th>Código</th><th>Equipo</th><th>Empresa dueña</th><th>Dónde está</th><th>Estado</th><th className="n">Órdenes abiertas</th></tr></thead><tbody>
          {l.map((e) => { const [t, c] = estadoEquipo(e.estado); const due = d.empresa(e.empresa_duena_id), ubi = d.empresa(e.empresa_ubicacion_id); return (
            <tr className="clic" key={e.id} onClick={() => nav("/equipos/" + e.id)}>
              <td><Codigo>{e.codigo}</Codigo></td><td>{e.nombre}<div className="chico suave">{[e.marca, e.modelo].filter(Boolean).join(" · ")}</div></td>
              <td>{due && <Emp sigla={due.sigla} nombre={due.nombre} />}</td>
              <td>{ubi && ubi.id !== due?.id ? <><Emp sigla={ubi.sigla} nombre={ubi.nombre} /> <Pastilla c="info">En otra empresa</Pastilla></> : null}<div className="chico suave">{[d.areas.find((a) => a.id === e.area_id)?.nombre, e.ubicacion].filter(Boolean).join(" · ")}</div></td>
              <td><Pastilla c={c}>{t}</Pastilla></td>
              <td className="n">{d.ordenes.filter((o) => o.equipo_id === e.id && !["cerrada", "anulada"].includes(o.estado)).length || ""}</td>
            </tr>); })}
        </tbody></table></div>
      ) : <p className="vacio">{d.equipos.length ? "Ningún equipo coincide con el filtro." : "Todavía no hay equipos. " + (jefe ? "Usá «" + tema.t("relevamiento") + "» para cargar el primero." : "")}</p>}</section>
    </>
  );
}

export function Etiquetas() {
  const d = useDatos(), tema = useTema();
  const { l, filtros } = useFiltroEquipos();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [generando, setGenerando] = useState(false);
  const tel = d.conf<string>("telefono_mantenimiento", "");
  const tk = tema.tokens;
  const elegidos = l.filter((e) => sel.has(e.id));
  return (
    <>
      <div className="encabezado"><div><Link to="/equipos" className="chico">← {tema.t("equipos")}</Link><h1>Etiquetas QR y NFC</h1>
        <p>Tamaño {tk.etiqueta.tamano.replace("x", " × ")} mm, para {tk.etiqueta.hoja === "a4" ? "hoja A4" : "impresora de rollo"}. El tamaño, los campos y el logo se cambian en Apariencia → Etiqueta.</p></div></div>
      {filtros}
      <div className="botones">
        <button className="boton" onClick={() => setSel(new Set(l.map((e) => e.id)))}>Elegir los {l.length} filtrados</button>
        <button className="boton" onClick={() => setSel(new Set())} disabled={!sel.size}>Ninguno</button>
        <button className="boton pri" disabled={!elegidos.length || generando} onClick={async () => {
          setGenerando(true);
          try { descargar(`etiquetas-${elegidos.length}.pdf`, await pdfEtiquetas(elegidos.map((e) => datosEtiqueta(d, e)), tk, tel)); }
          catch { avisar("No se pudo generar el PDF."); }
          setGenerando(false);
        }}><Ico n="descargar" />{generando ? "Generando…" : `PDF de ${elegidos.length} etiquetas`}</button>
      </div>
      <p className="chico suave">Vista previa en escala real: según la pantalla puede variar un poco; el PDF sale con la medida exacta. Usá chips NFC aptos para montar sobre metal (NTAG213/215 «anti-metal»).</p>
      <section className="panel" style={{ display: "flex", flexWrap: "wrap", gap: "var(--e3)" }}>
        {l.map((e) => (
          <label key={e.id} style={{ display: "flex", flexDirection: "column", gap: 4, cursor: "pointer" }}>
            <span className="chico"><input type="checkbox" checked={sel.has(e.id)} onChange={(x) => { const n = new Set(sel); x.target.checked ? n.add(e.id) : n.delete(e.id); setSel(n); }} /> {e.codigo}</span>
            <EtiquetaVista d={datosEtiqueta(d, e)} tk={tk} telefono={tel} />
          </label>))}
        {!l.length && <p className="vacio">No hay equipos con este filtro.</p>}
      </section>
    </>
  );
}
