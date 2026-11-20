// Proveedores, talleres y contratistas: el jefe y el encargado los cargan; el jefe los edita y desactiva.
// También se cargan en el momento desde una orden, una ficha, una compra o una reparación externa.
import { useState } from "react";
import { useDatos } from "../datos/store";
import { useSesion } from "../datos/sesion";
import { useTema } from "../sistema/tema";
import { actualizar, insertar } from "../datos/cola";
import { Campo, Pastilla, Ventana, abrir, avisar } from "../comun/ui";
import { Ico } from "../sistema/iconos";
import type { Proveedor } from "../datos/tipos";

function FormProveedor({ p }: { p?: Proveedor }) {
  const d = useDatos();
  return (
    <Ventana titulo={p ? "Editar " + p.nombre : "Nuevo proveedor o contratista"} onSubmit={async (v) => {
      const fila = { nombre: v.nombre.trim(), rubro: v.rubro || null, contacto: v.contacto || null, telefono: v.telefono || null, email: v.email || null, notas: v.notas || null };
      if (!p && d.proveedores.some((x) => x.nombre.trim().toLowerCase() === fila.nombre.toLowerCase())) throw { msg: "Ya hay uno cargado con ese nombre." };
      if (p) await actualizar("proveedores", p.id, fila); else await insertar("proveedores", fila);
      await d.recargar("proveedores"); avisar(p ? "Guardado" : "Cargado");
    }}>
      <Campo label="Nombre o razón social *"><input type="text" name="nombre" required minLength={2} defaultValue={p?.nombre} /></Campo>
      <div className="fila">
        <Campo label="Rubro"><input type="text" name="rubro" defaultValue={p?.rubro || ""} placeholder="Ej.: electricidad, hidráulica" /></Campo>
        <Campo label="Persona de contacto"><input type="text" name="contacto" defaultValue={p?.contacto || ""} /></Campo>
      </div>
      <div className="fila">
        <Campo label="Teléfono"><input type="tel" name="telefono" defaultValue={p?.telefono || ""} /></Campo>
        <Campo label="Email"><input type="email" name="email" defaultValue={p?.email || ""} /></Campo>
      </div>
      <Campo label="Notas"><textarea name="notas" defaultValue={p?.notas || ""} /></Campo>
    </Ventana>
  );
}

export function Proveedores() {
  const d = useDatos(), s = useSesion(), tema = useTema();
  const jefe = s.usuario!.perfil === "jefe";
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const l = [...d.proveedores].filter((p) => !ql || [p.nombre, p.rubro, p.contacto].join(" ").toLowerCase().includes(ql))
    .sort((a, b) => Number(!a.activo) - Number(!b.activo) || a.nombre.localeCompare(b.nombre));
  const usos = (id: string) => d.ordenes.filter((o) => o.contratista_id === id).length + d.fichas.filter((f) => f.contratista_id === id).length
    + d.movimientos_equipo.filter((m) => m.proveedor_id === id).length + d.pedidos_compra.filter((x) => x.proveedor_id === id).length;
  return (
    <>
      <div className="encabezado"><div><h1>Proveedores y contratistas</h1>
        <p>Talleres, {tema.t("contratista").toLowerCase()}s y proveedores de repuestos. También se pueden cargar en el momento desde una orden, una ficha, una compra o una reparación externa («+ Cargar uno nuevo…»).</p></div><span className="sp" />
        <button className="boton pri" onClick={() => abrir(<FormProveedor />)}><Ico n="mas" />Nuevo</button></div>
      <div className="filtros"><input type="search" placeholder="Buscar por nombre, rubro o contacto" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} aria-label="Buscar" /></div>
      <section className="panel">{l.length ? (
        <div className="tabla"><table><thead><tr><th>Nombre</th><th>Rubro</th><th>Contacto</th><th className="n">Trabajos</th><th>Estado</th><th></th></tr></thead><tbody>
          {l.map((p) => (
            <tr key={p.id}>
              <td><b>{p.nombre}</b>{p.notas && <div className="chico suave">{p.notas}</div>}</td><td>{p.rubro}</td>
              <td className="chico">{[p.contacto, p.telefono, p.email].filter(Boolean).join(" · ")}</td>
              <td className="n">{usos(p.id) || ""}</td>
              <td>{p.activo ? <Pastilla c="ok">Activo</Pastilla> : <Pastilla>Desactivado</Pastilla>}</td>
              <td>{jefe && <div className="botones" style={{ flexWrap: "nowrap" }}>
                <button className="boton chico" onClick={() => abrir(<FormProveedor p={p} />)}>Editar</button>
                <button className="boton chico" onClick={async () => { try { await actualizar("proveedores", p.id, { activo: !p.activo }); await d.recargar("proveedores"); avisar(p.activo ? "Desactivado: ya no aparece en las listas" : "Activado"); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo"); } }}>{p.activo ? "Desactivar" : "Activar"}</button>
              </div>}</td>
            </tr>))}
        </tbody></table></div>
      ) : <p className="vacio">{d.proveedores.length ? "Ninguno coincide con la búsqueda." : "Todavía no hay proveedores ni contratistas cargados. Tocá «Nuevo», o cargalos en el momento desde una orden."}</p>}</section>
    </>
  );
}
