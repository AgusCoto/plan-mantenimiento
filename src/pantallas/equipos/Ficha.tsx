// Ficha del equipo: placa con sus datos, QR, historial, órdenes, documentos y movimientos.
// El jefe ve todo y edita; el técnico entra directo al historial y las órdenes.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { Codigo, Emp, Pastilla, Ventana, abrir, avisar, descargar, Campo, confirmar } from "../../comun/ui";
import { fd, fdt, nf, pesos } from "../../comun/formato";
import { estadoEquipo } from "../Inicio";
import { enlaceEquipo, qrDataUrl } from "../../comun/qr";
import { pdfEtiquetas } from "../../comun/etiquetas";
import { Captura, urlFirmada, useUrl, type Medio } from "../../comun/archivos";
import { insertar, actualizar, llamar } from "../../datos/cola";
import { BotonNFC, datosEtiqueta } from "./Recien";
import { Ico } from "../../sistema/iconos";
import { AccionesEquipo } from "../movimientos/AccionesEquipo";
import { pdfBaja } from "../../comun/informes";
import { subirDocumento, subirFotosEquipo } from "../../comun/documentos";
import { FormPreventivo, ListaPrev } from "../preventivos/Preventivos";
import { estadoPrev } from "../preventivos/comun";
import { ESTADOS_MOV } from "../movimientos/Movimientos";
import type { Documento, Equipo } from "../../datos/tipos";

export const CATEGORIAS: Record<string, string> = { chapa: "Foto de la chapa", foto: "Foto", manual: "Manual del fabricante", plano: "Plano eléctrico", plc: "Programa de PLC", bloqueo: "Bloqueo y etiquetado", configuracion: "Foto de configuración", otro: "Otro" };

function Qr({ codigo }: { codigo: string }) {
  const [u, setU] = useState("");
  useEffect(() => { qrDataUrl(enlaceEquipo(codigo), 240).then(setU); }, [codigo]);
  return <div className="qr" aria-label={"QR de " + codigo}>{u && <img src={u} alt="" />}</div>;
}
function Miniatura({ doc }: { doc: Documento }) {
  const u = useUrl(doc.bucket, doc.ruta);
  return u ? <img src={u} alt={doc.nombre} style={{ width: 120, height: 90, objectFit: "cover", borderRadius: "var(--r-m)", border: "var(--borde) solid var(--linea)" }} /> : null;
}
const ES_FOTO = (x: Documento) => ["chapa", "foto", "configuracion"].includes(x.categoria) || (x.mime || "").startsWith("image/");
function FotoGaleria({ doc }: { doc: Documento }) {
  const u = useUrl(doc.bucket, doc.ruta);
  const nombre = doc.categoria === "chapa" ? "Chapa" : doc.nombre;
  return <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 2, width: 120 }}>
    {u ? <img src={u} alt={nombre} loading="lazy" onClick={() => abrir(<Ventana titulo={nombre}><img src={u} alt={nombre} style={{ maxWidth: "100%", borderRadius: "var(--r-m)" }} /></Ventana>)} /> : <div className="ph">Cargando…</div>}
    <figcaption className="chico suave" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</figcaption>
  </figure>;
}
/** Sumar fotos al equipo: se van acumulando (cámara o galería) y se guardan todas juntas. */
export function NuevasFotos({ e }: { e: Equipo }) {
  const d = useDatos();
  const [medios, setMedios] = useState<Medio[]>([]);
  return (
    <Ventana titulo="Agregar fotos" ok={medios.length > 1 ? `Guardar ${medios.length} fotos` : "Guardar foto"} onSubmit={async (v) => {
      if (!medios.length) throw { msg: "Sacá o elegí al menos una foto." };
      const n = await subirFotosEquipo(e.id, medios, v.nombre);
      await d.recargar("documentos"); avisar(n > 1 ? `${n} fotos agregadas` : "Foto agregada");
    }}>
      <p className="chico suave" style={{ margin: 0 }}>Podés sacar varias seguidas o elegirlas de la galería: se van sumando. Tocá × para quitar una antes de guardar.</p>
      <Captura medios={medios} setMedios={setMedios} video={false} compacto />
      <Campo label="Descripción (opcional)"><input type="text" name="nombre" placeholder="Ej.: Tablero eléctrico, vista lateral…" /></Campo>
    </Ventana>
  );
}
/** Cargar manuales y documentos. Sin equipo, pide elegirlo (desde Menú → Manuales). */
export function NuevoDocumento({ e, categoria = "manual" }: { e?: Equipo; categoria?: string }) {
  const d = useDatos();
  const [eq, setEq] = useState(e?.id || "");
  return (
    <Ventana titulo={categoria === "manual" ? "Cargar manual" : "Agregar documento"} onSubmit={async (v, f) => {
      const archivos = Array.from((f.querySelector("input[type=file]") as HTMLInputElement).files || []);
      if (!eq) throw { msg: "Elegí el equipo." };
      if (!archivos.length && !v.url) throw { msg: "Elegí un archivo o pegá un enlace." };
      const max = Number(d.conf("documento_max_mb", 25));
      for (const a of archivos) await subirDocumento(eq, a, v.categoria, archivos.length === 1 ? v.nombre : null, max);
      if (!archivos.length) await insertar("documentos", { equipo_id: eq, categoria: v.categoria, nombre: v.nombre || "Documento", url: v.url });
      await d.recargar("documentos"); avisar(archivos.length > 1 ? `${archivos.length} documentos cargados` : "Documento cargado");
    }}>
      {!e && <Campo label="Equipo *"><select required value={eq} onChange={(x) => setEq(x.target.value)} aria-label="Equipo"><option value="">Elegí…</option>
        {d.equipos.filter((x) => x.estado !== "baja").map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}</select></Campo>}
      <Campo label="Tipo"><select name="categoria" defaultValue={categoria}>{Object.entries(CATEGORIAS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Campo>
      <Campo label="Archivo" ayuda="PDF, foto, programa de PLC… Podés elegir varios a la vez. Hasta 25 MB cada uno."><input type="file" multiple accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.zip,.txt,.dwg,application/pdf" /></Campo>
      <Campo label="Nombre (opcional)"><input type="text" name="nombre" placeholder="Ej.: Manual de operación y mantenimiento (si no, va el nombre del archivo)" /></Campo>
      <Campo label="…o un enlace (si el manual está en la web del fabricante)"><input type="url" name="url" placeholder="https://" /></Campo>
    </Ventana>
  );
}
export function AbrirDoc({ doc }: { doc: Documento }) {
  return <a href={doc.url || "#"} target="_blank" rel="noopener" className="t" onClick={async (ev) => {
    if (doc.url) return;
    ev.preventDefault();
    const w = window.open("about:blank", "_blank");
    const u = doc.bucket && doc.ruta ? await urlFirmada(doc.bucket, doc.ruta) : null;
    if (u && w) w.location.href = u; else { w?.close(); avisar("No se pudo abrir el documento."); }
  }}>{doc.nombre}</a>;
}

export function Ficha() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const d = useDatos(), s = useSesion(), tema = useTema();
  const perfil = s.usuario!.perfil;
  const [tab, setTab] = useState(qs.get("vista") === "tecnico" ? "ordenes" : "historial");
  const e = d.equipo(id);
  if (!e) return <><h1>{tema.t("equipo")} no encontrado</h1><p className="suave">No existe o no tenés acceso a su empresa. <Link to="/equipos">Volver</Link></p></>;
  const tipo = d.tipos_equipo.find((t) => t.sigla === e.tipo);
  const due = d.empresa(e.empresa_duena_id), ubi = d.empresa(e.empresa_ubicacion_id);
  const ordenes = d.ordenes.filter((o) => o.equipo_id === e.id);
  const ids = new Set(ordenes.map((o) => o.id));
  const fichas = d.fichas.filter((f) => ids.has(f.orden_id));
  const reportes = d.reportes_falla.filter((r) => r.equipo_id === e.id);
  const movs = d.movimientos_equipo.filter((m) => m.equipo_id === e.id);
  const bajaMov = e.estado === "baja" ? movs.filter((m) => m.tipo === "baja").sort((a, b) => b.creado_en.localeCompare(a.creado_en))[0] : undefined;
  const docs = d.documentos.filter((x) => x.equipo_id === e.id && x.activo);
  const chapa = docs.find((x) => x.categoria === "chapa");
  const ot = (n: number) => `${tema.t("orden_abrev")}-${String(n).padStart(4, "0")}`;
  const hist: { ts: string; c: string; h: ReactNode; k: string }[] = [];
  ordenes.forEach((o) => hist.push({ ts: o.creado_en, c: "orden", k: "o" + o.id, h: <><Link to={"/ordenes/" + o.id}><b>{ot(o.numero)}</b></Link> {o.titulo} · {d.item("estado_orden", o.estado)?.nombre}</> }));
  fichas.forEach((f) => { const o = ordenes.find((x) => x.id === f.orden_id)!; hist.push({ ts: f.hecho_en, c: f.es_cierre ? "ok" : "orden", k: "f" + f.id,
    h: <>{f.es_cierre ? "Cierre" : tema.t("ficha")} de <b>{d.usuarioDe(f.tecnico_id)?.nombre || d.proveedores.find((p) => p.id === f.contratista_id)?.nombre || "—"}</b> ({ot(o.numero)}): {f.trabajo} · {nf.format(f.horas)} h{f.horas_parada ? ` · ${nf.format(f.horas_parada)} h parada` : ""}</> }); });
  reportes.forEach((r) => hist.push({ ts: r.hecho_en, c: "falla", k: "r" + r.id, h: <>{tema.t("reporte")}: <b>{d.item("tipo_falla", r.tipo_falla)?.nombre}</b>{r.parada ? " (máquina parada)" : ""}{r.texto ? ` — ${r.texto}` : ""} · {d.usuarioDe(r.operario_id)?.nombre || ""}</> }));
  movs.forEach((m) => hist.push({ ts: m.creado_en, c: "mov", k: "m" + m.id, h: <>{({ prestamo: tema.t("prestamo"), reparacion_externa: tema.t("reparacion_externa"), baja: "Baja", reubicacion: "Reubicación" } as Record<string, string>)[m.tipo]} · {m.estado}{m.motivo ? ` — ${m.motivo}` : ""}</> }));
  hist.sort((a, b) => b.ts.localeCompare(a.ts));
  const [est, c] = estadoEquipo(e.estado);
  const verDocs = ["jefe", "encargado", "tecnico"].includes(perfil);
  const fotos = docs.filter(ES_FOTO);
  const manuales = docs.filter((x) => ["manual", "plano", "plc", "bloqueo"].includes(x.categoria));
  const prevs = d.preventivos.filter((p) => p.equipo_id === e.id && p.activo);
  const tabs: [string, string][] = [["historial", "Historial"], ["ordenes", `${tema.t("ordenes")} (${ordenes.length})`], ["preventivos", `Preventivos (${prevs.length})`], ...(verDocs ? [["documentos", `Documentos (${docs.length})`] as [string, string]] : []), ["movimientos", `${tema.t("movimientos")} (${movs.length})`], ["datos", "Datos"]];
  const tel = d.conf<string>("telefono_mantenimiento", "");
  return (
    <>
      <div className="encabezado"><div><Link to="/equipos" className="chico">← {tema.t("equipos")}</Link><h1>{e.nombre}</h1></div><span className="sp" />
        <div className="botones">
          {e.estado !== "baja" && <Link className="boton" to={"/reportar/" + e.id}><Ico n="reportes" />{tema.t("reportar")}</Link>}
          {["jefe", "encargado"].includes(perfil) && e.estado !== "baja" && <Link className="boton pri" to={"/ordenes/nueva?equipo=" + e.id}><Ico n="mas" />Nueva {tema.t("orden_abrev")}</Link>}
          {perfil === "jefe" && <Link className="boton" to={`/equipos/${e.id}/editar`}>Editar ficha</Link>}
          {perfil === "jefe" && e.estado !== "baja" && <button className="boton" onClick={() => abrir(<NuevoDocumento e={e} />)}><Ico n="libro" />Cargar manual</button>}
          <AccionesEquipo e={e} />
          {e.estado === "baja" && ["jefe", "encargado", "direccion"].includes(perfil) && <button className="boton" onClick={async () => {
            try { descargar(`informe-baja-${e.codigo}.pdf`, await pdfBaja(d, tema.tokens, e.id, tema.t("orden_abrev"))); } catch { avisar("No se pudo armar el informe de baja."); }
          }}><Ico n="descargar" />Informe de baja (PDF)</button>}
        </div></div>
      <div className="placa">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Codigo style={{ fontSize: "var(--t-l)" }}>{e.codigo}</Codigo><Pastilla c={c}>{est}</Pastilla><Pastilla c={e.criticidad === "alta" ? "critico" : ""}>Criticidad {e.criticidad}</Pastilla></div>
          <dl>
            <dt>Tipo</dt><dd>{tipo?.nombre || e.tipo}</dd>
            <dt>Marca / modelo</dt><dd>{[e.marca, e.modelo].filter(Boolean).join(" · ") || "—"}</dd>
            {e.serie && <><dt>N.º de serie</dt><dd>{e.serie}</dd></>}
            {(e.potencia || e.tension) && <><dt>Potencia / tensión</dt><dd>{[e.potencia, e.tension].filter(Boolean).join(" · ")}</dd></>}
            <dt>Empresa dueña</dt><dd>{due && <Emp sigla={due.sigla} nombre={due.nombre} />}</dd>
            <dt>Dónde está</dt><dd>{ubi && <Emp sigla={ubi.sigla} nombre={ubi.nombre} />}{ubi?.id !== due?.id && <> <Pastilla c="info">En otra empresa</Pastilla></>}<div className="chico suave">{[d.areas.find((a) => a.id === e.area_id)?.nombre, e.ubicacion].filter(Boolean).join(" · ") || ""}</div></dd>
            {e.horometro != null && <><dt>{tema.t("horometro")}</dt><dd>{nf.format(e.horometro)} h <span className="chico suave">({fd(e.horometro_fecha)})</span></dd></>}
            {verDocs && <><dt>Manuales</dt><dd>{manuales.length ? manuales.map((m, i) => <span key={m.id}>{i > 0 && " · "}<AbrirDoc doc={m} /></span>)
              : <span className="suave">{perfil === "jefe" ? "Ninguno cargado: tocá «Cargar manual»" : "Ninguno cargado"}</span>}</dd></>}
            <dt>Alta</dt><dd>{fd(e.creado_en)}{d.usuarioDe(e.creado_por) ? " · " + d.usuarioDe(e.creado_por)!.nombre : ""}</dd>
          </dl>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
          <Qr codigo={e.codigo} />
          {chapa && <Miniatura doc={chapa} />}
          <button className="boton chico" onClick={async () => descargar(`etiqueta-${e.codigo}.pdf`, await pdfEtiquetas([datosEtiqueta(d, e)], { ...tema.tokens, etiqueta: { ...tema.tokens.etiqueta, hoja: "rollo" } }, tel))}>Etiqueta PDF</button>
          {perfil === "jefe" && <BotonNFC codigo={e.codigo} />}
        </div>
      </div>
      {verDocs && (fotos.length > 0 || perfil === "jefe") && <section className="panel fotos-equipo">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--e2)" }}><h2 style={{ margin: 0 }}>Fotos ({fotos.length})</h2><span className="sp" />
          {perfil === "jefe" && e.estado !== "baja" && <button className="boton chico" onClick={() => abrir(<NuevasFotos e={e} />)}><Ico n="camara" />Agregar fotos</button>}</div>
        {fotos.length ? <div className="medios">{fotos.map((x) => <FotoGaleria key={x.id} doc={x} />)}</div> : <p className="vacio" style={{ margin: 0 }}>Sin fotos. Tocá «Agregar fotos»: podés cargar todas las que quieras.</p>}
      </section>}
      {bajaMov && <div className="nota" role="note">
        <b>Dado de baja el {fd(bajaMov.fecha_salida || bajaMov.creado_en)}</b> · destino: {d.item("destino_baja", bajaMov.destino_baja)?.nombre || bajaMov.destino_baja}
        {bajaMov.receptor ? ` · retira: ${bajaMov.receptor}` : ""}{bajaMov.valor_recupero != null ? ` · valor de recupero: ${pesos(Number(bajaMov.valor_recupero))}` : ""}
        {" · "}decidió {d.usuarioDe(bajaMov.resuelto_por || bajaMov.creado_por)?.nombre || "—"}
        <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>Motivo: {bajaMov.motivo}</div>
      </div>}
      <section className="panel">
        <div className="pestanas" role="tablist">{tabs.map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "activa" : ""} onClick={() => setTab(k)}>{n}</button>)}</div>
        <div style={{ paddingTop: "var(--e3)" }}>
          {tab === "historial" && (hist.length ? <div className="linea-tiempo">{hist.map((x) => <div key={x.k} className={"lt " + x.c}><div className="f">{fdt(x.ts)}</div><div>{x.h}</div></div>)}</div> : <p className="vacio">Sin historial todavía.</p>)}
          {tab === "ordenes" && (ordenes.length ? <div className="lista">{[...ordenes].sort((a, b) => b.numero - a.numero).map((o) => (
            <Link key={o.id} className="item" to={"/ordenes/" + o.id}><div className="cuerpo-item"><div className="t">{ot(o.numero)} · {o.titulo}</div><div className="meta"><span>{fd(o.creado_en)}</span><span>{d.usuarioDe(o.asignado_a)?.nombre}</span></div></div>
              <Pastilla c={["cerrada", "verificada", "terminada"].includes(o.estado) ? "ok" : "alerta"}>{d.item("estado_orden", o.estado)?.nombre}</Pastilla></Link>))}</div> : <p className="vacio">Sin {tema.t("ordenes").toLowerCase()}.</p>)}
          {tab === "documentos" && <>
            {docs.length ? <div className="lista">{docs.map((x) => (
              <div key={x.id} className="item"><div className="cuerpo-item"><AbrirDoc doc={x} /><div className="meta"><span>{CATEGORIAS[x.categoria]}</span><span>{fd(x.creado_en)}</span>{x.bytes ? <span>{nf.format(x.bytes / 1048576)} MB</span> : null}</div></div>
                {perfil === "jefe" && <button className="boton chico" onClick={() => confirmar("Quitar documento", <>¿Quitar «{x.nombre}»? Queda guardado en el historial.</>, "Quitar", async () => { await actualizar("documentos", x.id, { activo: false }); await d.recargar("documentos"); })}>Quitar</button>}</div>))}</div>
              : <p className="vacio">Sin documentos. Se cargan manuales, planos eléctricos, programas de PLC, procedimientos de bloqueo y etiquetado y fotos de configuración.</p>}
            {perfil === "jefe" && <button className="boton" style={{ marginTop: "var(--e3)" }} onClick={() => abrir(<NuevoDocumento e={e} />)}>Agregar documento</button>}
          </>}
          {tab === "movimientos" && (movs.length ? <div className="tabla"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>
            {movs.map((m) => <tr key={m.id}><td className="num">{fd(m.creado_en)}</td><td>{({ prestamo: tema.t("prestamo"), reparacion_externa: tema.t("reparacion_externa"), baja: "Baja", reubicacion: "Reubicación" } as Record<string, string>)[m.tipo]}</td><td><Pastilla c={ESTADOS_MOV[m.estado][1]}>{ESTADOS_MOV[m.estado][0]}</Pastilla></td>
              <td className="chico">{[m.empresa_destino_id && d.empresa(m.empresa_destino_id)?.sigla, m.motivo, m.presupuesto ? pesos(m.presupuesto) : null, m.remito && "Remito " + m.remito, m.destino_baja].filter(Boolean).join(" · ")}</td></tr>)}
          </tbody></table></div> : <p className="vacio">Sin movimientos.</p>)}
          {tab === "preventivos" && <>
            <ListaPrev items={prevs.map((p) => ({ p, e, estado: estadoPrev(p, e) }))} mostrarEquipo={false} />
            {perfil === "jefe" && e.estado !== "baja" && <button className="boton" style={{ marginTop: "var(--e3)" }} onClick={() => abrir(<FormPreventivo equipoId={e.id} />)}><Ico n="mas" />Tarea preventiva</button>}
          </>}
          {tab === "datos" && <dl className="placa" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--e1) var(--e3)", margin: 0 }}>
            {(tipo?.campos || []).filter((c) => c.tipo !== "foto").map((c) => <Fragment key={c.clave}><dt className="suave">{c.etiqueta}</dt><dd style={{ margin: 0 }}>{e.campos?.[c.clave] != null && e.campos[c.clave] !== "" ? String(e.campos[c.clave]) + (c.unidad ? " " + c.unidad : "") : "—"}</dd></Fragment>)}
            <dt className="suave">{tema.t("proveedor")}</dt><dd style={{ margin: 0 }}>{d.proveedores.find((p) => p.id === e.proveedor_id)?.nombre || "—"}</dd>
            <dt className="suave">Planos</dt><dd style={{ margin: 0 }}>{e.planos || "—"}</dd>
            <dt className="suave">Notas</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{e.notas || "—"}</dd>
            {["jefe", "encargado", "tecnico"].includes(perfil) && <><dt className="suave">{tema.t("horometro")}</dt><dd style={{ margin: 0 }}><Horometro e={e} /></dd></>}
          </dl>}
        </div>
      </section>
    </>
  );
}
function Horometro({ e }: { e: Equipo }) {
  const d = useDatos();
  const [v, setV] = useState(e.horometro != null ? String(e.horometro) : "");
  return <span className="botones" style={{ alignItems: "center" }}><input type="text" inputMode="decimal" pattern="[0-9]+([,.][0-9]+)?" value={v} onChange={(x) => setV(x.target.value)} style={{ maxWidth: 140 }} aria-label="Horómetro" /> h
    <button className="boton chico" onClick={async () => { try { await llamar("cargar_horometro", { p_equipo: e.id, p_valor: Number(v.replace(",", ".")) }); await d.recargar("equipos"); avisar("Horómetro cargado"); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo cargar"); } }}>Cargar lectura</button></span>;
}
