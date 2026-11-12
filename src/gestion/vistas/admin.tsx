// Empresas, usuarios y registro de cambios.
import { useState } from "react";
import { useDatos } from "../../compartido/datos";
import { sb, ok } from "../../compartido/supabase";
import { EmpTag, abrirModal, confirmar, toast } from "../../compartido/ui";
import { CREA, ROLES, puede, type Rol } from "../../compartido/catalogos";
import { fdt } from "../../compartido/formato";
import { useUi } from "../../compartido/estadoUi";
import type { Auditoria, Cuenta } from "../../compartido/tipos";
import * as M from "../modales";

export function Empresas({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos();
  const ultima = [...d.empresas].sort((a, b) => b.modificado.localeCompare(a.modificado))[0];
  const quien = ultima && d.cuenta(ultima.modificado_por)?.nombre;
  return (
    <>
      <div className="head"><div><h1>Empresas del grupo</h1><p>Gerentes y dirección pueden cambiar el nombre con su código de acceso. La sigla no cambia porque forma parte del código de cada equipo.</p></div></div>
      <section className="panel"><div className="tbl-wrap"><table><thead><tr><th>Sigla</th><th>Nombre</th><th className="n">Equipos activos</th><th></th></tr></thead><tbody>
        {d.empresas.map((k) => (
          <tr key={k.sigla}><td><span className="code">{k.sigla}</span></td><td><EmpTag sigla={k.sigla} nombre={k.nombre} /></td>
            <td className="n">{d.equipos.filter((e) => e.empresa === k.sigla && e.estado !== "baja").length}</td>
            <td>{puede(cuenta.rol, "emp.rename") && <button className="btn sm" onClick={() => abrirModal(<M.RenombrarEmpresa sigla={k.sigla} />)}>Cambiar nombre</button>}</td></tr>))}
      </tbody></table></div>
        {quien && <p className="small muted" style={{ marginTop: 10 }}>Último cambio: {quien} · {fdt(ultima.modificado)}</p>}</section>
    </>
  );
}

export function Usuarios({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos();
  const mine = CREA[cuenta.rol] || [];
  const l = [...d.cuentas].sort((a, b) => Number(!a.activo) - Number(!b.activo) || a.rol.localeCompare(b.rol) || a.nombre.localeCompare(b.nombre));
  const alternar = (u: Cuenta) => {
    const act = !u.activo;
    confirmar(act ? "Activar cuenta" : "Desactivar cuenta", act ? `${u.nombre} va a poder volver a ingresar.` : `${u.nombre} no va a poder ingresar más. Su historial se conserva.`, act ? "Activar" : "Desactivar", async () => {
      ok(await sb().rpc("cambiar_estado_cuenta", { p_cuenta: u.id, p_activo: act }));
      await d.recargar("cuentas", "auditoria");
      toast(act ? "Cuenta activada" : "Cuenta desactivada");
    });
  };
  return (
    <>
      <div className="head"><div><h1>Usuarios</h1><p>Cada persona entra con su cuenta y queda registrado lo que hace. Las cuentas no se borran: se desactivan, así se conserva su historial.</p></div><span className="sp" />
        {mine.length > 0 && <button className="btn pri" onClick={() => abrirModal(<M.NuevaCuenta rol={cuenta.rol} />)}>Nueva cuenta</button>}</div>
      <section className="panel"><div className="tbl-wrap"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Perfil</th><th>Empresa</th><th>Estado</th><th>Creada por</th><th></th></tr></thead><tbody>
        {l.map((u) => {
          const puedeAdm = mine.includes(u.rol as Rol) && u.id !== cuenta.id;
          return (
            <tr key={u.id}>
              <td>{u.nombre}{u.id === cuenta.id && <> <span className="pill info">Vos</span></>}{u.ejemplo && <> <span className="pill">Ejemplo</span></>}</td>
              <td className="mono">{u.usuario}</td><td>{ROLES[u.rol]?.n || u.rol}</td><td>{u.empresa ? <EmpTag sigla={u.empresa} nombre={d.empN(u.empresa)} /> : "—"}</td>
              <td>{u.activo ? <span className="pill ok">Activa</span> : <span className="pill">Desactivada</span>}</td>
              <td className="small">{d.cuenta(u.creado_por)?.nombre || "—"}</td>
              <td>{puedeAdm && <div className="btns"><button className="btn sm" onClick={() => abrirModal(<M.NuevaClave u={u} />)}>Nueva contraseña</button><button className="btn sm" onClick={() => alternar(u)}>{u.activo ? "Desactivar" : "Activar"}</button></div>}</td>
            </tr>);
        })}
      </tbody></table></div></section>
    </>
  );
}

const TABLAS: Record<string, string> = {
  equipos: "Equipos", ordenes: "Órdenes", fichas: "Fichas de trabajo", preventivos: "Preventivos", preventivo_ejecuciones: "Preventivos realizados",
  reportes: "Reportes", adjuntos: "Fotos y videos", movimientos: "Producción, ventas y compras", manuales: "Manuales", cuentas: "Usuarios",
  empresas: "Empresas", productos: "Productos", config: "Configuración", sesion: "Ingresos", "w-main": "Migración de W-Main",
};
const CAMPOS: Record<string, string> = {
  nombre: "nombre", estado: "estado", prioridad: "prioridad", asignado: "asignado a", titulo: "título", descripcion: "diagnóstico", vence: "fecha objetivo",
  empresa: "empresa", area: "área", ubicacion: "ubicación", marca: "marca", modelo: "modelo", notas: "notas", activo: "activa", nota: "nota",
  frecuencia: "frecuencia", ultima: "última realización", tarea: "tarea", responsable: "responsable", cerrada: "cerrada", revisor_id: "revisor",
};
const val = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "sí" : "no") : String(v));
function Detalle({ a }: { a: Auditoria }) {
  const [abierto, setAbierto] = useState(false);
  if (a.operacion !== "modificacion" || !a.cambios) return null;
  const l = Object.entries(a.cambios).filter(([k]) => k in CAMPOS);
  if (!l.length) return null;
  return abierto
    ? <ul className="small muted" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{l.map(([k, v]) => { const [x, y] = v as [unknown, unknown]; return <li key={k}>{CAMPOS[k]}: {val(x)} → {val(y)}</li>; })}</ul>
    : <button className="btn sm" style={{ marginTop: 4 }} onClick={() => setAbierto(true)}>Ver qué cambió</button>;
}
export function Registro() {
  const d = useDatos();
  const [u, setU] = useUi("auU", ""); const [c, setC] = useUi("auC", "");
  const l = d.auditoria.filter((a) => (!u || a.usuario_id === u) && (!c || a.tabla === c));
  const link = (a: Auditoria) =>
    a.tabla === "equipos" && a.registro && d.eq(a.registro) ? <a href={"#eq-" + a.registro}>ver</a>
      : a.tabla === "ordenes" && d.ordenes.some((o) => o.id === a.registro) ? <a href={"#ot-" + a.registro}>ver</a> : null;
  return (
    <>
      <div className="head"><div><h1>Registro de cambios</h1><p>Quién hizo cada carga o modificación, y cuándo. Lo anota la base de datos y nadie lo puede editar ni borrar. Se muestran los últimos 500 movimientos.</p></div></div>
      <div className="filters">
        <select id="f-auu" value={u} onChange={(e) => setU(e.target.value)}><option value="">Todas las personas</option>{[...d.cuentas].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        <select id="f-auc" value={c} onChange={(e) => setC(e.target.value)}><option value="">Todo</option>{Object.entries(TABLAS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
      </div>
      <section className="panel">{l.length ? (
        <div className="tbl-wrap"><table><thead><tr><th>Fecha y hora</th><th>Persona</th><th>Acción</th><th></th></tr></thead><tbody>
          {l.map((a) => (
            <tr key={a.id}><td className="num" style={{ whiteSpace: "nowrap" }}>{fdt(a.ts)}</td><td>{a.nombre}<div className="small muted">{a.rol ? ROLES[a.rol]?.n : ""}</div></td>
              <td>{a.resumen}{a.autorizo_nombre && <div className="small muted">Autorizado con el código de {a.autorizo_nombre}</div>}<Detalle a={a} /></td><td>{link(a)}</td></tr>))}
        </tbody></table></div>) : <p className="empty">Todavía no hay movimientos registrados{u || c ? " con este filtro" : ""}.</p>}</section>
    </>
  );
}
