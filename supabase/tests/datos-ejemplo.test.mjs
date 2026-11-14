// Prueba de cargar y borrar los datos de ejemplo, contra un Supabase local recién reseteado.
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… DB_URL=… node supabase/tests/datos-ejemplo.test.mjs
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_ANON_KEY, DB = process.env.DB_URL;
const sql = (q) => execFileSync("psql", [DB, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const falla = (q) => { try { sql(q); return null; } catch (e) { return String(e.stderr || e.message); } };
let ok = 0, mal = 0;
const prueba = (n, c, x) => { if (c) { ok++; console.log("  ✓ " + n); } else { mal++; console.log("  ✗ " + n + (x !== undefined ? "  → " + String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 300) : "")); } };
async function entrar(u, clave) {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: `${u}@cuentas.mantenimiento.app`, password: clave });
  if (error) throw error;
  c.uid = data.user.id; return c;
}

console.log("Datos de ejemplo");
sql("select public.primera_cuenta_jefe('jefe', 'Jefe de Mantenimiento', 'clave-jefe', null)");
prueba("pide una clave de al menos 8 caracteres", /al menos 8/.test(falla("select public.cargar_datos_ejemplo('corta')") || ""));
const res = sql("select public.cargar_datos_ejemplo('Ejemplo-2026')");
prueba("se cargan desde el SQL Editor", /Datos de ejemplo cargados/.test(res), res);
prueba("20 equipos de las 4 empresas, con su código", sql("select count(*) from equipos where ejemplo") === "20"
  && sql("select string_agg(distinct split_part(codigo, '-', 1), ',' order by split_part(codigo, '-', 1)) from equipos where ejemplo") === "INY,LIM,PIN,SAL");
prueba("6 usuarios «ej.», todos marcados", sql("select count(*) from usuarios where ejemplo and usuario like 'ej.%'") === "6");
prueba("situaciones para probar: máquina parada, préstamo en curso, reparación externa, orden vencida, compra por aprobar",
  sql("select estado from equipos where codigo = 'SAL-ENV-001'") === "detenido"
  && sql("select e.sigla from equipos q join empresas e on e.id = q.empresa_ubicacion_id where q.codigo = 'LIM-APL-001'") === "INY"
  && sql("select estado from equipos where codigo = 'PIN-AUT-001'") === "reparacion_externa"
  && sql("select count(*) from ordenes where vence < current_date and estado = 'asignada'") === "1"
  && sql("select count(*) from pedidos_compra where estado = 'pendiente'") === "1");
prueba("órdenes numeradas sin saltos", sql("select string_agg(numero::text, ',' order by numero) from ordenes") === "1,2,3,4,5,6");
prueba("la carga no manda avisos ni llena el registro fila por fila", sql("select count(*) from avisos") === "0" && sql("select count(*) from registro_cambios where tabla = 'datos_ejemplo'") === "1");
prueba("no se cargan dos veces", /ya están cargados/.test(falla("select public.cargar_datos_ejemplo('Ejemplo-2026')") || ""));

const tec = await entrar("ej.tecnico1", "Ejemplo-2026");
let r = await tec.from("equipos").select("codigo");
prueba("el técnico de ejemplo ingresa y ve solo sus empresas (INY y LIM)", r.data?.length > 0 && r.data.every((x) => /^(INY|LIM)-/.test(x.codigo)), r.data?.map((x) => x.codigo));
r = await tec.rpc("borrar_datos_ejemplo", {}); prueba("desde la app no se borran", !!r.error);
r = await tec.rpc("cargar_datos_ejemplo", { p_clave: "xxxxxxxxxx" }); prueba("ni se cargan", !!r.error);

// Cosas reales cargadas encima mientras se probaba
const jefe = await entrar("jefe", "clave-jefe");
const eqEj = sql("select id from equipos where codigo = 'INY-COM-001'");
r = await jefe.from("ordenes").insert({ equipo_id: eqEj, titulo: "Orden real sobre un equipo de ejemplo" }).select().single();
const real = await jefe.from("equipos").insert({ empresa_duena_id: sql("select id from empresas where sigla = 'INY'"), tipo: "BOM", nombre: "Bomba real", codigo: "", numero: 0 }).select().single();
const enc = await entrar("ej.encargado", "Ejemplo-2026");
await enc.from("equipos").select("id").limit(1);
r = await enc.from("ordenes").insert({ equipo_id: real.data.id, titulo: "Orden que cargó el encargado de ejemplo en un equipo real" }).select().single();
prueba("(preparación: hay una orden real en un equipo de ejemplo y una del encargado de ejemplo en un equipo real)", !r.error && !!real.data, r.error);
const e1 = falla("select public.borrar_datos_ejemplo()");
prueba("si hay cosas cargadas encima, no borra y avisa qué hay", /2 registros cargados en la app sobre datos de ejemplo/.test(e1 || "") && /2 órdenes/.test(e1 || ""), e1);
prueba("y no borró nada", sql("select count(*) from equipos where ejemplo") === "20");
const res2 = sql("select public.borrar_datos_ejemplo(p_tambien_lo_cargado_encima => true)");
prueba("con p_tambien_lo_cargado_encima borra todo", /Datos de ejemplo borrados: 20 equipos y 6 usuarios, y 2 registros/.test(res2), res2);
prueba("no queda nada de ejemplo (equipos, usuarios, cuentas, órdenes, proveedores)", sql("select count(*) from equipos where ejemplo") === "0" && sql("select count(*) from usuarios where ejemplo") === "0"
  && sql("select count(*) from auth.users where email like 'ej.%'") === "0" && sql("select count(*) from ordenes") === "0" && sql("select count(*) from proveedores where ejemplo") === "0"
  && sql("select count(*) from movimientos_equipo") === "0" && sql("select count(*) from pedidos_compra") === "0");
prueba("lo real queda: el jefe y su equipo", sql("select count(*) from usuarios where usuario = 'jefe'") === "1" && sql("select codigo from equipos") === "INY-BOM-001");
prueba("el registro de cambios conserva la carga y el borrado", sql("select string_agg(operacion, ',' order by id) from registro_cambios where tabla = 'datos_ejemplo'") === "alta,baja");
prueba("se pueden volver a cargar", /cargados/.test(sql("select public.cargar_datos_ejemplo('Ejemplo-2026')")));
prueba("y fuera de ese borrado, nada se borra", /no se borran/.test(falla("delete from equipos where codigo = 'INY-BOM-001'") || ""));

console.log(`\n${ok} correctas, ${mal} con problemas`);
process.exit(mal ? 1 : 0);
