// Ventanas de carga y edición de Gestión (las mismas del prototipo). Cada una escribe en la base;
// los permisos, los códigos y el registro de cambios los controla la base.
import { useState } from "react";
import { useDatos } from "../compartido/datos";
import { sb, ok, mensajeError } from "../compartido/supabase";
import { Modal, Field, Sel, CampoCodigo, toast, falla } from "../compartido/ui";
import { Medios } from "../compartido/archivos";
import { ESTADOS_OT, PRIOR, ROLES, CREA, CON_CODIGO, type Rol } from "../compartido/catalogos";
import { hoy, ymd, addDays, fd, nf, pad, parseD } from "../compartido/formato";
import { otNum } from "../compartido/informe";
import { ir } from "../compartido/ruta";
import type { Cuenta, Equipo, Reporte } from "../compartido/tipos";
import { OpcionesEquipo } from "../compartido/opcionesEquipo";

type D = ReturnType<typeof useDatos>;
const empOpts = (d: D): [string, string][] => d.empresas.map((e) => [e.sigla, e.nombre]);
const areaOpts = (d: D): [string, string][] => d.areas.map((a) => [a.codigo, a.nombre]);
const tipoOpts = (d: D): [string, string][] => d.tipos_equipo.map((t) => [t.codigo, t.nombre]);
const tecnicos = (d: D) => d.cuentas.filter((u) => u.rol === "tec" && u.activo).map((u) => u.nombre);

/* ---------- Equipos ---------- */
export function NuevoEquipo() {
  const d = useDatos();
  return (
    <Modal title="Nuevo equipo" ok="Crear equipo" onSubmit={async (v) => {
      const r = ok(await sb().rpc("alta_equipo", { p_empresa: v.empresa, p_area: v.area, p_tipo: v.tipo, p_nombre: v.nombre, p_marca: v.marca, p_modelo: v.modelo, p_ubicacion: v.ubicacion, p_notas: v.notas, p_codigo_gm: v.codigo })) as { ok: boolean; error?: string; codigo?: string };
      if (!r.ok) throw falla(r.error || "No se pudo dar de alta.");
      await d.recargar("equipos", "equipo_eventos", "auditoria");
      toast("Equipo " + r.codigo + " creado"); ir("eq-" + r.codigo);
    }}>
      <div className="row">
        <Field label="Empresa"><Sel name="empresa" opciones={empOpts(d)} valor="INY" /></Field>
        <Field label="Área"><Sel name="area" opciones={areaOpts(d)} valor="PRO" /></Field>
        <Field label="Tipo de máquina"><Sel name="tipo" opciones={tipoOpts(d)} valor="INY" /></Field>
      </div>
      <Field label="Nombre"><input type="text" name="nombre" id="m-nombre" required placeholder="Ej.: Inyectora 280 t línea bidones" /></Field>
      <div className="row">
        <Field label="Marca"><input type="text" name="marca" id="m-marca" /></Field>
        <Field label="Modelo"><input type="text" name="modelo" id="m-modelo" /></Field>
      </div>
      <Field label="Ubicación"><input type="text" name="ubicacion" id="m-ubic" placeholder="Ej.: Nave 1, sector inyección" /></Field>
      <Field label="Notas"><textarea name="notas" id="m-notas" style={{ minHeight: 60 }} /></Field>
      <p className="small muted">El código se genera solo con empresa, área, tipo y número correlativo, y no cambia aunque el equipo se reubique, así la etiqueta QR sigue sirviendo.</p>
      <CampoCodigo label="Código de acceso del gerente de mantenimiento" />
    </Modal>
  );
}
export function EditarEquipo({ e }: { e: Equipo }) {
  const d = useDatos();
  return (
    <Modal title={"Editar " + e.codigo} onSubmit={async (v) => {
      const est = e.estado === "baja" ? "baja" : v.estado;
      ok(await sb().from("equipos").update({ nombre: v.nombre, marca: v.marca || null, modelo: v.modelo || null, notas: v.notas || null }).eq("codigo", e.codigo).select());
      if (est !== e.estado) ok(await sb().rpc("estado_equipo", { p_codigo: e.codigo, p_estado: est, p_motivo: null }));
      await d.recargar("equipos", "equipo_eventos", "auditoria");
      toast("Cambios guardados");
    }}>
      <Field label="Nombre"><input type="text" name="nombre" id="m-nombre" required defaultValue={e.nombre} /></Field>
      <div className="row">
        <Field label="Marca"><input type="text" name="marca" id="m-marca" defaultValue={e.marca || ""} /></Field>
        <Field label="Modelo"><input type="text" name="modelo" id="m-modelo" defaultValue={e.modelo || ""} /></Field>
        <Field label="Estado"><Sel name="estado" opciones={[["operativo", "Operativo"], ["detenido", "Detenido"], ["reparacion", "En reparación"]]} valor={e.estado === "baja" ? "operativo" : e.estado} /></Field>
      </div>
      <Field label="Notas"><textarea name="notas" id="m-notas" style={{ minHeight: 60 }} defaultValue={e.notas || ""} /></Field>
    </Modal>
  );
}
export function ReubicarEquipo({ e }: { e: Equipo }) {
  const d = useDatos();
  return (
    <Modal title={"Reubicar " + e.codigo} ok="Reubicar" onSubmit={async (v) => {
      ok(await sb().rpc("reubicar_equipo", { p_codigo: e.codigo, p_empresa: v.empresa, p_area: v.area, p_ubicacion: v.ubicacion, p_motivo: v.motivo || null }));
      await d.recargar("equipos", "equipo_eventos", "auditoria");
      toast("Equipo reubicado");
    }}>
      <div className="row">
        <Field label="Empresa"><Sel name="empresa" opciones={empOpts(d)} valor={e.empresa} /></Field>
        <Field label="Área"><Sel name="area" opciones={areaOpts(d)} valor={e.area} /></Field>
      </div>
      <Field label="Ubicación"><input type="text" name="ubicacion" id="m-ubic" defaultValue={e.ubicacion || ""} required /></Field>
      <Field label="Motivo"><input type="text" name="motivo" id="m-motivo" placeholder="Ej.: préstamo por pico de producción" /></Field>
      <p className="small muted">El código <span className="code">{e.codigo}</span> no cambia: la etiqueta QR sigue sirviendo.</p>
    </Modal>
  );
}
export function BajaEquipo({ e }: { e: Equipo }) {
  const d = useDatos();
  return (
    <Modal title={"Dar de baja " + e.codigo} ok="Dar de baja" onSubmit={async (v) => {
      ok(await sb().rpc("estado_equipo", { p_codigo: e.codigo, p_estado: "baja", p_motivo: v.motivo }));
      await d.recargar("equipos", "equipo_eventos", "auditoria");
      toast("Equipo dado de baja");
    }}>
      <p>El equipo <b>{e.nombre}</b> deja de aparecer en los listados activos. Su historial se conserva y se puede reactivar.</p>
      <Field label="Motivo de la baja"><input type="text" name="motivo" id="m-motivo" required placeholder="Ej.: fin de vida útil, venta, desguace" /></Field>
    </Modal>
  );
}
export function AgregarManual({ e }: { e: Equipo }) {
  const d = useDatos();
  const lim = Number(d.conf("limite_pdf_mb", 20));
  return (
    <Modal title="Agregar manual" onSubmit={async (v, f) => {
      const file = (f.querySelector("#m-mf") as HTMLInputElement)?.files?.[0];
      let ruta: string | null = null;
      if (file && file.size) {
        if (file.size > lim * 1048576) throw falla(`El PDF supera los ${lim} MB.`);
        ruta = `${e.codigo}/${crypto.randomUUID()}.pdf`;
        const r = await sb().storage.from("manuales").upload(ruta, file, { contentType: "application/pdf" });
        if (r.error) throw falla("No se pudo subir el PDF: " + mensajeError(r.error));
      } else if (!v.url) throw falla("Elegí un PDF o pegá un enlace.");
      ok(await sb().from("manuales").insert({ equipo: e.codigo, nombre: v.nombre, bucket: ruta ? "manuales" : null, ruta, url: ruta ? null : v.url }).select());
      await d.recargar("manuales", "auditoria");
      toast("Manual agregado");
    }}>
      <Field label="Nombre del documento"><input type="text" name="nombre" id="m-mn" required placeholder="Ej.: Manual de operación y mantenimiento" /></Field>
      <Field label="Archivo PDF"><input type="file" name="file" id="m-mf" accept="application/pdf" /></Field>
      <Field label="…o un enlace"><input type="url" name="url" id="m-mu" placeholder="https://" /></Field>
    </Modal>
  );
}

/* ---------- Órdenes ---------- */
export function NuevaOrden({ equipo, reporte }: { equipo?: string; reporte?: Reporte }) {
  const d = useDatos();
  const adj = reporte ? d.adjuntos.filter((a) => a.reporte_id === reporte.id) : [];
  const asignables = [...new Set([...tecnicos(d), ...d.ordenes.map((o) => o.asignado).filter(Boolean) as string[]])];
  return (
    <Modal title={reporte ? "Orden desde reporte" : "Nueva orden de trabajo"} ok="Crear orden" onSubmit={async (v) => {
      const o = ok(await sb().from("ordenes").insert({
        equipo: v.equipo, titulo: v.titulo, descripcion: v.descripcion || null, tipo: v.tipo, prioridad: v.prioridad,
        vence: v.vence || null, asignado: v.asignado || null, reporte_id: reporte?.id || null,
      }).select().single()) as { id: string; numero: number };
      if (v.parar) ok(await sb().rpc("estado_equipo", { p_codigo: v.equipo, p_estado: "reparacion", p_motivo: "por " + otNum(o.numero) }));
      await d.recargar("ordenes", "reportes", "equipos", "equipo_eventos", "auditoria");
      toast(otNum(o.numero) + " creada"); ir("ot-" + o.id);
    }}>
      {reporte && <><div className="note info"><span><b>{reporte.tipo}</b> reportado por {reporte.operario_nombre}: {reporte.descripcion}</span></div><Medios adjuntos={adj} /></>}
      <Field label="Equipo"><select name="equipo" id="m-eq" required defaultValue={equipo || reporte?.equipo || ""}><OpcionesEquipo d={d} /></select></Field>
      <Field label="Título"><input type="text" name="titulo" id="m-tit" required defaultValue={reporte ? reporte.tipo + " — revisar y corregir" : ""} /></Field>
      <Field label="Diagnóstico y tareas a realizar"><textarea name="descripcion" id="m-desc" placeholder="Qué se sospecha, qué revisar, repuestos a preparar, cuidados de seguridad" /></Field>
      <div className="row">
        <Field label="Tipo"><Sel name="tipo" opciones={[["correctiva", "Correctiva"], ["preventiva", "Preventiva"]]} valor="correctiva" /></Field>
        <Field label="Prioridad"><Sel name="prioridad" opciones={Object.entries(PRIOR).map(([k, v]) => [k, v[0]])} valor={reporte?.detenida ? "alta" : "media"} /></Field>
        <Field label="Fecha objetivo"><input type="date" name="vence" id="m-vence" defaultValue={ymd(addDays(new Date(), reporte?.detenida ? 1 : 5))} /></Field>
      </div>
      <Field label="Asignar a"><input type="text" name="asignado" id="m-asig" placeholder="Técnico o contratista" list="tecs" /><datalist id="tecs">{asignables.map((t) => <option key={t} value={t} />)}</datalist></Field>
      <Field label=""><label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="parar" id="m-parar" /> Marcar el equipo como «En reparación»</label></Field>
    </Modal>
  );
}
export function EditarOrden({ id }: { id: string }) {
  const d = useDatos();
  const o = d.ordenes.find((x) => x.id === id)!;
  return (
    <Modal title={"Editar " + otNum(o.numero)} onSubmit={async (v) => {
      ok(await sb().from("ordenes").update({ titulo: v.titulo, descripcion: v.descripcion || null, prioridad: v.prioridad, estado: v.estado, vence: v.vence || null, asignado: v.asignado || null }).eq("id", id).select());
      await d.recargar("ordenes", "auditoria");
      toast("Orden actualizada");
    }}>
      <Field label="Título"><input type="text" name="titulo" id="m-tit" required defaultValue={o.titulo} /></Field>
      <Field label="Diagnóstico y tareas"><textarea name="descripcion" id="m-desc" defaultValue={o.descripcion || ""} /></Field>
      <div className="row">
        <Field label="Prioridad"><Sel name="prioridad" opciones={Object.entries(PRIOR).map(([k, v]) => [k, v[0]])} valor={o.prioridad} /></Field>
        <Field label="Estado"><Sel name="estado" opciones={Object.entries(ESTADOS_OT).map(([k, v]) => [k, v[0]])} valor={o.estado} /></Field>
        <Field label="Fecha objetivo"><input type="date" name="vence" id="m-vence" defaultValue={o.vence || ""} /></Field>
      </div>
      <Field label="Asignado a"><input type="text" name="asignado" id="m-asig" defaultValue={o.asignado || ""} list="tecs" /><datalist id="tecs">{tecnicos(d).map((t) => <option key={t} value={t} />)}</datalist></Field>
    </Modal>
  );
}
export function CerrarOrden({ id }: { id: string }) {
  const d = useDatos();
  const o = d.ordenes.find((x) => x.id === id)!;
  const e = d.eq(o.equipo);
  return (
    <Modal title={"Cerrar " + otNum(o.numero)} ok="Cerrar orden" onSubmit={async (v) => {
      ok(await sb().from("ordenes").update({ estado: "cerrada" }).eq("id", id).select());
      if (v.op && e) ok(await sb().rpc("estado_equipo", { p_codigo: e.codigo, p_estado: "operativo", p_motivo: "al cerrar " + otNum(o.numero) }));
      await d.recargar("ordenes", "equipos", "equipo_eventos", "auditoria");
      toast("Orden cerrada");
    }}>
      <p>Se registra el cierre a tu nombre, con fecha y hora actual.</p>
      {e && e.estado !== "operativo" && e.estado !== "baja" && <Field label=""><label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="op" id="m-op" defaultChecked /> Volver a poner el equipo como «Operativo»</label></Field>}
    </Modal>
  );
}
export function Ficha({ id, cuenta }: { id: string; cuenta: Cuenta }) {
  const d = useDatos();
  const o = d.ordenes.find((x) => x.id === id)!;
  return (
    <Modal title={"Ficha de trabajo · " + otNum(o.numero)} ok="Guardar ficha" onSubmit={async (v) => {
      ok(await sb().from("fichas").insert({ orden_id: id, tecnico_id: cuenta.id, trabajo: v.trabajo, horas: +v.horas || 0, parada: +v.parada || 0, repuestos: v.repuestos || null, resultado: v.resultado }).select());
      await d.recargar("fichas", "ordenes", "auditoria");
      toast(v.resultado === "terminado" ? "Ficha guardada. La orden pasa a revisión del gerente." : "Ficha guardada");
    }}>
      <p className="small muted">{o.titulo} · <span className="code">{o.equipo}</span> · la ficha queda a nombre de <b>{cuenta.nombre}</b></p>
      <Field label="Trabajo realizado"><textarea name="trabajo" id="f-trab" required placeholder="Qué se encontró y qué se hizo" /></Field>
      <div className="row">
        <Field label="Horas de trabajo"><input type="number" name="horas" id="f-h" min={0} step={0.25} required inputMode="decimal" /></Field>
        <Field label="Horas de máquina parada"><input type="number" name="parada" id="f-p" min={0} step={0.25} defaultValue={0} inputMode="decimal" /></Field>
      </div>
      <Field label="Repuestos y materiales usados"><input type="text" name="repuestos" id="f-rep" placeholder="Ej.: 2 rodamientos 6205-2RS, correa B-52" /></Field>
      <div className="field"><span>Resultado</span><div className="seg">
        <label><input type="radio" name="resultado" value="pendiente" defaultChecked /><span>Queda trabajo pendiente</span></label>
        <label><input type="radio" name="resultado" value="terminado" /><span>Trabajo terminado</span></label>
      </div></div>
    </Modal>
  );
}

/* ---------- Preventivos ---------- */
export function NuevoPreventivo({ equipo }: { equipo?: string }) {
  const d = useDatos();
  return (
    <Modal title="Programar preventivo" onSubmit={async (v) => {
      ok(await sb().from("preventivos").insert({ equipo: v.equipo, tarea: v.tarea, frecuencia: +v.frecuencia, ultima: v.ultima || null, responsable: v.responsable || null }).select());
      await d.recargar("preventivos", "auditoria");
      toast("Preventivo programado");
    }}>
      <Field label="Equipo"><select name="equipo" id="m-eq" required defaultValue={equipo || ""}><OpcionesEquipo d={d} /></select></Field>
      <Field label="Tarea"><input type="text" name="tarea" id="m-tarea" required placeholder="Ej.: Cambio de aceite hidráulico y filtro" /></Field>
      <div className="row">
        <Field label="Frecuencia (días)"><input type="number" name="frecuencia" id="m-frec" min={1} required defaultValue={30} /></Field>
        <Field label="Última realización"><input type="date" name="ultima" id="m-ult" defaultValue={hoy()} /></Field>
      </div>
      <Field label="Responsable"><input type="text" name="responsable" id="m-resp" placeholder="Técnico o contratista" list="tecs2" /><datalist id="tecs2">{tecnicos(d).map((t) => <option key={t} value={t} />)}</datalist></Field>
    </Modal>
  );
}
export function RegistrarPreventivo({ id, cuenta }: { id: string; cuenta: Cuenta }) {
  const d = useDatos();
  const p = d.preventivos.find((x) => x.id === id)!;
  return (
    <Modal title="Registrar preventivo" ok="Registrar" onSubmit={async (v) => {
      const ahora = new Date();
      const fecha = new Date(v.fecha + "T" + pad(ahora.getHours()) + ":" + pad(ahora.getMinutes()) + ":00").toISOString();
      ok(await sb().from("preventivo_ejecuciones").insert({ preventivo_id: id, tecnico_id: cuenta.id, fecha, horas: +v.horas || 0, obs: v.obs || null }).select());
      await d.recargar("preventivo_ejecuciones", "preventivos", "auditoria");
      toast("Preventivo registrado. Próximo: " + fd(ymd(addDays(parseD(v.fecha)!, p.frecuencia))));
    }}>
      <p><b>{p.tarea}</b><br /><span className="small muted">{d.eq(p.equipo)?.nombre} · <span className="code">{p.equipo}</span> · queda a nombre de <b>{cuenta.nombre}</b></span></p>
      <div className="row">
        <Field label="Fecha"><input type="date" name="fecha" id="p-f" defaultValue={hoy()} required max={hoy()} /></Field>
        <Field label="Horas"><input type="number" name="horas" id="p-h" min={0} step={0.25} defaultValue={1} /></Field>
      </div>
      <Field label="Observaciones"><textarea name="obs" id="p-obs" style={{ minHeight: 70 }} placeholder="Valores medidos, desgaste observado, próximos cambios" /></Field>
    </Modal>
  );
}

/* ---------- Producción ---------- */
export function Observar({ id }: { id: string }) {
  const d = useDatos();
  const m = d.movimientos.find((x) => x.id === id)!;
  return (
    <Modal title="Observar registro" onSubmit={async (v) => {
      ok(await sb().from("movimientos").update({ estado: "observado", nota: v.nota }).eq("id", id).select());
      await d.recargar("movimientos", "auditoria");
      toast("Registro observado");
    }}>
      <p className="small muted">{m.producto} · {nf.format(m.cantidad)} · cargado por {m.operario_nombre}</p>
      <Field label="Nota para el operario o administración"><textarea name="nota" id="m-nota" required defaultValue={m.nota || ""} /></Field>
    </Modal>
  );
}

/* ---------- Empresas ---------- */
export function RenombrarEmpresa({ sigla }: { sigla: string }) {
  const d = useDatos();
  const actual = d.empN(sigla);
  return (
    <Modal title={"Cambiar nombre de " + sigla} onSubmit={async (v) => {
      const r = ok(await sb().rpc("renombrar_empresa", { p_sigla: sigla, p_nombre: v.nombre, p_codigo: v.codigo })) as { ok: boolean; error?: string };
      if (!r.ok) throw falla(r.error || "No se pudo cambiar el nombre.");
      await d.recargar("empresas", "auditoria");
      toast("Nombre actualizado");
    }}>
      <Field label="Nombre actual"><input type="text" id="m-old" defaultValue={actual} disabled /></Field>
      <Field label="Nombre nuevo"><input type="text" name="nombre" id="m-new" required maxLength={60} defaultValue={actual} /></Field>
      <CampoCodigo label="Tu código de acceso" />
    </Modal>
  );
}

/* ---------- Usuarios ---------- */
export function NuevaCuenta({ rol }: { rol: Rol }) {
  const d = useDatos();
  const roles = CREA[rol] || [];
  const [r, setR] = useState<Rol>(roles[0]);
  return (
    <Modal title="Nueva cuenta" ok="Crear cuenta" onSubmit={async (v) => {
      if (!roles.includes(v.rol as Rol)) throw falla("No podés crear cuentas con ese perfil.");
      if (CON_CODIGO.includes(v.rol as Rol) && !/^[0-9]{4,6}$/.test(v.code || "")) throw falla("Los gerentes y dirección necesitan un código de 4 a 6 números.");
      ok(await sb().rpc("crear_cuenta", { p_usuario: v.usuario, p_nombre: v.nombre, p_rol: v.rol, p_empresa: v.rol === "op" ? v.empresa : null, p_clave: v.pass, p_codigo: v.code || null }));
      await d.recargar("cuentas", "auditoria");
      toast("Cuenta creada");
    }}>
      <Field label="Nombre y apellido"><input type="text" name="nombre" id="u-n" required /></Field>
      <div className="row">
        <Field label="Usuario"><input type="text" name="usuario" id="u-u" required autoCapitalize="none" spellCheck={false} pattern="[a-z0-9._\-]{3,30}" title="Minúsculas, números, punto o guion" placeholder="ej.: jperez" /></Field>
        <Field label="Perfil"><Sel name="rol" id="u-r" opciones={roles.map((x) => [x, ROLES[x].n])} valor={r} onChange={(x) => setR(x as Rol)} /></Field>
      </div>
      {r === "op" && <div className="row"><Field label="Empresa (operarios)"><Sel name="empresa" id="u-e" opciones={empOpts(d)} valor="INY" /></Field></div>}
      <div className="row">
        <Field label="Contraseña inicial (mín. 8)"><input type="password" name="pass" id="u-p" required minLength={8} autoComplete="new-password" /></Field>
        {CON_CODIGO.includes(r) && <Field label="Código de acceso (4 a 6 números)"><input type="password" name="code" id="u-c" inputMode="numeric" pattern="[0-9]{4,6}" autoComplete="off" required /></Field>}
      </div>
      <p className="small muted">Pasale el usuario y la contraseña a la persona; puede cambiarla desde «Mi cuenta». Los gerentes y dirección tienen además un código de acceso para autorizar cambios sensibles.</p>
    </Modal>
  );
}
export function NuevaClave({ u }: { u: Cuenta }) {
  const d = useDatos();
  const cod = CON_CODIGO.includes(u.rol);
  return (
    <Modal title={"Nueva contraseña para " + u.nombre} onSubmit={async (v) => {
      if (cod && !v.code) throw falla("Al cambiar la contraseña de un gerente hay que darle también un código nuevo.");
      ok(await sb().rpc("restablecer_clave", { p_cuenta: u.id, p_clave: v.pass, p_codigo: v.code || null }));
      await d.recargar("cuentas", "auditoria");
      toast("Contraseña cambiada");
    }}>
      <Field label="Contraseña nueva (mín. 8)"><input type="password" name="pass" id="u-p" required minLength={8} autoComplete="new-password" /></Field>
      {cod && <Field label="Código de acceso nuevo"><input type="password" name="code" id="u-c" inputMode="numeric" pattern="[0-9]{4,6}" autoComplete="off" required /></Field>}
      <p className="small muted">Se cierran las sesiones abiertas de {u.nombre}.</p>
    </Modal>
  );
}

