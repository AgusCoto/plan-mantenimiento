// Detalle de una orden: datos, acciones según el perfil y el estado, fichas, costos y pedidos de compra.
import { Link, useParams } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { actualizar, insertar, llamar } from "../../datos/cola";
import { Campo, Codigo, Emp, Pastilla, Ventana, abrir, avisar, confirmar, descargar } from "../../comun/ui";
import { pdfRemito } from "../../comun/informes";
import { Medios, useUrl } from "../../comun/archivos";
import { fd, fdt, nf, pesos } from "../../comun/formato";
import { Ico } from "../../sistema/iconos";
import { ACTIVAS, EstadoOT, NOMBRE_PRIORIDAD, PRIORIDADES, PrioridadOT, TERMINADAS, costoOrden, num4, tecnicosPara, vencida } from "./comun";
import { TarjetaReporte } from "./Reportes";
import { ProveedorCampo, proveedorDe } from "../../comun/proveedor";

import { EstadoPedido } from "../compras/Compras";
import type { Ficha, Orden as TOrden } from "../../datos/tipos";

const err = (x: unknown) => avisar((x as { msg?: string }).msg || "No se pudo hacer el cambio.");

function Editar({ o }: { o: TOrden }) {
  const d = useDatos(), tema = useTema();
  const e = d.equipo(o.equipo_id);
  return (
    <Ventana titulo={"Editar " + tema.t("orden_abrev") + "-" + num4(o.numero)} onSubmit={async (v) => {
      await actualizar("ordenes", o.id, { titulo: v.titulo, descripcion: v.descripcion || null, tipo: v.tipo, vence: v.vence || null, asignado_a: v.asignado || null, contratista_id: await proveedorDe(v, "contratista", d) });
      await d.recargar("ordenes"); avisar("Orden guardada");
    }}>
      <Campo label="Título"><input type="text" name="titulo" required defaultValue={o.titulo} /></Campo>
      <Campo label="Descripción"><textarea name="descripcion" defaultValue={o.descripcion || ""} /></Campo>
      <div className="fila">
        <Campo label="Tipo"><select name="tipo" defaultValue={o.tipo}><option value="correctiva">Correctiva</option><option value="preventiva">Preventiva</option><option value="mejora">Mejora</option></select></Campo>
        <Campo label="Vence"><input type="date" name="vence" defaultValue={o.vence || ""} /></Campo>
      </div>
      <Campo label="Asignada a"><select name="asignado" defaultValue={o.asignado_a || ""}><option value="">Sin asignar</option>{tecnicosPara(d, e).map((u) => <option key={u.id} value={u.id}>{u.nombre} · {tema.t(u.perfil)}</option>)}</select></Campo>
      <ProveedorCampo name="contratista" label={tema.t("contratista")} valor={o.contratista_id} />
    </Ventana>
  );
}
function PedirRepuesto({ o }: { o: TOrden }) {
  const d = useDatos(), tema = useTema();
  return (
    <Ventana titulo="Pedir un repuesto" ok="Pedir" onSubmit={async (v) => {
      await llamar("pedir_repuesto", { p_orden: o.id, p_descripcion: v.descripcion, p_cantidad: Number(v.cantidad.replace(",", ".")) || 1,
        p_monto: v.monto ? Number(v.monto.replace(/\./g, "").replace(",", ".")) : null, p_proveedor: await proveedorDe(v, "proveedor", d) });
      await d.recargar("pedidos_compra", "ordenes"); avisar("Pedido enviado: la orden queda esperando el repuesto");
    }}>
      <p className="chico suave">Se genera un {tema.t("pedido").toLowerCase()} para que lo apruebe el jefe de mantenimiento (si lo pedís vos como jefe, queda aprobado). La orden pasa a «esperando repuesto» hasta que llegue.</p>
      <Campo label="Repuesto *"><input type="text" name="descripcion" required minLength={2} placeholder="Ej.: Rodamiento 6205 2RS" /></Campo>
      <div className="fila">
        <Campo label="Cantidad"><input type="text" name="cantidad" inputMode="decimal" defaultValue="1" /></Campo>
        <Campo label="Monto estimado ($)"><input type="text" name="monto" inputMode="decimal" placeholder="Ej.: 45.000" /></Campo>
      </div>
      <ProveedorCampo name="proveedor" label={tema.t("proveedor")} vacio="Sin indicar" />
    </Ventana>
  );
}
function NuevoCosto({ o, soloRepuesto }: { o: TOrden; soloRepuesto: boolean }) {
  const d = useDatos(), tema = useTema();
  return (
    <Ventana titulo="Agregar costo" onSubmit={async (v) => {
      await insertar("costos_orden", { orden_id: o.id, tipo: v.tipo, descripcion: v.descripcion, cantidad: Number(v.cantidad.replace(",", ".")) || 1,
        costo_unitario: Number((v.unitario || "0").replace(/\./g, "").replace(",", ".")) || 0, proveedor_id: await proveedorDe(v, "proveedor", d), remito: v.remito || null });
      await d.recargar("costos_orden"); avisar("Costo agregado");
    }}>
      <Campo label="Tipo"><select name="tipo" defaultValue="repuesto"><option value="repuesto">Repuesto</option>{!soloRepuesto && <><option value="servicio">Servicio externo</option><option value="otro">Otro</option></>}</select></Campo>
      <Campo label="Descripción *"><input type="text" name="descripcion" required /></Campo>
      <div className="fila">
        <Campo label="Cantidad"><input type="text" name="cantidad" inputMode="decimal" defaultValue="1" /></Campo>
        <Campo label="Costo unitario ($)"><input type="text" name="unitario" inputMode="decimal" /></Campo>
      </div>
      <div className="fila">
        <ProveedorCampo name="proveedor" label={tema.t("proveedor")} vacio="Sin indicar" />
        <Campo label="Remito / factura"><input type="text" name="remito" /></Campo>
      </div>
    </Ventana>
  );
}
function Anular({ o }: { o: TOrden }) {
  const d = useDatos();
  return (
    <Ventana titulo="Anular la orden" ok="Anular" peligro onSubmit={async (v) => {
      await llamar("orden_estado", { p_orden: o.id, p_estado: "anulada", p_motivo: v.motivo });
      await d.recargar("ordenes", "reportes_falla", "equipos"); avisar("Orden anulada");
    }}>
      <p>La orden queda en el historial como anulada. Si venía de un reporte, el reporte vuelve a la bandeja.</p>
      <Campo label="Motivo *"><input type="text" name="motivo" required /></Campo>
    </Ventana>
  );
}
function FirmaVista({ ruta }: { ruta: string }) {
  const u = useUrl("adjuntos", ruta);
  return u ? <img src={u} alt="Firma del supervisor" style={{ maxWidth: 220, background: "#fff", border: "var(--borde) solid var(--linea)", borderRadius: "var(--r-m)" }} /> : null;
}
function TarjetaFicha({ f }: { f: Ficha }) {
  const d = useDatos(), tema = useTema();
  const adj = d.adjuntos.filter((a) => a.tabla === "fichas" && a.registro_id === f.id);
  const quien = d.usuarioDe(f.tecnico_id)?.nombre || d.proveedores.find((p) => p.id === f.contratista_id)?.nombre || "—";
  return (
    <div className="lt" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="f">{fdt(f.hecho_en)} · <b>{quien}</b>{f.contratista_id && <> ({tema.t("contratista").toLowerCase()})</>} {f.es_cierre && <Pastilla c="ok">{tema.t("ficha_cierre")}</Pastilla>}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{f.trabajo}</div>
      <div className="chico suave">{nf.format(Number(f.horas))} h de trabajo{Number(f.horas_parada) ? ` · ${nf.format(Number(f.horas_parada))} h de máquina parada` : ""}{f.causa ? ` · Causa: ${d.item("causa", f.causa)?.nombre || f.causa}` : ""}{f.remito ? ` · Remito ${f.remito}` : ""}</div>
      {adj.length > 0 && <Medios adjuntos={adj} alt="Ficha" />}
      {f.supervisor_nombre && <div className="chico">Verificó: <b>{f.supervisor_nombre}</b> ({tema.t("supervisor").toLowerCase()}){f.firma_ruta && <div><FirmaVista ruta={f.firma_ruta} /></div>}</div>}
    </div>
  );
}

export function Orden() {
  const { id } = useParams();
  const d = useDatos(), s = useSesion(), tema = useTema();
  const o = d.ordenes.find((x) => x.id === id);
  if (!o) return <><h1>{tema.t("orden")}</h1><p className="suave">No existe o no tenés acceso. <Link to="/ordenes">Volver</Link></p></>;
  const u = s.usuario!, p = u.perfil;
  const e = d.equipo(o.equipo_id), emp = d.empresa(o.empresa_cargo_id);
  const gestiona = p === "jefe" || p === "encargado";
  const responsable = gestiona || (p === "tecnico" && o.asignado_a === u.id);
  const activa = ACTIVAS.includes(o.estado), terminada = TERMINADAS.includes(o.estado);
  const fichas = d.fichas.filter((f) => f.orden_id === o.id);
  const pedidos = d.pedidos_compra.filter((x) => x.orden_id === o.id);
  const r = d.reportes_falla.find((x) => x.id === o.reporte_id);
  const costo = costoOrden(d, o.id);
  const ot = `${tema.t("orden_abrev")}-${num4(o.numero)}`;
  const bajarRemito = async (x: TOrden) => {
    try { descargar(`remito-RI-${num4(x.numero)}.pdf`, await pdfRemito(d, tema.tokens, x, ot)); }
    catch { avisar("No se pudo armar el remito. Probá de nuevo con señal."); }
  };
  const estado = (est: string, msg: string) => llamar("orden_estado", { p_orden: o.id, p_estado: est }).then(() => d.recargar("ordenes", "equipos")).then(() => avisar(msg)).catch(err);

  return (
    <>
      <div className="encabezado"><div><Link to="/ordenes" className="chico">← {tema.t("ordenes")}</Link><h1>{ot} · {o.titulo}</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><EstadoOT o={o} /><PrioridadOT p={o.prioridad} />
          {o.parada && <Pastilla c="critico">Máquina parada</Pastilla>}{o.requiere_verificacion && <Pastilla c="info">Equipo crítico: firma producción</Pastilla>}
          {vencida(o) && <Pastilla c="critico">Vencida</Pastilla>}</div></div></div>

      {/* Acciones según perfil y estado */}
      <div className="botones">
        {responsable && ["abierta", "asignada", "esperando_repuesto"].includes(o.estado) && <button className="boton pri" onClick={() => estado("en_curso", "Trabajo empezado")}>Empezar el trabajo</button>}
        {responsable && activa && <Link className="boton" to={`/ordenes/${o.id}/ficha`}><Ico n="ordenes" />Cargar {tema.t("ficha").toLowerCase()}</Link>}
        {responsable && activa && <Link className="boton pri" to={`/ordenes/${o.id}/ficha?cierre=1`}>{tema.t("ficha_cierre")}</Link>}
        {responsable && activa && <button className="boton" onClick={() => abrir(<PedirRepuesto o={o} />)}><Ico n="compras" />Pedir repuesto</button>}
        {gestiona && terminada && <button className="boton pri" onClick={() => confirmar("Cerrar la orden", <>¿Cerrar {ot}? Después ya no se modifica. Se descarga el remito interno de la orden.</>, "Cerrar", async () => {
          await llamar("orden_estado", { p_orden: o.id, p_estado: "cerrada" });
          await d.recargar("ordenes"); avisar("Orden cerrada");
          bajarRemito({ ...o, estado: "cerrada", cerrada_en: new Date().toISOString() });
        })}>Cerrar la orden</button>}
        {(terminada || o.estado === "cerrada") && <button className="boton" onClick={() => bajarRemito(o)}><Ico n="descargar" />Remito interno (PDF)</button>}
        {p === "jefe" && (terminada || o.estado === "cerrada") && <button className="boton" onClick={() => confirmar("Reabrir la orden", <>La orden vuelve a «en curso».</>, "Reabrir", () => llamar("orden_estado", { p_orden: o.id, p_estado: "en_curso" }).then(() => d.recargar("ordenes", "equipos")).then(() => avisar("Orden reabierta")))}>Reabrir</button>}
        {gestiona && !["cerrada", "anulada"].includes(o.estado) && <button className="boton" onClick={() => abrir(<Editar o={o} />)}>Editar / asignar</button>}
        {p === "jefe" && !["cerrada", "anulada"].includes(o.estado) && <button className="boton peligro" onClick={() => abrir(<Anular o={o} />)}>Anular</button>}
      </div>
      {p === "tecnico" && !responsable && activa && <p className="nota">Esta orden está asignada a {d.usuarioDe(o.asignado_a)?.nombre || "otra persona"}. Para trabajar en ella, pedile al encargado que te la asigne.</p>}

      <div className="grilla g2">
        <section className="panel">
          <h2 style={{ marginTop: 0 }}>Datos</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--e1) var(--e3)", margin: 0 }}>
            <dt className="suave">{tema.t("equipo")}</dt><dd style={{ margin: 0 }}>{e && <Link to={"/equipos/" + e.id}><Codigo>{e.codigo}</Codigo></Link>} {e?.nombre}</dd>
            <dt className="suave">Se carga a</dt><dd style={{ margin: 0 }}>{emp && <Emp sigla={emp.sigla} nombre={emp.nombre} />}</dd>
            <dt className="suave">Tipo</dt><dd style={{ margin: 0 }}>{({ correctiva: "Correctiva", preventiva: "Preventiva", mejora: "Mejora" })[o.tipo]}</dd>
            <dt className="suave">Asignada a</dt><dd style={{ margin: 0 }}>{d.usuarioDe(o.asignado_a)?.nombre || d.proveedores.find((x) => x.id === o.contratista_id)?.nombre || "Sin asignar"}</dd>
            <dt className="suave">Creada</dt><dd style={{ margin: 0 }}>{fdt(o.creado_en)} · {d.usuarioDe(o.creado_por)?.nombre}</dd>
            {o.vence && <><dt className="suave">Vence</dt><dd style={{ margin: 0 }}>{fd(o.vence)}</dd></>}
            {o.terminada_en && <><dt className="suave">Terminada</dt><dd style={{ margin: 0 }}>{fdt(o.terminada_en)}</dd></>}
            {o.cerrada_en && <><dt className="suave">Cerrada</dt><dd style={{ margin: 0 }}>{fdt(o.cerrada_en)}</dd></>}
            {o.motivo_anulacion && <><dt className="suave">Anulada</dt><dd style={{ margin: 0 }}>{o.motivo_anulacion}</dd></>}
            <dt className="suave">Prioridad</dt><dd style={{ margin: 0 }}>
              {p === "jefe" && !["cerrada", "anulada"].includes(o.estado) ? (
                <select aria-label="Prioridad" value={o.prioridad} onChange={(x) => llamar("orden_prioridad", { p_orden: o.id, p_prioridad: x.target.value }).then(() => d.recargar("ordenes")).then(() => avisar("Prioridad confirmada")).catch(err)}>
                  {PRIORIDADES.map((k) => <option key={k} value={k}>{NOMBRE_PRIORIDAD[k]}</option>)}</select>) : <PrioridadOT p={o.prioridad} />}
              <div className="chico suave">{o.prioridad_por ? `Confirmada por ${d.usuarioDe(o.prioridad_por)?.nombre || "el jefe"} el ${fd(o.prioridad_en)}` : `Calculada: ${NOMBRE_PRIORIDAD[o.prioridad_calculada]}. El jefe la puede confirmar o cambiar.`}</div>
              {p === "jefe" && !o.prioridad_por && !["cerrada", "anulada"].includes(o.estado) && <button className="boton chico" style={{ marginTop: 4 }} onClick={() => llamar("orden_prioridad", { p_orden: o.id, p_prioridad: o.prioridad }).then(() => d.recargar("ordenes")).then(() => avisar("Prioridad confirmada")).catch(err)}>Confirmar {NOMBRE_PRIORIDAD[o.prioridad].toLowerCase()}</button>}
            </dd>
          </dl>
          {o.descripcion && <p style={{ whiteSpace: "pre-wrap" }}>{o.descripcion}</p>}
        </section>
        <section className="panel">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><h2 style={{ margin: 0 }}>Costos</h2><span className="sp" style={{ flex: 1 }} />
            {(responsable && !["cerrada", "anulada"].includes(o.estado)) && <button className="boton chico" onClick={() => abrir(<NuevoCosto o={o} soloRepuesto={p !== "jefe"} />)}>Agregar</button>}</div>
          <div className="tabla"><table><tbody>
            <tr><td>Mano de obra ({nf.format(costo.horas)} h × {pesos(costo.valorHora)})</td><td className="n">{pesos(costo.manoDeObra)}</td></tr>
            {costo.items.map((c) => <tr key={c.id}><td>{c.descripcion} <span className="chico suave">({c.tipo}{Number(c.cantidad) !== 1 ? `, ${nf.format(Number(c.cantidad))} u.` : ""}{c.remito ? `, remito ${c.remito}` : ""})</span></td><td className="n">{pesos(Number(c.cantidad) * Number(c.costo_unitario))}</td></tr>)}
            <tr><td><b>Total</b></td><td className="n"><b>{pesos(costo.total)}</b></td></tr>
          </tbody></table></div>
          {!costo.valorHora && p === "jefe" && <p className="chico suave">El valor hora del técnico se configura en Compras.</p>}
          {pedidos.length > 0 && <><h3>{tema.t("pedidos")}</h3><div className="lista">{pedidos.map((x) => (
            <Link key={x.id} className="item" to="/compras"><div className="cuerpo-item"><div className="t">PC-{num4(x.numero)} · {x.descripcion}</div><div className="meta"><span>{nf.format(Number(x.cantidad))} u.</span>{x.monto_estimado != null && <span>{pesos(Number(x.monto_estimado))}</span>}{x.respuesta && <span>{x.respuesta}</span>}</div></div><EstadoPedido p={x} /></Link>))}</div></>}
        </section>
      </div>

      {r && <><h2>{tema.t("reporte")} de origen</h2><TarjetaReporte r={r} acciones={false} /></>}

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Fichas ({fichas.length})</h2>
        {fichas.length ? <div className="linea-tiempo">{fichas.map((f) => <TarjetaFicha key={f.id} f={f} />)}</div> : <p className="vacio">Todavía no se cargó ninguna ficha.</p>}
      </section>
    </>
  );
}
