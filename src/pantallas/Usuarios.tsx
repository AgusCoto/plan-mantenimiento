// Usuarios (solo el jefe): alta, perfil, empresas a las que accede, contraseña, activar y desactivar.
// Los usuarios no se borran: se desactivan y conservan su historial.
import { useState } from "react";
import { useDatos } from "../datos/store";
import { useSesion } from "../datos/sesion";
import { useTema } from "../sistema/tema";
import { llamar } from "../datos/cola";
import { Campo, Emp, Pastilla, Ventana, abrir, avisar, confirmar, Elegir } from "../comun/ui";
import { falla } from "../datos/supabase";
import type { Usuario } from "../datos/tipos";
import type { Perfil } from "../sistema/tokens";

const PERFILES: Perfil[] = ["jefe", "encargado", "tecnico", "operario", "direccion"];

function FormUsuario({ u }: { u?: Usuario }) {
  const d = useDatos(), tema = useTema(), s = useSesion();
  const yo = !!u && u.id === s.usuario?.id;
  const [perfil, setPerfil] = useState<Perfil>(u?.perfil || "operario");
  const actuales = new Set(d.usuario_empresas.filter((x) => x.usuario_id === u?.id).map((x) => x.empresa_id));
  return (
    <Ventana titulo={u ? "Editar " + u.nombre : "Nuevo usuario"} ok={u ? "Guardar" : "Crear usuario"} onSubmit={async (v) => {
      const empresas = d.empresas.filter((e) => v["emp-" + e.id] === "on").map((e) => e.id);
      if (perfil !== "jefe" && !empresas.length) throw falla("Elegí al menos una empresa.");
      if (u) {
        await llamar("editar_usuario", { p_id: u.id, p_nombre: v.nombre, p_perfil: perfil, p_telefono: v.telefono || null, p_empresas: empresas });
        const nuevo = (v.usuario || "").trim().toLowerCase();
        if (nuevo && nuevo !== u.usuario) await llamar("cambiar_usuario", { p_id: u.id, p_usuario: nuevo });
        if (yo) s.recargarUsuario();
      } else {
        if ((v.clave || "").length < 8) throw falla("La contraseña inicial tiene que tener al menos 8 caracteres.");
        await llamar("crear_usuario", { p_usuario: v.usuario, p_nombre: v.nombre, p_perfil: perfil, p_clave: v.clave, p_telefono: v.telefono || null, p_empresas: empresas });
      }
      await d.recargar("usuarios", "usuario_empresas", "registro_cambios");
      avisar(u ? (yo ? "Tus datos se guardaron" : "Usuario actualizado") : "Usuario creado");
    }}>
      <Campo label="Nombre y apellido"><input type="text" name="nombre" id="u-nombre" required defaultValue={u?.nombre} /></Campo>
      <div className="fila">
        <Campo label="Usuario (para ingresar)" ayuda={u ? (yo ? "Si lo cambiás, la próxima vez ingresás con el nuevo; la contraseña no cambia" : "Si lo cambiás, avisale: la contraseña no cambia") : "Minúsculas, números, punto o guion"}>
          <input type="text" name="usuario" id="u-usuario" required autoCapitalize="none" spellCheck={false} pattern="[a-z0-9._\-]{3,30}" placeholder="ej.: jperez" defaultValue={u?.usuario} /></Campo>
        {yo ? <Campo label="Perfil" ayuda="Tu perfil de jefe no se puede cambiar"><input type="text" value={tema.t("jefe")} disabled /></Campo>
          : <Campo label="Perfil"><Elegir name="perfil" id="u-perfil" opciones={PERFILES.map((p) => [p, tema.t(p)])} valor={perfil} onChange={(x) => setPerfil(x as Perfil)} /></Campo>}
        <Campo label="Teléfono (opcional)"><input type="tel" name="telefono" defaultValue={u?.telefono || ""} /></Campo>
      </div>
      {perfil === "jefe" ? <p className="suave chico">El jefe de mantenimiento accede a todas las empresas.</p> : (
        <div className="campo"><span>Empresas a las que accede</span><div className="opciones">
          {d.empresas.filter((e) => e.activa).map((e) => <label key={e.id}><input type="checkbox" name={"emp-" + e.id} defaultChecked={actuales.has(e.id)} /><span>{e.sigla} · {e.nombre}</span></label>)}
        </div></div>
      )}
      {!u && <Campo label="Contraseña inicial (mín. 8)"><input type="password" name="clave" id="u-clave" required minLength={8} autoComplete="new-password" /></Campo>}
      {!u && <p className="suave chico">Pasale el usuario y la contraseña a la persona; la puede cambiar desde «Mi cuenta».</p>}
    </Ventana>
  );
}
function NuevaClave({ u }: { u: Usuario }) {
  const d = useDatos();
  return (
    <Ventana titulo={"Nueva contraseña para " + u.nombre} onSubmit={async (v) => {
      await llamar("restablecer_clave", { p_id: u.id, p_clave: v.clave });
      await d.recargar("registro_cambios");
      avisar("Contraseña cambiada");
    }}>
      <Campo label="Contraseña nueva (mín. 8)"><input type="password" name="clave" required minLength={8} autoComplete="new-password" /></Campo>
      <p className="suave chico">Se cierran las sesiones abiertas de {u.nombre}.</p>
    </Ventana>
  );
}

export function Usuarios() {
  const d = useDatos(), s = useSesion(), tema = useTema();
  const l = d.usuarios.filter((u) => !u.eliminado).sort((a, b) => Number(!a.activo) - Number(!b.activo) || PERFILES.indexOf(a.perfil) - PERFILES.indexOf(b.perfil) || a.nombre.localeCompare(b.nombre));
  const empresasDe = (id: string) => d.usuario_empresas.filter((x) => x.usuario_id === id).map((x) => d.empresa(x.empresa_id)).filter(Boolean);
  return (
    <>
      <div className="encabezado"><div><h1>Usuarios</h1><p>Cada persona entra con su usuario y queda registrado lo que hace. Alta con «Nuevo usuario». Con «Dar de baja» la persona deja de poder ingresar; su historial se conserva. Un usuario dado de baja se puede eliminar.</p></div><span className="sp" />
        <button className="boton pri" onClick={() => abrir(<FormUsuario />)}>Nuevo usuario</button></div>
      <section className="panel"><div className="tabla"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Perfil</th><th>Empresas</th><th>Estado</th><th></th></tr></thead><tbody>
        {l.map((u) => (
          <tr key={u.id}>
            <td>{u.nombre}{u.id === s.usuario?.id && <> <Pastilla c="info">Vos</Pastilla></>}{u.ejemplo && <> <Pastilla>Ejemplo</Pastilla></>}</td>
            <td className="mono">{u.usuario}</td><td>{tema.t(u.perfil)}</td>
            <td>{u.perfil === "jefe" ? "Todas" : <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{empresasDe(u.id).map((e) => <Emp key={e!.id} sigla={e!.sigla} nombre={e!.sigla} />)}</span>}</td>
            <td>{u.activo ? <Pastilla c="ok">Activo</Pastilla> : <Pastilla>De baja</Pastilla>}</td>
            <td>{u.id === s.usuario?.id ? <div className="botones"><button className="boton chico" onClick={() => abrir(<FormUsuario u={u} />)}>Editar mis datos</button></div> : <div className="botones">
              <button className="boton chico" onClick={() => abrir(<FormUsuario u={u} />)}>Editar</button>
              <button className="boton chico" onClick={() => abrir(<NuevaClave u={u} />)}>Contraseña</button>
              <button className={"boton chico" + (u.activo ? " peligro" : "")} onClick={() => confirmar(u.activo ? "Dar de baja a " + u.nombre : "Reactivar a " + u.nombre,
                u.activo ? `${u.nombre} no va a poder ingresar más. Su historial se conserva.` : `${u.nombre} va a poder volver a ingresar.`, u.activo ? "Dar de baja" : "Reactivar",
                async () => { await llamar("estado_usuario", { p_id: u.id, p_activo: !u.activo }); await d.recargar("usuarios", "registro_cambios"); avisar(u.activo ? "Usuario dado de baja" : "Usuario reactivado"); }, u.activo)}>
                {u.activo ? "Dar de baja" : "Reactivar"}</button>
              {!u.activo && <button className="boton chico peligro" onClick={() => confirmar("Eliminar a " + u.nombre,
                <>Se elimina de la lista de usuarios y no puede volver a ingresar. Si nunca cargó ni tuvo asignado nada, se borra del todo. Si tiene historia (reportes, órdenes, fichas…), su nombre sigue figurando ahí para no perder quién hizo cada cosa, y el usuario «{u.usuario}» queda libre. No se puede deshacer.</>,
                "Eliminar", async () => { const r = await llamar<string>("eliminar_usuario", { p_id: u.id }); await d.recargar("usuarios", "usuario_empresas", "registro_cambios");
                  avisar(r === "borrado" ? "Usuario eliminado" : "Usuario eliminado (su nombre queda en el historial)"); }, true)}>Eliminar</button>}
            </div>}</td>
          </tr>))}
      </tbody></table></div></section>
    </>
  );
}
