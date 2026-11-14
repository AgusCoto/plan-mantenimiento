// Pedidos de compra: dirección aprueba o rechaza (el jefe, solo debajo del tope configurado);
// el jefe o el encargado registran cuando llega. Al llegar todo, la orden vuelve a «en curso».
import { useState } from "react";
import { Link } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { actualizar, insertar, llamar } from "../../datos/cola";
import { Campo, Codigo, Emp, Pastilla, Ventana, abrir, avisar, confirmar, type ColorEstado } from "../../comun/ui";
import { fd, nf, pesos } from "../../comun/formato";
import { Ico } from "../../sistema/iconos";
import { num4 } from "../ordenes/comun";
import type { Pedido } from "../../datos/tipos";

const ESTADOS: Record<Pedido["estado"], [string, ColorEstado]> = {
  pendiente: ["Por aprobar", "alerta"], aprobado: ["Aprobado", "info"], rechazado: ["Rechazado", "critico"], recibido: ["Recibido", "ok"], anulado: ["Anulado", ""],
};
export const EstadoPedido = ({ p }: { p: Pedido }) => <Pastilla c={ESTADOS[p.estado][1]}>{ESTADOS[p.estado][0]}</Pastilla>;
const monto = (s: string) => (s ? Number(s.replace(/\./g, "").replace(",", ".")) : null);

function Resolver({ p, aprobar }: { p: Pedido; aprobar: boolean }) {
  const d = useDatos();
  return (
    <Ventana titulo={(aprobar ? "Aprobar" : "Rechazar") + " PC-" + num4(p.numero)} ok={aprobar ? "Aprobar" : "Rechazar"} peligro={!aprobar} onSubmit={async (v) => {
      await llamar("resolver_pedido", { p_pedido: p.id, p_aprobar: aprobar, p_respuesta: v.respuesta || null });
      await d.recargar("pedidos_compra"); avisar(aprobar ? "Pedido aprobado" : "Pedido rechazado");
    }}>
      <p><b>{p.descripcion}</b> · {nf.format(Number(p.cantidad))} u.{p.monto_estimado != null ? ` · ${pesos(Number(p.monto_estimado))}` : ""}</p>
      <Campo label={aprobar ? "Comentario (opcional)" : "Motivo del rechazo *"}><input type="text" name="respuesta" required={!aprobar} /></Campo>
      <p className="chico suave">Queda registrado con tu nombre en el registro de cambios.</p>
    </Ventana>
  );
}
function NuevoPedido() {
  const d = useDatos(), tema = useTema();
  return (
    <Ventana titulo={"Nuevo " + tema.t("pedido").toLowerCase()} ok="Pedir" onSubmit={async (v) => {
      await insertar("pedidos_compra", { empresa_id: v.empresa, equipo_id: v.equipo || null, descripcion: v.descripcion, cantidad: Number(v.cantidad.replace(",", ".")) || 1, monto_estimado: monto(v.monto), proveedor_id: v.proveedor || null });
      await d.recargar("pedidos_compra"); avisar("Pedido enviado a dirección");
    }}>
      <p className="chico suave">Para un repuesto de una orden, pedilo desde la orden: así queda esperando el repuesto.</p>
      <Campo label="Qué se pide *"><input type="text" name="descripcion" required minLength={2} /></Campo>
      <div className="fila">
        <Campo label="Cantidad"><input type="text" name="cantidad" inputMode="decimal" defaultValue="1" /></Campo>
        <Campo label="Monto estimado ($)"><input type="text" name="monto" inputMode="decimal" /></Campo>
      </div>
      <Campo label="Empresa que paga *"><select name="empresa" required defaultValue="">{<option value="">Elegí…</option>}{d.empresas.filter((e) => e.activa).map((e) => <option key={e.id} value={e.id}>{e.sigla} · {e.nombre}</option>)}</select></Campo>
      <Campo label={tema.t("equipo") + " (opcional)"}><select name="equipo" defaultValue=""><option value="">Ninguno</option>{d.equipos.filter((e) => e.estado !== "baja").map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}</select></Campo>
      <Campo label={tema.t("proveedor")}><select name="proveedor" defaultValue=""><option value="">Sin indicar</option>{d.proveedores.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
    </Ventana>
  );
}

export function Compras() {
  const d = useDatos(), s = useSesion(), tema = useTema();
  const p = s.usuario!.perfil;
  const [ver, setVer] = useState<"pendiente" | "aprobado" | "">("pendiente");
  const tope = d.conf<number | null>("compras_tope_jefe", null);
  const puedeResolver = (x: Pedido) => x.estado === "pendiente" && (p === "direccion" || (p === "jefe" && tope != null && Number(x.monto_estimado || 0) <= Number(tope)));
  const l = d.pedidos_compra.filter((x) => !ver || x.estado === ver);
  const cuenta = (e: string) => d.pedidos_compra.filter((x) => x.estado === e).length;
  return (
    <>
      <div className="encabezado"><div><h1>{tema.t("pedidos")}</h1>
        <p>{tope == null ? "Todos los pedidos los aprueba dirección." : `El jefe aprueba pedidos de hasta ${pesos(Number(tope))}; los demás, dirección.`}</p></div><span className="sp" />
        {p === "jefe" && <button className="boton pri" onClick={() => abrir(<NuevoPedido />)}><Ico n="mas" />Nuevo pedido</button>}</div>
      <div className="pestanas" role="tablist">
        {([["pendiente", `Por aprobar (${cuenta("pendiente")})`], ["aprobado", `Aprobados, por llegar (${cuenta("aprobado")})`], ["", "Todos"]] as const).map(([k, n]) =>
          <button key={k} role="tab" aria-selected={ver === k} className={ver === k ? "activa" : ""} onClick={() => setVer(k)}>{n}</button>)}
      </div>
      <section className="panel">{l.length ? (
        <div className="tabla"><table><thead><tr><th>N.º</th><th>Pedido</th><th>Empresa</th><th>Orden</th><th className="n">Monto est.</th><th>Estado</th><th></th></tr></thead><tbody>
          {l.map((x) => { const emp = d.empresa(x.empresa_id), o = d.ordenes.find((y) => y.id === x.orden_id), e = d.equipo(x.equipo_id); return (
            <tr key={x.id}>
              <td className="num">PC-{num4(x.numero)}<div className="chico suave">{fd(x.creado_en)}</div></td>
              <td>{x.descripcion}<div className="chico suave">{nf.format(Number(x.cantidad))} u.{x.proveedor_id ? " · " + (d.proveedores.find((y) => y.id === x.proveedor_id)?.nombre || "") : ""} · pidió {d.usuarioDe(x.creado_por)?.nombre}</div>
                {x.respuesta && <div className="chico">«{x.respuesta}» — {d.usuarioDe(x.resuelto_por)?.nombre}</div>}</td>
              <td>{emp && <Emp sigla={emp.sigla} nombre={emp.nombre} />}</td>
              <td>{o ? <Link to={"/ordenes/" + o.id}>{tema.t("orden_abrev")}-{num4(o.numero)}</Link> : e ? <Codigo>{e.codigo}</Codigo> : "—"}</td>
              <td className="n">{x.monto_estimado != null ? pesos(Number(x.monto_estimado)) : "—"}</td>
              <td><EstadoPedido p={x} /></td>
              <td><div className="botones" style={{ flexWrap: "nowrap" }}>
                {puedeResolver(x) && <><button className="boton chico pri" onClick={() => abrir(<Resolver p={x} aprobar />)}>Aprobar</button><button className="boton chico" onClick={() => abrir(<Resolver p={x} aprobar={false} />)}>Rechazar</button></>}
                {x.estado === "aprobado" && ["jefe", "encargado"].includes(p) && <button className="boton chico pri" onClick={() => confirmar("Llegó el pedido", <>¿Registrar que llegó «{x.descripcion}»?{o ? " Si la orden no espera nada más, vuelve a «en curso»." : ""}</>, "Llegó", () => llamar("recibir_pedido", { p_pedido: x.id }).then(() => d.recargar("pedidos_compra", "ordenes")).then(() => avisar("Recepción registrada")))}>Llegó</button>}
              </div></td>
            </tr>); })}
        </tbody></table></div>
      ) : <p className="vacio">No hay pedidos {ver === "pendiente" ? "por aprobar" : ver === "aprobado" ? "por llegar" : "todavía"}.</p>}</section>
      {p === "jefe" && <ValorHora />}
    </>
  );
}
function ValorHora() {
  const d = useDatos();
  const [v, setV] = useState(String(d.conf("valor_hora_tecnico", 0) || ""));
  return (
    <section className="panel form">
      <h2 style={{ margin: 0 }}>Costo de la mano de obra</h2>
      <div className="fila" style={{ alignItems: "end" }}>
        <Campo label="Valor hora del técnico ($)" ayuda="Se usa para calcular el costo de cada orden (horas de las fichas × valor hora)"><input type="text" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} /></Campo>
        <button className="boton chico" onClick={async () => { try { await actualizar("config", "valor_hora_tecnico", { valor: monto(v) || 0 }, "clave"); await d.recargar("config"); avisar("Valor hora guardado"); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo guardar"); } }}>Guardar</button>
      </div>
    </section>
  );
}
