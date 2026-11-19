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
  const d = useDatos(), tema = useTema();
  const [perfil, setPerfil] = useState<Perfil>(u?.perfil || "operario");
  const actuales = new Set(d.usuario_empresas.filter((x) => x.usuario_id === u?.id).map((x) => x.empresa_id));
  return (
    <Ventana titulo={u ? "Editar " + u.nombre : "Nuevo usuario"} ok={u ? "Guardar" : "Crear usuario"} onSubmit={async (v) => {
      const empresas = d.empresas.filter((e) => v["emp-" + e.id] === "on").map((e) => e.id);
      if (perfil !== "jefe" && !empresas.length) throw falla("Elegí al menos una empresa.");
      if (u) await llamar("editar_usuario", { p_id: u.id, p_nombre: v.nombre, p_perfil: perfil, p_telefono: v.telefono || null, p_empresas: empresas });
      else {
        if ((v.clave || "").length < 8) throw falla("La contraseña inicial tiene que tener al menos 8 caracteres.");
        await llamar("crear_usuario", { p_usuario: v.usuario, p_nombre: v.nombre, p_perfil: perfil, p_clave: v.clave, p_telefono: v.telefono || null, p_empresas: empresas });
      }
      await d.recargar("usuarios", "usuario_empresas", "registro_cambios");
      avisar(u ? "Usuario actualizado" : "Usuario creado");
    }}>
      <Campo label="Nombre y apellido"><input type="text" name="nombre" id="u-nombre" required defaultValue={u?.nombre} /></Campo>
      <div className="fila">
        {!u && <Campo label="Usuario" ayuda="Minúsculas, números, punto o guion"><input type="text" name="usuario" id="u-usuario" required autoCapitalize="none" spellCheck={false} pattern="[a-z0-9._\-]{3,30}" placeholder="ej.: jperez" /></Campo>}
        <Campo label="Perfil"><Elegir name="perfil" id="u-perfil" opciones={PERFILES.map((p) => [p, tema.t(p)])} valor={perfil} onChange={(x) => setPerfil(x as Perfil)} /></Campo>
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
  const l = [...d.usuarios].sort((a, b) => Number(!a.activo) - Number(!b.activo) || PERFILES.indexOf(a.perfil) - PERFILES.indexOf(b.perfil) || a.nombre.localeCompare(b.nombre));
  const empresasDe = (id: string) => d.usuario_empresas.filter((x) => x.usuario_id === id).map((x) => d.empresa(x.empresa_id)).filter(Boolean);
  return (
    <>
      <div className="encabezado"><div><h1>Usuarios</h1><p>Cada persona entra con su usuario y queda registrado lo que hace. Alta con «Nuevo usuario». Con «Dar de baja» la persona deja de poder ingresar; su historial se conserva (los usuarios no se borran).</p></div><span className="sp" />
        <button className="boton pri" onClick={() => abrir(<FormUsuario />)}>Nuevo usuario</button></div>
      <section className="panel"><div className="tabla"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Perfil</th><th>Empresas</th><th>Estado</th><th></th></tr></thead><tbody>
        {l.map((u) => (
          <tr key={u.id}>
            <td>{u.nombre}{u.id === s.usuario?.id && <> <Pastilla c="info">Vos</Pastilla></>}{u.ejemplo && <> <Pastilla>Ejemplo</Pastilla></>}</td>
            <td className="mono">{u.usuario}</td><td>{tema.t(u.perfil)}</td>
            <td>{u.perfil === "jefe" ? "Todas" : <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{empresasDe(u.id).map((e) => <Emp key={e!.id} sigla={e!.sigla} nombre={e!.sigla} />)}</span>}</td>
            <td>{u.activo ? <Pastilla c="ok">Activo</Pastilla> : <Pastilla>De baja</Pastilla>}</td>
            <td>{u.id !== s.usuario?.id && <div className="botones">
              <button className="boton chico" onClick={() => abrir(<FormUsuario u={u} />)}>Editar</button>
              <button className="boton chico" onClick={() => abrir(<NuevaClave u={u} />)}>Contraseña</button>
              <button className={"boton chico" + (u.activo ? " peligro" : "")} onClick={() => confirmar(u.activo ? "Dar de baja a " + u.nombre : "Reactivar a " + u.nombre,
                u.activo ? `${u.nombre} no va a poder ingresar más. Su historial se conserva.` : `${u.nombre} va a poder volver a ingresar.`, u.activo ? "Dar de baja" : "Reactivar",
                async () => { await llamar("estado_usuario", { p_id: u.id, p_activo: !u.activo }); await d.recargar("usuarios", "registro_cambios"); avisar(u.activo ? "Usuario dado de baja" : "Usuario reactivado"); }, u.activo)}>
                {u.activo ? "Dar de baja" : "Reactivar"}</button>
            </div>}</td>
          </tr>))}
      </tbody></table></div></section>
    </>
  );
}
