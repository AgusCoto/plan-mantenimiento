// Pruebas de permisos: cada perfil intenta lo que puede y lo que NO puede hacer, a través de la API real
// (Auth + PostgREST + Storage) de un Supabase con las migraciones aplicadas y sin datos.
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… DB_URL=postgresql://… node supabase/tests/permisos.test.mjs
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_ANON_KEY, DB = process.env.DB_URL;
if (!URL || !KEY || !DB) { console.error("Faltan SUPABASE_URL, SUPABASE_ANON_KEY o DB_URL"); process.exit(2); }
const sql = (q) => execFileSync("psql", [DB, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const email = (u) => `${u}@cuentas.mantenimiento.app`;
let ok = 0, mal = 0;
function prueba(nombre, cond, extra) {
  if (cond) { ok++; console.log("  ✓ " + nombre); } else { mal++; console.log("  ✗ " + nombre + (extra !== undefined ? "  → " + JSON.stringify(extra).slice(0, 300) : "")); }
}
async function entrar(u, clave = "clave-" + u) {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: email(u), password: clave });
  if (error) throw new Error(u + ": " + error.message);
  c.uid = data.user.id;
  return c;
}
const no = (r) => !!r.error || (Array.isArray(r.data) && r.data.length === 0);
const filas = (r) => (Array.isArray(r.data) ? r.data.length : -1);

console.log("Usuarios");
console.log("  " + sql("select public.primera_cuenta_jefe('jefe', 'Jefe de Mantenimiento', 'clave-jefe', '11 5555-0000')"));
const jefe = await entrar("jefe");
const emp = Object.fromEntries((await jefe.from("empresas").select("id,sigla")).data.map((e) => [e.sigla, e.id]));
const crear = (c, u, perfil, empresas) => c.rpc("crear_usuario", { p_usuario: u, p_nombre: "Nombre " + u, p_perfil: perfil, p_clave: "clave-" + u, p_telefono: null, p_empresas: empresas.map((s) => emp[s]) });
for (const [u, p, e] of [["encargado", "encargado", ["INY"]], ["tecnico", "tecnico", ["INY"]], ["tecnico2", "tecnico", ["LIM"]], ["operario", "operario", ["INY"]], ["operario2", "operario", ["LIM"]], ["direccion", "direccion", ["INY", "LIM", "PIN", "SAL"]]]) {
  const r = await crear(jefe, u, p, e); prueba(`el jefe crea ${p} (${u})`, !r.error, r.error);
}
const enc = await entrar("encargado"), tec = await entrar("tecnico"), tec2 = await entrar("tecnico2"), op = await entrar("operario"), op2 = await entrar("operario2"), dir = await entrar("direccion");
const anon = createClient(URL, KEY, { auth: { persistSession: false } });
let r = await crear(enc, "otro", "tecnico", ["INY"]); prueba("el encargado no crea usuarios", !!r.error);
r = await crear(dir, "otro", "tecnico", ["INY"]); prueba("dirección no crea usuarios", !!r.error);
r = await anon.from("equipos").select("*"); prueba("sin sesión no se ve nada", no(r));
r = await tec.from("usuarios").update({ perfil: "jefe" }).eq("id", tec.uid).select(); prueba("nadie se cambia el perfil a mano", no(r), r);
r = await op.from("usuarios").select("usuario"); prueba("el operario solo se ve a sí mismo", filas(r) === 1, r);
try { sql(`delete from public.usuarios where usuario = 'operario2'`); prueba("los usuarios no se borran (ni desde el SQL Editor)", false); } catch { prueba("los usuarios no se borran (ni desde el SQL Editor)", true); }

console.log("Empresas y configuración");
r = await jefe.from("empresas").update({ nombre: "Pinturas del Sur", color: "#C47E1D" }).eq("sigla", "PIN").select(); prueba("el jefe cambia nombre y color de una empresa", filas(r) === 1, r);
r = await enc.from("empresas").update({ nombre: "x" }).eq("sigla", "PIN").select(); prueba("el encargado no cambia empresas", no(r), r);
r = await jefe.from("empresas").insert({ sigla: "MET", nombre: "Metalúrgica", color: "#556677" }).select(); prueba("se puede sumar una empresa nueva", filas(r) === 1, r);
r = await dir.from("config").update({ valor: 999999 }).eq("clave", "compras_tope_jefe").select(); prueba("dirección no cambia la configuración", no(r), r);

console.log("Equipos");
const alta = (c, sigla, tipo, crit = "alta", extra = {}) => c.from("equipos").insert({ empresa_duena_id: emp[sigla], tipo, nombre: `Equipo ${tipo}`, criticidad: crit, codigo: "lo-elijo-yo", numero: 77, ...extra }).select().single();
r = await alta(jefe, "INY", "COM"); prueba("el jefe da de alta: código INY-COM-001 generado por la base (ignora el que manda la app)", r.data?.codigo === "INY-COM-001", r);
const comp = r.data;
r = await alta(jefe, "INY", "COM", "baja"); prueba("el siguiente es INY-COM-002", r.data?.codigo === "INY-COM-002", r);
const comp2 = r.data;
r = await alta(jefe, "LIM", "APL", "media"); prueba("un campo propio obligatorio (capacidad del apilador) se exige en la base", !!r.error && /Capacidad de carga/.test(r.error.message), r.error);
r = await alta(jefe, "LIM", "APL", "media", { campos: { capacidad: 1500 } }); prueba("correlativo por empresa y tipo: LIM-APL-001", r.data?.codigo === "LIM-APL-001", r);
const apl = r.data;
r = await alta(enc, "INY", "COM"); prueba("el encargado no da de alta equipos", no(r) || !!r.error, r);
r = await jefe.from("empresas").update({ sigla: "INX" }).eq("sigla", "INY").select(); prueba("la sigla no cambia si la empresa ya tiene equipos", !!r.error, r);
r = await jefe.from("equipos").update({ codigo: "INY-COM-099" }).eq("id", comp.id).select(); prueba("el código no se edita", !!r.error, r);
r = await jefe.from("equipos").update({ empresa_duena_id: emp.LIM }).eq("id", comp.id).select(); prueba("la empresa dueña no cambia", !!r.error, r);
r = await jefe.from("equipos").update({ estado: "baja" }).eq("id", comp.id).select(); prueba("el estado no se cambia a mano (solo con movimientos)", !!r.error, r);
r = await jefe.from("equipos").update({ marca: "Atlas Copco", campos: { presion: 8 } }).eq("id", comp.id).select(); prueba("el jefe completa la ficha", filas(r) === 1, r);
r = await tec.from("equipos").update({ marca: "x" }).eq("id", comp.id).select(); prueba("el técnico no modifica equipos", no(r), r);
r = await op.from("equipos").select("codigo"); prueba("el operario de INY ve solo los equipos de INY", filas(r) === 2, r.data);
r = await tec2.from("equipos").select("codigo"); prueba("el técnico de LIM no ve los equipos de INY", filas(r) === 1 && r.data[0].codigo === "LIM-APL-001", r.data);
r = await jefe.from("equipos").delete().eq("id", comp2.id).select(); prueba("los equipos no se borran", no(r) || !!r.error, r);
r = await tec.rpc("cargar_horometro", { p_equipo: comp.id, p_valor: 12500 }); prueba("el técnico carga el horómetro", !r.error, r.error);

console.log("Documentos");
r = await jefe.from("documentos").insert({ equipo_id: comp.id, categoria: "manual", nombre: "Manual GA22", url: "https://example.com/m.pdf" }).select(); prueba("el jefe carga un manual", filas(r) === 1, r);
r = await tec.from("documentos").select("nombre"); prueba("el técnico ve los manuales", filas(r) === 1, r);
r = await op.from("documentos").select("nombre"); prueba("el operario no ve manuales", no(r), r);
r = await dir.from("documentos").select("nombre"); prueba("dirección no ve manuales (solo mantenimiento)", no(r), r);
r = await enc.from("documentos").insert({ equipo_id: comp.id, categoria: "plano", nombre: "x", url: "https://x" }).select(); prueba("el encargado no carga documentos", no(r) || !!r.error, r);

console.log("Reportes de falla");
const repId = crypto.randomUUID();
r = await op.from("reportes_falla").insert({ id: repId, equipo_id: comp.id, tipo_falla: "perdida_aceite", parada: true, texto: "Charco de aceite abajo", operario_id: jefe.uid, estado: "descartado" }).select().single();
prueba("el operario reporta (queda a su nombre y como nuevo aunque mande otra cosa)", r.data?.operario_id === op.uid && r.data?.estado === "nuevo", r);
r = await op.from("reportes_falla").insert({ id: repId, equipo_id: comp.id, tipo_falla: "ruido", parada: true }).select(); prueba("reenviar el mismo reporte (sin señal) no lo duplica", !!r.error, r);
r = await op2.from("reportes_falla").insert({ equipo_id: comp.id, tipo_falla: "ruido", parada: false }).select(); prueba("el operario de LIM no reporta equipos de INY", no(r) || !!r.error, r);
r = await jefe.from("equipos").select("estado").eq("id", comp.id).single(); prueba("máquina parada → el equipo queda detenido al instante", r.data?.estado === "detenido", r);
const ruta = `${op.uid}/${repId}.jpg`;
r = await op.storage.from("adjuntos").upload(ruta, new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }), { contentType: "image/jpeg" }); prueba("el operario sube la foto a su carpeta", !r.error, r.error);
r = await op.from("adjuntos").insert({ tabla: "reportes_falla", registro_id: repId, ruta, tipo: "foto", mime: "image/jpeg" }).select(); prueba("y la adjunta a su reporte", filas(r) === 1, r);
r = await op2.storage.from("adjuntos").upload(`${op.uid}/otra.jpg`, new Blob([new Uint8Array([1])], { type: "image/jpeg" }), { contentType: "image/jpeg" }); prueba("nadie sube a la carpeta de otro", !!r.error);
r = await op.from("reportes_falla").update({ estado: "descartado" }).eq("id", repId).select(); prueba("el operario no cambia su reporte", no(r), r);
r = await op2.from("reportes_falla").select("id"); prueba("el operario ve solo sus reportes", no(r), r);
r = await tec.storage.from("adjuntos").createSignedUrl(ruta, 60); prueba("mantenimiento ve la foto", !r.error, r.error);

console.log("Órdenes de trabajo");
r = await tec.from("ordenes").insert({ equipo_id: comp.id, titulo: "x" }).select(); prueba("el técnico no crea órdenes", no(r) || !!r.error, r);
r = await op.from("ordenes").select("id"); prueba("el operario no ve órdenes", no(r), r);
r = await enc.from("ordenes").insert({ equipo_id: comp.id, reporte_id: repId, titulo: "Pérdida de aceite", asignado_a: tec.uid, estado: "cerrada", prioridad: "baja" }).select().single();
const ot = r.data;
prueba("el encargado crea la orden desde el reporte: asignada, prioridad urgente (crítico + parado)", ot?.estado === "asignada" && ot?.prioridad === "urgente" && ot?.numero === 1 && ot?.empresa_cargo_id === emp.INY && ot?.requiere_verificacion === true, r);
r = await enc.from("reportes_falla").select("estado,orden_id").eq("id", repId).single(); prueba("el reporte queda «en orden»", r.data?.estado === "en_orden" && r.data?.orden_id === ot?.id, r);
r = await jefe.from("equipos").select("estado").eq("id", comp.id).single(); prueba("el equipo pasa a «en reparación»", r.data?.estado === "en_reparacion", r);
r = await enc.from("ordenes").update({ estado: "cerrada" }).eq("id", ot.id).select(); prueba("el estado no se cambia a mano", !!r.error, r);
r = await enc.from("ordenes").update({ descripcion: "Revisar sellos" }).eq("id", ot.id).select(); prueba("el encargado edita la descripción", filas(r) === 1, r);
r = await dir.from("ordenes").update({ descripcion: "x" }).eq("id", ot.id).select(); prueba("dirección no modifica órdenes", no(r), r);
r = await enc.rpc("orden_prioridad", { p_orden: ot.id, p_prioridad: "media" }); prueba("el encargado no cambia la prioridad", !!r.error);
r = await dir.rpc("orden_prioridad", { p_orden: ot.id, p_prioridad: "alta" }); prueba("dirección ya no cambia la prioridad (solo mira)", !!r.error);
r = await jefe.rpc("orden_prioridad", { p_orden: ot.id, p_prioridad: "alta" }); prueba("el jefe confirma o cambia la prioridad", !r.error, r.error);
r = await tec2.from("ordenes").select("id"); prueba("el técnico de LIM no ve órdenes de INY", no(r), r);
r = await enc.from("ordenes").update({ asignado_a: tec2.uid }).eq("id", ot.id).select(); prueba("no se asigna una orden a un técnico sin acceso a la empresa del equipo", !!r.error, r);
r = await enc.from("ordenes").insert({ equipo_id: comp.id, titulo: "Otra", asignado_a: op.uid }).select(); prueba("ni a un operario", !!r.error, r);
r = await enc.from("usuario_empresas").select("usuario_id").eq("usuario_id", tec.uid); prueba("el encargado ve a qué empresas accede cada técnico (para asignar)", filas(r) === 1, r);
r = await tec.from("usuario_empresas").select("usuario_id").eq("usuario_id", tec2.uid); prueba("el técnico no ve las empresas de otros", no(r), r);

console.log("Fichas, costos y compras");
r = await tec2.from("fichas").insert({ orden_id: ot.id, trabajo: "x", horas: 1 }).select(); prueba("un técnico no asignado no carga fichas", no(r) || !!r.error, r);
r = await tec.from("fichas").insert({ orden_id: ot.id, trabajo: "Desarmé el cilindro: sello cortado", horas: 2, horas_parada: 2, tecnico_id: jefe.uid }).select().single();
prueba("el técnico asignado carga la ficha (a su nombre)", r.data?.tecnico_id === tec.uid, r);
r = await enc.from("ordenes").select("estado").eq("id", ot.id).single(); prueba("la orden pasa a «en curso»", r.data?.estado === "en_curso", r);
r = await tec.from("fichas").update({ horas: 10 }).eq("orden_id", ot.id).select(); prueba("las fichas no se editan", no(r), r);
r = await tec.from("costos_orden").insert({ orden_id: ot.id, tipo: "repuesto", descripcion: "Kit de sellos", cantidad: 1, costo_unitario: 45000 }).select(); prueba("el técnico carga repuestos usados", filas(r) === 1, r);
r = await tec.from("costos_orden").insert({ orden_id: ot.id, tipo: "servicio", descripcion: "Tornería", costo_unitario: 90000 }).select(); prueba("el técnico no carga servicios externos", no(r) || !!r.error, r);
r = await jefe.from("costos_orden").insert({ orden_id: ot.id, tipo: "servicio", descripcion: "Tornería del vástago", costo_unitario: 90000 }).select(); prueba("el jefe carga el servicio externo", filas(r) === 1, r);
r = await tec.rpc("pedir_repuesto", { p_orden: ot.id, p_descripcion: "Sello principal 80 mm", p_cantidad: 2, p_monto: 120000 }); prueba("el técnico pide un repuesto", !r.error, r.error);
const ped = r.data;
r = await enc.from("ordenes").select("estado").eq("id", ot.id).single(); prueba("la orden pasa a «esperando repuesto»", r.data?.estado === "esperando_repuesto", r);
r = await dir.rpc("resolver_pedido", { p_pedido: ped, p_aprobar: true }); prueba("dirección no aprueba compras", !!r.error);
r = await enc.rpc("resolver_pedido", { p_pedido: ped, p_aprobar: true }); prueba("el encargado no aprueba compras", !!r.error);
r = await jefe.rpc("resolver_pedido", { p_pedido: ped, p_aprobar: true, p_respuesta: "Ok" }); prueba("el jefe aprueba la compra", !r.error, r.error);
r = await enc.rpc("recibir_pedido", { p_pedido: ped }); prueba("el encargado registra que llegó", !r.error, r.error);
r = await enc.from("ordenes").select("estado").eq("id", ot.id).single(); prueba("la orden vuelve a «en curso»", r.data?.estado === "en_curso", r);
r = await jefe.from("pedidos_compra").insert({ empresa_id: emp.INY, descripcion: "Grasa", monto_estimado: 2000000 }).select().single();
prueba("lo que pide el jefe queda aprobado por él (sin tope)", r.data?.estado === "aprobado" && r.data?.resuelto_por === jefe.uid, r);
r = await enc.from("pedidos_compra").insert({ empresa_id: emp.INY, descripcion: "Grasa" }).select(); prueba("el encargado no carga pedidos sueltos (los pide desde una orden)", no(r) || !!r.error, r);
r = await tec.from("fichas").insert({ orden_id: ot.id, trabajo: "Cambié el sello y probé", horas: 3, horas_parada: 3, es_cierre: true, causa: "desgaste" }).select();
prueba("equipo crítico: el cierre sin firma del supervisor se rechaza", !!r.error, r);
r = await tec.from("fichas").insert({ orden_id: ot.id, trabajo: "Cambié el sello y probé", horas: 3, horas_parada: 3, es_cierre: true, causa: "desgaste", supervisor_nombre: "Pedro Supervisor", firma_ruta: `${tec.uid}/firma.png` }).select();
prueba("con la firma del supervisor se cierra", filas(r) === 1, r);
r = await enc.from("ordenes").select("estado").eq("id", ot.id).single(); prueba("la orden queda «verificada por producción»", r.data?.estado === "verificada", r);
r = await jefe.from("equipos").select("estado").eq("id", comp.id).single(); prueba("el equipo vuelve a operativo", r.data?.estado === "operativo", r);
r = await tec.rpc("orden_estado", { p_orden: ot.id, p_estado: "cerrada" }); prueba("el técnico no cierra la orden", !!r.error);
r = await enc.rpc("orden_estado", { p_orden: ot.id, p_estado: "cerrada" }); prueba("el encargado cierra la orden", !r.error, r.error);
r = await tec.from("fichas").insert({ orden_id: ot.id, trabajo: "algo más", horas: 1 }).select(); prueba("no se cargan fichas en una orden cerrada", no(r) || !!r.error, r);
r = await enc.from("ordenes").insert({ equipo_id: comp2.id, titulo: "Ruido en el motor" }).select().single();
const ot2 = r.data;
prueba("orden sin asignar: abierta, prioridad media (no crítico, no parado → baja)", ot2?.estado === "abierta" && ot2?.prioridad === "baja", r);
r = await enc.from("fichas").insert({ orden_id: ot2.id, trabajo: "Trabajo del contratista", horas: 4, contratista_id: null }).select(); prueba("el encargado carga fichas propias", filas(r) === 1, r);
const prov = (await jefe.from("proveedores").insert({ nombre: "Electro Sur" }).select().single()).data;
r = await enc.from("fichas").insert({ orden_id: ot2.id, trabajo: "Rebobinado", horas: 6, contratista_id: prov.id }).select(); prueba("el trabajo de un contratista lo carga el jefe, no el encargado", no(r) || !!r.error, r);
r = await jefe.from("fichas").insert({ orden_id: ot2.id, trabajo: "Rebobinado del motor", horas: 6, contratista_id: prov.id, remito: "R-0001-123" }).select().single(); prueba("el jefe carga el trabajo del contratista", r.data?.contratista_id === prov.id && r.data?.tecnico_id === null, r);
r = await enc.rpc("orden_estado", { p_orden: ot2.id, p_estado: "anulada", p_motivo: "error" }); prueba("el encargado no anula órdenes", !!r.error);
r = await jefe.rpc("orden_estado", { p_orden: ot2.id, p_estado: "anulada", p_motivo: "Cargada dos veces" }); prueba("el jefe anula con motivo", !r.error, r.error);
r = await jefe.from("ordenes").delete().eq("id", ot2.id).select(); prueba("las órdenes no se borran", no(r) || !!r.error, r);

console.log("Movimientos de equipos");
r = await enc.rpc("pedir_prestamo", { p_equipo: apl.id, p_empresa_destino: emp.INY, p_area: null, p_ubicacion: "Nave 1", p_vuelta: null, p_motivo: "pico" }); prueba("el encargado no pide préstamos", !!r.error);
r = await jefe.rpc("pedir_prestamo", { p_equipo: apl.id, p_empresa_destino: emp.INY, p_area: null, p_ubicacion: "Nave 1", p_vuelta: "2026-12-31", p_motivo: "Pico de producción" }); prueba("el jefe pide el préstamo de LIM a INY", !r.error, r.error);
const mov = r.data;
r = await jefe.from("movimientos_equipo").select("estado,resuelto_por").eq("id", mov).single(); prueba("el préstamo que decide el jefe queda aprobado", r.data?.estado === "aprobado" && r.data?.resuelto_por === jefe.uid, r);
r = await dir.rpc("resolver_prestamo", { p_mov: mov, p_aprobar: false, p_respuesta: "no" }); prueba("dirección no aprueba ni rechaza préstamos", !!r.error);
r = await jefe.rpc("mover_equipo", { p_mov: mov, p_accion: "salida" }); prueba("el jefe registra la salida", !r.error, r.error);
r = await tec.from("equipos").select("codigo,empresa_ubicacion_id").eq("id", apl.id); prueba("el técnico de INY ya ve el apilador prestado (el código no cambia)", r.data?.[0]?.codigo === "LIM-APL-001" && r.data[0].empresa_ubicacion_id === emp.INY, r);
r = await jefe.rpc("mover_equipo", { p_mov: mov, p_accion: "vuelta" }); prueba("vuelve a LIM", !r.error, r.error);
r = await tec.from("equipos").select("id").eq("id", apl.id); prueba("y el técnico de INY deja de verlo", no(r), r);
r = await jefe.rpc("pedir_prestamo", { p_equipo: apl.id, p_empresa_destino: emp.PIN, p_area: null, p_ubicacion: null, p_vuelta: null, p_motivo: "Prueba" }); const mov2 = r.data;
r = await jefe.rpc("pedir_prestamo", { p_equipo: apl.id, p_empresa_destino: emp.SAL, p_area: null, p_ubicacion: null, p_vuelta: null, p_motivo: "Otro" }); prueba("no se piden dos préstamos a la vez del mismo equipo", !!r.error);
r = await dir.rpc("cancelar_prestamo", { p_mov: mov2, p_motivo: "x" }); prueba("dirección no cancela préstamos (los aprueba o rechaza)", !!r.error);
r = await jefe.rpc("cancelar_prestamo", { p_mov: mov2, p_motivo: "Ya no hace falta" }); prueba("el jefe cancela un préstamo que no salió", !r.error, r.error);
r = await jefe.rpc("cancelar_prestamo", { p_mov: mov, p_motivo: "x" }); prueba("pero no uno que ya salió y volvió", !!r.error);
r = await jefe.rpc("reparacion_externa", { p_equipo: comp2.id, p_proveedor: prov.id, p_salida: "2026-11-14", p_vuelta: "2026-11-30", p_presupuesto: 250000, p_remito: "R-1", p_motivo: "Rebobinado" }); prueba("el jefe manda a reparar afuera", !r.error, r.error);
r = await jefe.from("equipos").select("estado").eq("id", comp2.id).single(); prueba("el equipo queda en «reparación externa»", r.data?.estado === "reparacion_externa", r);
r = await enc.rpc("baja_equipo", { p_equipo: comp.id, p_motivo: "x", p_destino: "chatarra" }); prueba("el encargado no da de baja", !!r.error);
r = await jefe.rpc("baja_equipo", { p_equipo: comp.id, p_motivo: "viejo", p_destino: "chatarra" }); prueba("la baja exige explicar el motivo", !!r.error);
r = await jefe.rpc("baja_equipo", { p_equipo: comp.id, p_motivo: "Fin de vida útil: cilindro fisurado", p_destino: "venta", p_fecha: "2099-01-01" }); prueba("la fecha de baja no puede ser futura", !!r.error);
r = await jefe.rpc("baja_equipo", { p_equipo: comp.id, p_motivo: "Fin de vida útil: cilindro fisurado", p_destino: "venta", p_receptor: "Chatarrería Sur", p_valor: 350000 });
prueba("baja con motivo, destino, quién lo retira y valor de recupero", !r.error && sql(`select receptor || '|' || valor_recupero::int || '|' || (resuelto_por = '${jefe.uid}') from movimientos_equipo where id = '${r.data}'`) === "Chatarrería Sur|350000|true", r.error);
r = await enc.from("ordenes").insert({ equipo_id: comp.id, titulo: "x" }).select(); prueba("no se crean órdenes de un equipo dado de baja", !!r.error, r);
r = await tec.from("movimientos_equipo").insert({ equipo_id: apl.id, tipo: "baja", estado: "cerrado" }).select(); prueba("los movimientos no se cargan salteando las funciones", no(r) || !!r.error, r);

console.log("Cambiar el usuario de ingreso");
r = await enc.rpc("cambiar_usuario", { p_id: enc.uid, p_usuario: "marta.gil" }); prueba("solo el jefe cambia usuarios (ni el propio)", !!r.error);
r = await jefe.rpc("cambiar_usuario", { p_id: enc.uid, p_usuario: "tecnico" }); prueba("no se repite un usuario existente", !!r.error);
r = await jefe.rpc("cambiar_usuario", { p_id: enc.uid, p_usuario: "Con Espacios" }); prueba("ni se aceptan espacios o mayúsculas raras", !!r.error);
r = await jefe.rpc("cambiar_usuario", { p_id: enc.uid, p_usuario: "marta.gil" }); prueba("el jefe cambia el usuario del encargado", !r.error, r.error);
try { const m = await entrar("marta.gil", "clave-encargado"); prueba("ingresa con el usuario nuevo y la misma contraseña", m.uid === enc.uid); }
catch (e) { prueba("ingresa con el usuario nuevo y la misma contraseña", false, e.message); }
await entrar("encargado").then(() => prueba("y el usuario viejo ya no sirve", false), () => prueba("y el usuario viejo ya no sirve", true));
r = await jefe.rpc("cambiar_usuario", { p_id: jefe.uid, p_usuario: "jefe.mant" }); prueba("el jefe cambia su propio usuario", !r.error, r.error);
r = await jefe.rpc("editar_usuario", { p_id: jefe.uid, p_nombre: "Jefe de Mantenimiento", p_perfil: "jefe", p_telefono: "11 4444-0000", p_empresas: [] }); prueba("y edita sus datos", !r.error, r.error);
r = await jefe.rpc("editar_usuario", { p_id: jefe.uid, p_nombre: "Jefe de Mantenimiento", p_perfil: "encargado", p_telefono: null, p_empresas: [emp.INY] }); prueba("pero no se puede sacar el perfil de jefe", !!r.error);
r = await jefe.rpc("cambiar_usuario", { p_id: jefe.uid, p_usuario: "jefe" }); r = await jefe.rpc("cambiar_usuario", { p_id: enc.uid, p_usuario: "encargado" });
console.log("Desactivar usuarios");
r = await jefe.rpc("estado_usuario", { p_id: op2.uid, p_activo: false }); prueba("el jefe desactiva al operario", !r.error, r.error);
r = await op2.from("equipos").select("id"); prueba("el desactivado ya no ve nada aunque tenga sesión", no(r), r);
await entrar("operario2").then(() => prueba("y no puede ingresar", false), () => prueba("y no puede ingresar", true));
r = await jefe.rpc("estado_usuario", { p_id: jefe.uid, p_activo: false }); prueba("el jefe no se desactiva a sí mismo", !!r.error);

console.log("Apariencia");
const fabrica = JSON.parse((await import("node:fs")).readFileSync(new globalThis.URL("../../src/sistema/fabrica.json", import.meta.url), "utf8"));
r = await anon.from("temas").select("tokens,version").eq("activo", true).single();
prueba("sin sesión se lee el tema activo (pantalla de ingreso)", r.data?.version === 1, r);
prueba("el tema de fábrica de la base es igual al de la app (fabrica.json)", JSON.stringify(r.data?.tokens) === JSON.stringify(fabrica) || JSON.stringify(Object.keys(r.data?.tokens || {}).sort()) === JSON.stringify(Object.keys(fabrica).sort()) && r.data.tokens.areas.mant.principal === fabrica.areas.mant.principal);
r = await anon.from("temas").select("version").eq("activo", false); prueba("sin sesión no se ven las versiones viejas", no(r) || r.data.every((x) => x.version === 1), r);
const nuevo = structuredClone(fabrica); nuevo.areas.mant.principal = "#0B4F8F";
r = await dir.rpc("guardar_tema", { p_tokens: nuevo }); prueba("dirección no cambia la apariencia", !!r.error);
r = await tec.rpc("guardar_tema", { p_tokens: nuevo }); prueba("el técnico no cambia la apariencia", !!r.error);
const ilegible = structuredClone(fabrica); ilegible.colores.claro.tinta = "#C8CDD2";
r = await jefe.rpc("guardar_tema", { p_tokens: ilegible }); prueba("la base no guarda texto ilegible sin confirmar (contraste < 4,5:1)", r.data?.ok === false && r.data.problemas.length > 0, r.data);
r = await jefe.rpc("guardar_tema", { p_tokens: nuevo, p_nota: "Azul más oscuro" }); prueba("el jefe guarda una versión nueva y queda activa", r.data?.ok === true && r.data.version === 2, r);
r = await jefe.from("temas").update({ tokens: ilegible }).eq("version", 2).select(); prueba("una versión guardada no se edita", !!r.error || no(r), r);
r = await jefe.from("temas").delete().eq("version", 1).select(); prueba("el tema de fábrica no se borra", !!r.error || no(r), r);
try { sql("delete from public.temas where de_fabrica"); prueba("ni desde el SQL Editor", false); } catch { prueba("ni desde el SQL Editor", true); }
r = await jefe.rpc("volver_a_tema", { p_version: 1 }); prueba("se vuelve al tema de fábrica con un botón (como versión 3)", r.data?.version === 3, r);
r = await tec.from("preferencias_usuario").upsert({ usuario_id: tec.uid, tema: "oscuro", tamano: "grande" }).select(); prueba("cada usuario guarda su tema y tamaño", filas(r) === 1, r);
r = await tec.from("preferencias_usuario").upsert({ usuario_id: enc.uid, tema: "oscuro" }).select(); prueba("y no puede cambiar las de otro", !!r.error || no(r), r);
r = await enc.from("preferencias_usuario").select("tema"); prueba("ni verlas", no(r), r);

console.log("Registro de cambios");
r = await dir.from("registro_cambios").select("operacion,tabla,resumen,nombre,aprobo_nombre").order("id");
const reg = r.data || [];
prueba("dirección ve el registro", reg.length > 30, r.error);
prueba("registra los ingresos", reg.some((x) => x.operacion === "ingreso" && x.nombre === "Nombre tecnico"));
prueba("registra quién aprobó la compra", reg.some((x) => /^Aprobó el pedido de compra PC-0001/.test(x.resumen) && x.aprobo_nombre === "Jefe de Mantenimiento"), reg.filter((x) => /pedido/.test(x.resumen)));
prueba("registra quién aprobó el préstamo", reg.some((x) => x.tabla === "movimientos_equipo" && /LIM-APL-001/.test(x.resumen) && x.aprobo_nombre === "Jefe de Mantenimiento"), reg.filter((x) => x.tabla === "movimientos_equipo").slice(0, 3));
prueba("registra la baja del equipo", reg.some((x) => /^Dio de baja el equipo INY-COM-001/.test(x.resumen)));
r = await enc.from("registro_cambios").select("id"); prueba("el encargado no ve el registro", no(r), r);
r = await dir.from("registro_cambios").delete().gt("id", 0).select(); prueba("nadie lo borra desde la app", no(r), r);
try { sql("delete from public.registro_cambios"); prueba("ni desde el SQL Editor", false); } catch { prueba("ni desde el SQL Editor", true); }
try { sql("update public.registro_cambios set nombre = 'otro'"); prueba("ni se edita", false); } catch { prueba("ni se edita", true); }
r = await jefe.from("ordenes").select("creado_por,creado_en,modificado_por,modificado_en").eq("id", ot.id).single();
prueba("cada registro tiene creado_por, creado_en, modificado_por y modificado_en", !!(r.data?.creado_por && r.data?.creado_en && r.data?.modificado_por && r.data?.modificado_en), r);

console.log("Avisos");
const avisosDe = (uid, tipo) => Number(sql(`select count(*) from avisos where usuario_id = '${uid}' and tipo = '${tipo}'`));
prueba("máquina parada: avisa al jefe, al encargado y al técnico de la empresa", avisosDe(jefe.uid, "maquina_parada") >= 1 && avisosDe(enc.uid, "maquina_parada") >= 1 && avisosDe(tec.uid, "maquina_parada") >= 1);
prueba("pero no al técnico de otra empresa ni a quien reportó", avisosDe(tec2.uid, "maquina_parada") === 0 && avisosDe(op.uid, "maquina_parada") === 0);
prueba("orden asignada: avisa al técnico", avisosDe(tec.uid, "orden_asignada") >= 1);
prueba("compra por aprobar: avisa al jefe (no a dirección)", avisosDe(jefe.uid, "compra_pendiente") >= 1 && avisosDe(dir.uid, "compra_pendiente") === 0 && avisosDe(enc.uid, "compra_pendiente") === 0);
prueba("compra resuelta: avisa a quien la pidió; los préstamos del jefe no generan avisos de aprobación", avisosDe(tec.uid, "compra_resuelta") >= 1 && avisosDe(dir.uid, "prestamo_pendiente") === 0);
r = await tec.from("avisos").select("usuario_id"); prueba("cada uno ve solo sus avisos", filas(r) > 0 && r.data.every((x) => x.usuario_id === tec.uid), r);
r = await tec.from("avisos").insert({ usuario_id: enc.uid, tipo: "x", titulo: "falso" }).select(); prueba("nadie inventa avisos desde la app", no(r) || !!r.error, r);
r = await tec.rpc("marcar_avisos_leidos", {}); prueba("se marcan como leídos", !r.error && sql(`select count(*) from avisos where usuario_id = '${tec.uid}' and leido_en is null`) === "0", r.error);
prueba("solo los propios", sql(`select count(*) from avisos where usuario_id = '${enc.uid}' and leido_en is not null`) === "0");
r = await tec.rpc("suscribir_push", { p_endpoint: "https://push.ejemplo/abc", p_p256dh: "k", p_auth: "a", p_agente: "prueba" }); prueba("el técnico suscribe su celular", !r.error, r.error);
r = await enc.rpc("suscribir_push", { p_endpoint: "https://push.ejemplo/abc", p_p256dh: "k2", p_auth: "a2" }); prueba("si otro usuario ingresa en ese celular, la suscripción pasa a él", !r.error && sql("select usuario_id from push_suscripciones where endpoint = 'https://push.ejemplo/abc'") === enc.uid, r.error);
r = await tec.from("push_suscripciones").select("id"); prueba("nadie ve las suscripciones de otro", no(r), r);
r = await enc.rpc("suscribir_push", { p_endpoint: "http://malo", p_p256dh: "k", p_auth: "a" }); prueba("se rechazan direcciones inválidas", !!r.error);
r = await jefe.rpc("tomar_avisos", { p_cantidad: 5 }); prueba("solo la función de envío toma los avisos para mandar", !!r.error);
r = await jefe.rpc("avisos_diarios"); prueba("los avisos diarios no se disparan desde la app", !!r.error);
r = await anon.from("servidor").select("*"); const r2 = await jefe.from("servidor").select("*"); prueba("la configuración del servidor no se lee desde la app", (no(r)) && no(r2));
sql("update ordenes set vence = current_date - 3 where numero = 1 and estado not in ('cerrada','anulada','terminada','verificada')");
const nVenc = sql("select count(*) from ordenes where vence < current_date and estado in ('abierta','asignada','esperando_repuesto','en_curso')");
sql("select public.avisos_diarios()");
prueba("avisos diarios: resumen al jefe y a dirección", avisosDe(jefe.uid, "resumen_diario") === 1 && avisosDe(dir.uid, "resumen_diario") === 1 && avisosDe(enc.uid, "resumen_diario") === 0);
prueba("y órdenes vencidas al encargado", nVenc === "0" || avisosDe(enc.uid, "orden_vencida") >= 1, nVenc);

console.log("Siglas de las empresas");
r = await jefe.from("empresas").update({ sigla: "INX" }).eq("id", emp.INY).select(); prueba("una empresa con equipos activos no cambia la sigla", !!r.error, r);
r = await jefe.from("empresas").insert({ sigla: "PRB", nombre: "Empresa de prueba", orden: 9 }).select().single(); const prb = r.data;
r = await jefe.from("equipos").insert({ empresa_duena_id: prb.id, tipo: "BOM", nombre: "Bomba vieja", codigo: "", numero: 0 }).select().single(); const vieja = r.data;
prueba("(preparación: equipo PRB-BOM-001)", vieja?.codigo === "PRB-BOM-001", r);
r = await jefe.rpc("baja_equipo", { p_equipo: vieja.id, p_motivo: "Equipo de prueba, se da de baja", p_destino: "chatarra" });
r = await jefe.from("empresas").update({ sigla: "NVA" }).eq("id", prb.id).select(); prueba("sin equipos activos (solo dados de baja) la sigla se cambia", filas(r) === 1, r);
r = await jefe.from("equipos").insert({ empresa_duena_id: prb.id, tipo: "BOM", nombre: "Bomba nueva", codigo: "", numero: 0 }).select().single();
prueba("el equipo nuevo toma la sigla nueva y empieza en 001; el dado de baja conserva su código", r.data?.codigo === "NVA-BOM-001" && sql(`select codigo from equipos where id = '${vieja.id}'`) === "PRB-BOM-001", r);
r = await jefe.from("empresas").update({ sigla: "PRA" }).eq("id", prb.id).select(); prueba("y con un equipo activo, ya no", !!r.error, r);
r = await tec.from("empresas").update({ nombre: "x" }).eq("id", emp.LIM).select(); prueba("solo el jefe edita empresas", no(r) || !!r.error, r);

console.log("Proveedores y contratistas");
r = await enc.from("proveedores").insert({ nombre: "Contratista del encargado", rubro: "Soldadura" }).select().single(); prueba("el encargado carga un contratista nuevo", !!r.data?.id, r.error);
r = await tec.from("proveedores").insert({ nombre: "Contratista del técnico" }).select(); prueba("el técnico no carga proveedores", no(r) || !!r.error, r);
r = await enc.from("proveedores").update({ activo: false }).eq("nombre", "Contratista del encargado").select(); prueba("solo el jefe los edita o desactiva", no(r) || !!r.error, r);

console.log("Eliminar usuarios");
for (const [u, p] of [["borrable", "operario"], ["con.historia", "operario"]]) await crear(jefe, u, p, ["INY"]);
const borrable = sql("select id from usuarios where usuario = 'borrable'"), conHist = sql("select id from usuarios where usuario = 'con.historia'");
const ch = await entrar("con.historia");
r = await ch.from("reportes_falla").insert({ equipo_id: comp2.id, tipo_falla: "ruido", parada: false, texto: "Reporte de quien después se elimina" }).select().single();
prueba("(preparación: un operario con un reporte cargado)", !!r.data, r.error);
r = await jefe.rpc("eliminar_usuario", { p_id: borrable }); prueba("no se elimina a alguien activo: primero se da de baja", !!r.error);
await jefe.rpc("estado_usuario", { p_id: borrable, p_activo: false }); await jefe.rpc("estado_usuario", { p_id: conHist, p_activo: false });
r = await enc.rpc("eliminar_usuario", { p_id: borrable }); prueba("solo el jefe elimina usuarios", !!r.error);
r = await jefe.rpc("eliminar_usuario", { p_id: jefe.uid }); prueba("el jefe no se elimina a sí mismo", !!r.error);
r = await jefe.rpc("eliminar_usuario", { p_id: borrable });
prueba("sin historia se borra del todo (también su cuenta)", r.data === "borrado" && sql(`select count(*) from usuarios where id = '${borrable}'`) === "0" && sql(`select count(*) from auth.users where id = '${borrable}'`) === "0", r.error || r.data);
r = await jefe.rpc("eliminar_usuario", { p_id: conHist });
prueba("con historia deja de figurar y libera su usuario", r.data === "archivado" && sql(`select eliminado || '|' || (usuario like 'eliminado.%') from usuarios where id = '${conHist}'`) === "true|true", r.error || r.data);
prueba("pero su nombre queda en el historial", sql(`select n.nombre from reportes_falla x join usuarios n on n.id = x.operario_id where x.texto = 'Reporte de quien después se elimina'`) === "Nombre con.historia");
await entrar("con.historia").then(() => prueba("y no puede ingresar", false), () => prueba("y no puede ingresar", true));
r = await jefe.rpc("estado_usuario", { p_id: conHist, p_activo: true }); prueba("un eliminado no se reactiva", !!r.error);
r = await crear(jefe, "con.historia", "operario", ["INY"]); prueba("el usuario liberado se puede volver a usar", !r.error, r.error);
try { sql(`delete from usuarios where id = '${conHist}'`); prueba("fuera de eliminar_usuario, los usuarios no se borran", false); } catch { prueba("fuera de eliminar_usuario, los usuarios no se borran", true); }

console.log("Preventivos");
r = await enc.from("preventivos").insert({ equipo_id: comp2.id, titulo: "x", frecuencia: 1, unidad: "meses" }).select(); prueba("el encargado no arma el plan (lo cambia el jefe)", no(r) || !!r.error, r);
r = await jefe.from("preventivos").insert({ equipo_id: comp2.id, titulo: "Revisión de correas", frecuencia: 1, unidad: "meses", ultima_fecha: "2026-01-01" }).select().single();
const prev = r.data; prueba("el jefe carga una tarea preventiva", !!prev?.id, r.error);
prueba("vencida según la base", sql(`select public.preventivo_estado(p, e.horometro) from preventivos p join equipos e on e.id = p.equipo_id where p.id = '${prev.id}'`) === "vencida");
r = await tec.from("preventivos").select("id").eq("id", prev.id); prueba("el técnico de la empresa la ve", filas(r) === 1, r);
r = await tec2.from("preventivos").select("id").eq("id", prev.id); prueba("el de otra empresa no", no(r), r);
r = await op.from("preventivos").select("id"); prueba("el operario no ve el plan", no(r), r);
r = await enc.from("ordenes").insert({ equipo_id: comp2.id, preventivo_id: prev.id, titulo: "Preventivo: correas", tipo: "correctiva" }).select().single();
prueba("el encargado genera la orden (queda como preventiva)", r.data?.tipo === "preventiva", r.error);
r = await enc.from("ordenes").insert({ equipo_id: comp2.id, preventivo_id: prev.id, titulo: "Otra vez" }).select(); prueba("no se generan dos órdenes abiertas para la misma tarea", !!r.error, r);
r = await tec.rpc("preventivo_hecho", { p_id: prev.id }); prueba("el técnico no registra preventivos hechos a mano", !!r.error);
r = await enc.rpc("preventivo_hecho", { p_id: prev.id, p_fecha: "2026-11-10" }); prueba("el encargado sí (por ejemplo, al cargar el plan)", !r.error && sql(`select ultima_fecha from preventivos where id = '${prev.id}'`) === "2026-11-10", r.error);
r = await jefe.from("preventivos").delete().eq("id", prev.id).select(); prueba("las tareas no se borran (se quitan del plan)", no(r) || !!r.error, r);
sql("select public.avisos_diarios()");
prueba("el resumen diario cuenta los preventivos vencidos", /preventivos vencidos/.test(sql(`select cuerpo from avisos where usuario_id = '${jefe.uid}' and tipo = 'resumen_diario' order by id desc limit 1`)));

console.log(`\n${ok} correctas, ${mal} con problemas`);
process.exit(mal ? 1 : 0);
