// Pruebas de permisos contra un Supabase local (npx supabase start) con las migraciones aplicadas.
// Cada perfil intenta lo que puede y lo que NO puede hacer, a través de la API real (Auth + PostgREST + Storage).
//
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//   node supabase/tests/permisos.test.mjs
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_ANON_KEY, DB = process.env.DB_URL;
if (!URL || !KEY || !DB) { console.error("Faltan SUPABASE_URL, SUPABASE_ANON_KEY o DB_URL"); process.exit(2); }
const sql = (q) => execFileSync("psql", [DB, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const email = (u) => `${u}@cuentas.gestion-planta.app`;

let ok = 0, mal = 0;
function prueba(nombre, cond, extra) {
  if (cond) { ok++; console.log("  ✓ " + nombre); }
  else { mal++; console.log("  ✗ " + nombre + (extra ? "  → " + JSON.stringify(extra).slice(0, 300) : "")); }
}
async function entrar(usuario, clave) {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: email(usuario), password: clave });
  if (error) throw new Error(usuario + ": " + error.message);
  return c;
}
const denegado = (r) => !!r.error || (Array.isArray(r.data) && r.data.length === 0);

console.log("Primera cuenta de Dirección (SQL Editor)");
console.log("  " + sql("select public.primera_cuenta_direccion('direccion', 'Dirección General', 'clave-dir-1', '4321')"));
let r;
try { sql("select public.primera_cuenta_direccion('otra', 'Otra', 'clave-otra-1', '1111')"); prueba("no se puede crear una segunda primera cuenta", false); }
catch { prueba("no se puede crear una segunda primera cuenta", true); }

const dir = await entrar("direccion", "clave-dir-1");
prueba("Dirección ingresa con su usuario", true);
const anon = createClient(URL, KEY, { auth: { persistSession: false } });
r = await anon.rpc("crear_cuenta", { p_usuario: "x", p_nombre: "x", p_rol: "dir", p_empresa: null, p_clave: "12345678" });
prueba("sin sesión no se pueden crear cuentas", !!r.error);
r = await anon.from("equipos").select("*");
prueba("sin sesión no se ve ningún dato", denegado(r));

console.log("Cuentas");
const crear = (c, u, rol, emp, cod) => c.rpc("crear_cuenta", { p_usuario: u, p_nombre: "Nombre " + u, p_rol: rol, p_empresa: emp, p_clave: "clave-" + u, p_codigo: cod });
r = await crear(dir, "gerente", "gm", null, "1234"); prueba("Dirección crea gerente de mantenimiento", !r.error, r.error);
r = await crear(dir, "produccion", "gp", null, "5678"); prueba("Dirección crea gerente de producción", !r.error, r.error);
const gm = await entrar("gerente", "clave-gerente");
const gp = await entrar("produccion", "clave-produccion");
r = await crear(gm, "tecnico", "tec", null); prueba("Mantenimiento crea técnico", !r.error, r.error);
r = await crear(gm, "operario", "op", "INY"); prueba("Mantenimiento crea operario", !r.error, r.error);
r = await crear(gm, "otro-gp", "gp", null, "9999"); prueba("Mantenimiento NO crea gerente de producción", !!r.error);
r = await crear(gp, "admin", "adm", null); prueba("Producción crea administración", !r.error, r.error);
r = await crear(gp, "tec2", "tec", null); prueba("Producción NO crea técnicos", !!r.error);
r = await crear(dir, "gm-sin-codigo", "gm", null, null); prueba("un gerente necesita código de 4 a 6 números", !!r.error);
r = await crear(gp, "operario", "op", "LIM"); prueba("no se repite un usuario", !!r.error);
const tec = await entrar("tecnico", "clave-tecnico");
const op = await entrar("operario", "clave-operario");
const adm = await entrar("admin", "clave-admin");
r = await op.from("cuentas").select("usuario"); prueba("el operario solo ve su cuenta", r.data?.length === 1, r);
r = await tec.from("cuentas").update({ rol: "gm" }).eq("usuario", "tecnico").select(); prueba("nadie se cambia el rol a mano", denegado(r), r);
r = await tec.from("codigos_acceso").select("*"); prueba("los hashes de los códigos no se pueden leer", denegado(r), r);

console.log("Alta de equipos con código del gerente de mantenimiento");
const alta = (c, cod, extra = {}) => c.rpc("alta_equipo", { p_empresa: "INY", p_area: "PRO", p_tipo: "INY", p_nombre: "Inyectora 280 t", p_marca: "Haitian", p_modelo: "MA2800", p_ubicacion: "Nave 1", p_notas: "", p_codigo_gm: cod, ...extra });
r = await alta(tec, "0000"); prueba("con un código equivocado no se da de alta", r.data?.ok === false, r);
r = await alta(tec, "5678"); prueba("el código de producción no sirve para dar de alta", r.data?.ok === false, r);
r = await alta(tec, "1234"); prueba("el técnico da de alta con el código del gerente → INY-PRO-INY-001", r.data?.codigo === "INY-PRO-INY-001", r);
r = await alta(gm, "1234"); prueba("el siguiente es INY-PRO-INY-002", r.data?.codigo === "INY-PRO-INY-002", r);
r = await alta(gp, "5678"); prueba("producción no da de alta equipos", !!r.error);
r = await op.rpc("alta_equipo", { p_empresa: "INY", p_area: "PRO", p_tipo: "INY", p_nombre: "x", p_marca: "", p_modelo: "", p_ubicacion: "", p_notas: "", p_codigo_gm: "1234" });
prueba("el operario no da de alta equipos", !!r.error);
r = await gm.from("equipos").insert({ codigo: "INY-PRO-INY-099", empresa: "INY", area: "PRO", tipo: "INY", nombre: "Trucho" }).select();
prueba("no se puede insertar un equipo salteando la función con código", denegado(r), r);

console.log("Edición, reubicación y baja");
r = await tec.from("equipos").update({ nombre: "cambiado" }).eq("codigo", "INY-PRO-INY-001").select(); prueba("el técnico no modifica equipos", denegado(r), r);
r = await gm.from("equipos").update({ nombre: "Inyectora 280 t línea bidones", estado: "detenido" }).eq("codigo", "INY-PRO-INY-001").select();
prueba("el gerente edita el equipo", r.data?.[0]?.nombre === "Inyectora 280 t línea bidones", r);
r = await gm.from("equipos").update({ codigo: "INY-PRO-INY-050" }).eq("codigo", "INY-PRO-INY-001").select(); prueba("el código no cambia", !!r.error, r);
r = await gm.rpc("reubicar_equipo", { p_codigo: "INY-PRO-INY-001", p_empresa: "LIM", p_area: "SER", p_ubicacion: "Nave 3", p_motivo: "préstamo por pico de producción" });
prueba("el gerente reubica el equipo", !r.error, r.error);
r = await gm.from("equipos").select("codigo,empresa").eq("codigo", "INY-PRO-INY-001").single();
prueba("reubicado a otra empresa conserva el código", r.data?.empresa === "LIM", r);
r = await tec.rpc("reubicar_equipo", { p_codigo: "INY-PRO-INY-002", p_empresa: "LIM", p_area: "SER", p_ubicacion: "x", p_motivo: "" });
prueba("el técnico no reubica", !!r.error, r);
r = await gm.rpc("estado_equipo", { p_codigo: "INY-PRO-INY-002", p_estado: "baja", p_motivo: "" }); prueba("la baja pide motivo", !!r.error);
r = await gm.rpc("estado_equipo", { p_codigo: "INY-PRO-INY-002", p_estado: "baja", p_motivo: "fin de vida útil" }); prueba("baja con motivo", !r.error, r.error);
r = await gm.from("equipo_eventos").select("texto").eq("equipo", "INY-PRO-INY-001").order("id");
prueba("el historial anota alta (con quién autorizó) y reubicación", r.data?.length >= 3 && /autorizó Nombre gerente/.test(r.data[0].texto) && r.data.some((x) => /Reubicado.*préstamo/.test(x.texto)), r.data);

console.log("Reportes de operarios y órdenes");
r = await op.from("equipos").select("codigo"); prueba("el operario ve la lista de equipos", r.data?.length === 2, r);
r = await op.from("ordenes").select("*"); prueba("el operario no ve órdenes", denegado(r), r);
const subida = await op.storage.from("reportes").upload(`${(await op.auth.getUser()).data.user.id}/foto1.jpg`, new Blob([new Uint8Array([255, 216, 255, 224])], { type: "image/jpeg" }), { contentType: "image/jpeg" });
prueba("el operario sube una foto a su carpeta", !subida.error, subida.error);
r = await op.storage.from("reportes").upload(`otra-carpeta/foto.jpg`, new Blob([new Uint8Array([1])], { type: "image/jpeg" }), { contentType: "image/jpeg" });
prueba("el operario no sube a la carpeta de otro", !!r.error);
r = await op.rpc("crear_reporte", { p_equipo: "INY-PRO-INY-001", p_tipo: "Ruido", p_detenida: true, p_descripcion: "Golpeteo del lado del motor", p_adjuntos: [{ ruta: subida.data?.path, tipo: "foto", mime: "image/jpeg", bytes: 4 }] });
prueba("el operario envía el reporte con su foto", !r.error, r.error);
const repId = r.data;
r = await op.from("reportes").select("estado,operario_nombre,empresa").eq("id", repId).single();
prueba("el reporte queda Nuevo, a su nombre y con su empresa", r.data?.estado === "nuevo" && r.data?.operario_nombre === "Nombre operario" && r.data?.empresa === "INY", r);
r = await op.from("reportes").update({ estado: "descartado" }).eq("id", repId).select(); prueba("el operario no cambia el estado del reporte", denegado(r), r);
r = await tec.from("reportes").insert({ equipo: "INY-PRO-INY-001", tipo: "Ruido", descripcion: "x" }).select(); prueba("el técnico no crea reportes de operario", denegado(r), r);
r = await gm.from("adjuntos").select("ruta").eq("reporte_id", repId);
const firmado = await gm.storage.from("reportes").createSignedUrl(r.data?.[0]?.ruta || "x", 60);
prueba("mantenimiento ve la foto del reporte", !firmado.error, firmado.error);
r = await tec.from("ordenes").insert({ equipo: "INY-PRO-INY-001", titulo: "x" }).select(); prueba("el técnico no crea órdenes", denegado(r), r);
r = await gm.from("ordenes").insert({ equipo: "INY-PRO-INY-001", titulo: "Ruido — revisar y corregir", prioridad: "alta", reporte_id: repId }).select().single();
prueba("el gerente genera la OT desde el reporte (OT 1)", r.data?.numero === 1, r);
const ot = r.data;
r = await gm.from("reportes").select("estado,orden_id").eq("id", repId).single(); prueba("el reporte pasa a OT generada", r.data?.estado === "ot" && r.data?.orden_id === ot.id, r);
r = await tec.from("ordenes").update({ estado: "cerrada" }).eq("id", ot.id).select(); prueba("el técnico no cierra ni edita la orden", denegado(r), r);
r = await tec.from("fichas").insert({ orden_id: ot.id, trabajo: "Cambio de rodamientos", horas: 2.5, parada: 3, repuestos: "2 rodamientos 6205", resultado: "terminado", tecnico_id: (await gm.auth.getUser()).data.user.id }).select().single();
prueba("la ficha queda a nombre de quien la carga aunque mande otro", !!r.error || r.data?.tecnico_nombre === "Nombre tecnico", r);
r = await tec.from("fichas").insert({ orden_id: ot.id, trabajo: "Cambio de rodamientos", horas: 2.5, parada: 3, repuestos: "2 rodamientos 6205", resultado: "terminado" }).select().single();
prueba("el técnico carga la ficha", r.data?.tecnico_nombre === "Nombre tecnico", r);
r = await gm.from("ordenes").select("estado").eq("id", ot.id).single(); prueba("la orden pasa a Para revisar", r.data?.estado === "revisar", r);
r = await tec.from("fichas").update({ horas: 10 }).eq("orden_id", ot.id).select(); prueba("las fichas no se editan", denegado(r), r);
r = await gm.from("ordenes").update({ estado: "cerrada" }).eq("id", ot.id).select().single(); prueba("el gerente cierra la orden y queda a su nombre", r.data?.cerrada_por_nombre === "Nombre gerente", r);
r = await tec.from("fichas").insert({ orden_id: ot.id, trabajo: "algo más", horas: 1, resultado: "pendiente" }); prueba("no se cargan fichas en una orden cerrada", !!r.error);
r = await gp.from("ordenes").select("numero"); prueba("producción ve las órdenes (informe)", r.data?.length === 1, r);

console.log("Preventivos");
r = await tec.from("preventivos").insert({ equipo: "INY-PRO-INY-001", tarea: "x", frecuencia: 30 }).select(); prueba("el técnico no programa preventivos", denegado(r), r);
r = await gm.from("preventivos").insert({ equipo: "INY-PRO-INY-001", tarea: "Cambio de aceite hidráulico", frecuencia: 30, ultima: "2026-09-01" }).select().single();
prueba("el gerente programa un preventivo", !!r.data, r);
const pv = r.data;
r = await tec.from("preventivo_ejecuciones").insert({ preventivo_id: pv.id, fecha: "2026-11-10T10:00:00-03:00", horas: 1, obs: "Aceite cambiado" });
prueba("el técnico registra la realización", !r.error, r.error);
r = await gm.from("preventivos").select("ultima").eq("id", pv.id).single(); prueba("se actualiza la última realización", r.data?.ultima === "2026-11-10", r);

console.log("Producción, ventas y compras");
r = await op.from("movimientos").insert({ tipo: "produccion", empresa: "INY", fecha: "2026-11-12", producto: "Bidón 5 L", cantidad: 1200, turno: "Mañana", estado: "revisado" }).select().single();
prueba("el operario carga producción (siempre queda Sin revisar)", r.data?.estado === "pendiente", r);
const mv = r.data;
r = await op.from("movimientos").update({ cantidad: 5000 }).eq("id", mv.id).select(); prueba("el operario no modifica lo cargado", denegado(r), r);
r = await adm.from("movimientos").select("*"); prueba("administración ve los movimientos", r.data?.length === 1, r);
r = await adm.from("movimientos").update({ estado: "revisado" }).eq("id", mv.id).select(); prueba("administración no los revisa", denegado(r), r);
r = await tec.from("movimientos").select("*"); prueba("el técnico no ve ventas ni compras", denegado(r), r);
r = await gp.from("movimientos").update({ cantidad: 1 }).eq("id", mv.id).select(); prueba("producción no cambia la cantidad", !!r.error, r);
r = await gp.from("movimientos").update({ estado: "observado", nota: "Revisar: el turno mañana informó 1150" }).eq("id", mv.id).select().single();
prueba("producción observa con una nota y queda como revisor", r.data?.estado === "observado" && !!r.data?.revisor_id, r);

console.log("Empresas con código");
r = await gp.rpc("renombrar_empresa", { p_sigla: "PIN", p_nombre: "Pinturas del Sur", p_codigo: "1234" }); prueba("producción no usa el código de otro", r.data?.ok === false, r);
r = await gp.rpc("renombrar_empresa", { p_sigla: "PIN", p_nombre: "Pinturas del Sur", p_codigo: "5678" }); prueba("producción renombra con su código", r.data?.ok === true, r);
r = await tec.rpc("renombrar_empresa", { p_sigla: "PIN", p_nombre: "x", p_codigo: "1234" }); prueba("el técnico no renombra empresas", !!r.error);
r = await gm.from("empresas").update({ nombre: "Directo" }).eq("sigla", "INY").select(); prueba("no se renombra salteando el código", denegado(r), r);
r = await gm.from("empresas").update({ sigla: "INX" }).eq("sigla", "INY").select(); prueba("la sigla no cambia", denegado(r), r);

console.log("Freno a la prueba de códigos");
for (let i = 0; i < 5; i++) await dir.rpc("renombrar_empresa", { p_sigla: "SAL", p_nombre: "x", p_codigo: "000" + i });
r = await dir.rpc("renombrar_empresa", { p_sigla: "SAL", p_nombre: "Salsas", p_codigo: "4321" }); prueba("tras 5 códigos fallidos se bloquea aunque el código sea correcto", r.data?.ok === false && /intentos/.test(r.data.error), r);

console.log("Mi cuenta y administración de cuentas");
r = await tec.rpc("cambiar_mis_datos", { p_actual: "mala", p_clave: "nueva-clave-tec" }); prueba("cambiar la contraseña pide la actual", !!r.error);
r = await tec.rpc("cambiar_mis_datos", { p_actual: "clave-tecnico", p_clave: "nueva-clave-tec" }); prueba("el técnico cambia su contraseña", !r.error, r.error);
await entrar("tecnico", "nueva-clave-tec").then(() => prueba("ingresa con la contraseña nueva", true), (e) => prueba("ingresa con la contraseña nueva", false, e.message));
const idOp = (await op.auth.getUser()).data.user.id;
r = await gp.rpc("restablecer_clave", { p_cuenta: (await gm.auth.getUser()).data.user.id, p_clave: "12345678" }); prueba("producción no cambia la clave del gerente de mantenimiento", !!r.error);
r = await gm.rpc("cambiar_estado_cuenta", { p_cuenta: idOp, p_activo: false }); prueba("mantenimiento desactiva al operario", !r.error, r.error);
r = await op.from("equipos").select("codigo"); prueba("la cuenta desactivada ya no ve nada aunque tenga sesión", denegado(r), r);
await entrar("operario", "clave-operario").then(() => prueba("la cuenta desactivada no puede ingresar", false), () => prueba("la cuenta desactivada no puede ingresar", true));
r = await gm.rpc("cambiar_estado_cuenta", { p_cuenta: idOp, p_activo: true }); prueba("y se puede reactivar", !r.error, r.error);
await entrar("operario", "clave-operario").then(() => prueba("reactivada vuelve a ingresar", true), (e) => prueba("reactivada vuelve a ingresar", false, e.message));
r = await gm.from("cuentas").delete().eq("id", idOp).select(); prueba("las cuentas no se borran", denegado(r), r);

console.log("Registro de cambios");
r = await dir.from("auditoria").select("operacion,resumen,nombre,autorizo_nombre").order("id");
const aud = r.data || [];
prueba("Dirección ve el registro", aud.length > 20, r.error);
prueba("registra los ingresos", aud.some((a) => a.operacion === "ingreso" && /Nombre tecnico/.test(a.nombre)), aud.filter((a) => a.operacion === "ingreso").slice(0, 3));
prueba("registra el alta con quién autorizó", aud.some((a) => /Dio de alta el equipo INY-PRO-INY-001/.test(a.resumen) && a.nombre === "Nombre tecnico" && a.autorizo_nombre === "Nombre gerente"), aud.filter((a) => /equipo/.test(a.resumen)).slice(0, 3));
prueba("registra el cambio de nombre de empresa autorizado con código", aud.some((a) => /Cambió el nombre de la empresa PIN/.test(a.resumen) && a.autorizo_nombre === "Nombre produccion"));
prueba("registra la baja del equipo", aud.some((a) => /Dio de baja el equipo INY-PRO-INY-002/.test(a.resumen)));
r = await gm.from("auditoria").select("id").limit(1); prueba("mantenimiento ve el registro", r.data?.length === 1, r);
r = await tec.from("auditoria").select("id"); prueba("el técnico no ve el registro", denegado(r), r);
r = await dir.from("auditoria").delete().gt("id", 0).select(); prueba("nadie borra el registro desde la app", denegado(r), r);
try { sql("delete from public.auditoria"); prueba("ni siquiera desde el SQL Editor", false); } catch { prueba("ni siquiera desde el SQL Editor", true); }
try { sql("update public.auditoria set nombre = 'otro'"); prueba("ni se edita desde el SQL Editor", false); } catch { prueba("ni se edita desde el SQL Editor", true); }
r = await gm.from("ordenes").select("creado_por,modificado_por,creado,modificado").eq("id", ot.id).single();
prueba("cada registro guarda creado_por, creado, modificado_por y modificado", !!(r.data?.creado_por && r.data?.modificado_por && r.data?.creado && r.data?.modificado), r);

console.log(`\n${ok} correctas, ${mal} con problemas`);
process.exit(mal ? 1 : 0);
