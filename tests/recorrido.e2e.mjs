// Recorrido completo de la etapa 1 en un navegador real, contra un Supabase local con las migraciones
// aplicadas y sin datos (ver README → Pruebas). Crea sus propios usuarios.
//   APP_URL=http://localhost:5173/ DB_URL=postgresql://… node tests/recorrido.e2e.mjs [carpeta-capturas]
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP_URL || "http://localhost:5173/", DB = process.env.DB_URL, CAP = process.argv[2] || null;
const sql = (q) => execFileSync("psql", [DB, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
let ok = 0, mal = 0;
const prueba = (n, c, x) => { if (c) { ok++; console.log("  ✓ " + n); } else { mal++; console.log("  ✗ " + n + (x !== undefined ? "  → " + String(x).slice(0, 250) : "")); } };
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errores = [];
async function como(usuario, movil = false) {
  const ctx = await b.newContext({ ...(movil ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1360, height: 900 } }), acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { errores.push(e.message); console.log("  PAGEERROR " + e.message); });
  if (usuario) { await p.goto(APP); await p.fill("#l-u", usuario); await p.fill("#l-p", "clave-" + usuario); await p.click("form button[type=submit]"); await p.waitForSelector("main h1, .op h1"); }
  return p;
}
const foto = async (p, n) => { if (CAP) await p.screenshot({ path: `${CAP}/${n}.png` }); };
async function aviso(p, re) {
  const fin = Date.now() + 10000;
  while (Date.now() < fin) {
    const t = await p.evaluate(() => [...document.querySelectorAll(".aviso-flotante,.nota.critico")].map((x) => x.textContent).join(" | ")).catch(() => "");
    if (re.test(t)) return true;
    await p.waitForTimeout(150);
  }
  return false;
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// Usuarios (la primera cuenta del jefe, como en el README; el resto, como si los creara el jefe)
sql("select public.primera_cuenta_jefe('jefe', 'Agustín Coto', 'clave-jefe', '11 5555-0000')");
const emp = Object.fromEntries(sql("select sigla || '=' || id from empresas").split("\n").map((x) => x.split("=")));
for (const [u, n, p, e] of [["tecnico", "Diego Ríos", "tecnico", "INY"], ["tecnico2", "Lucas Paz", "tecnico", "LIM"], ["encargado", "Marta Gil", "encargado", "INY"],
  ["operario", "Juan Gómez", "operario", "INY"], ["direccion", "Roberto Alonso", "direccion", "INY,LIM,PIN,SAL"]])
  sql(`select public._crear_usuario('${u}', '${n}', '${p}', 'clave-${u}', null, array[${e.split(",").map((s) => `'${emp[s]}'::uuid`).join(",")}])`);

console.log("Equipos y relevamiento");
const jefe = await como("jefe");
await foto(jefe, "10-inicio-jefe");
await jefe.click("nav a[href='/equipos']"); await jefe.click("text=Relevamiento");
await jefe.setInputFiles("input[name=chapa]", { name: "chapa.png", mimeType: "image/png", buffer: png });
await jefe.selectOption("select[name=tipo]", "APL"); await jefe.selectOption("select[name=duena]", emp.LIM);
await jefe.fill("input[name=nombre]", "Apilador eléctrico 1,5 t"); await jefe.fill("input[name=marca]", "Toyota"); await jefe.fill("input[name=serie]", "SPE-77812");
await jefe.selectOption("select[name=ubicacion_empresa]", emp.INY); await jefe.fill("input[name=ubicacion]", "Depósito de producto terminado");
await foto(jefe, "11-relevamiento");
await jefe.evaluate(() => document.querySelector("input[name='campo:capacidad']").removeAttribute("required"));
await jefe.click("button[type=submit]:has-text('Dar de alta')");
prueba("la base exige los campos obligatorios del tipo (capacidad de carga)", await aviso(jefe, /Capacidad de carga/));
await jefe.fill("input[name='campo:capacidad']", "1500");
await jefe.click("button[type=submit]:has-text('Dar de alta')");
await jefe.waitForSelector("h1:has-text('Equipo dado de alta')");
const cod = (await jefe.textContent(".panel .codigo")).trim();
prueba("alta: código generado por la base LIM-APL-001 (empresa dueña LIM aunque esté en INY)", cod === "LIM-APL-001", cod);
prueba("muestra el QR y la etiqueta", !!(await jefe.$(".qr img")) && !!(await jefe.$("[aria-label='Etiqueta de LIM-APL-001']")));
await foto(jefe, "12-alta-ok");
const [pdf1] = await Promise.all([jefe.waitForEvent("download"), jefe.click("text=Etiqueta en PDF")]);
prueba("descarga la etiqueta en PDF", (await fs.promises.readFile(await pdf1.path())).subarray(0, 4).toString() === "%PDF");
await jefe.click("text=Ver la ficha"); await jefe.waitForSelector(".placa"); await jefe.waitForSelector(".placa img[alt='Foto de la chapa']", { timeout: 8000 }).catch(() => {});
const placa = await jefe.textContent(".placa");
prueba("la ficha muestra empresa dueña, dónde está (prestado) y la foto de la chapa", /Productos de limpieza/.test(placa) && /Inyectora de plásticos/.test(placa) && !!(await jefe.$(".placa img[alt='Foto de la chapa']")), placa.slice(0, 200));
const idApl = jefe.url().split("/").pop();
await jefe.click("button[role=tab]:has-text('Documentos')"); await jefe.click("text=Agregar documento");
await jefe.selectOption("select[name=categoria]", "manual"); await jefe.fill("input[name=nombre]", "Manual de operación");
await jefe.setInputFiles(".ventana input[type=file]", { name: "manual.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 prueba") });
await jefe.click(".ventana button[type=submit]");
prueba("el jefe sube un manual", await aviso(jefe, /Documento agregado/));
// Dos equipos más para las etiquetas
for (const [t, n, e] of [["COM", "Compresor de tornillo 30 HP", "INY"], ["INY", "Inyectora 280 t", "INY"]]) {
  await jefe.goto(APP + "equipos/nuevo"); await jefe.selectOption("select[name=tipo]", t); await jefe.selectOption("select[name=duena]", emp[e]);
  await jefe.fill("input[name=nombre]", n); await jefe.selectOption("select[name=criticidad]", "alta"); await jefe.click("button[type=submit]:has-text('Dar de alta')");
  await jefe.waitForSelector("h1:has-text('Equipo dado de alta')");
}
await jefe.goto(APP + "equipos/etiquetas"); await jefe.waitForSelector("text=Etiquetas QR y NFC");
await jefe.click("text=Elegir los 3 filtrados");
const [pdf3] = await Promise.all([jefe.waitForEvent("download"), jefe.click("button:has-text('PDF de 3 etiquetas')")]);
prueba("hoja de 3 etiquetas en PDF", (await fs.promises.readFile(await pdf3.path())).subarray(0, 4).toString() === "%PDF");
await foto(jefe, "13-etiquetas");

console.log("Enlace /e/<código> según el perfil");
const tec = await como("tecnico", true);
await tec.goto(APP + "e/LIM-APL-001"); await tec.waitForSelector(".placa");
prueba("técnico → ficha con órdenes del equipo (prestado a su empresa)", /vista=tecnico/.test(tec.url()) && (await tec.textContent("button[role=tab][aria-selected=true]")).includes("Órdenes"), tec.url());
prueba("el técnico ve los documentos", !!(await tec.$("button[role=tab]:has-text('Documentos')")));
prueba("el técnico no ve «Editar ficha»", !(await tec.$("text=Editar ficha")));
await foto(tec, "14-tecnico-ficha");
const tec2 = await como("tecnico2", true);
await tec2.goto(APP + "e/INY-COM-001"); await tec2.waitForSelector("h1");
prueba("un técnico de otra empresa no accede al equipo", /No encontramos ese equipo/.test(await tec2.textContent("main")));
const dir = await como("direccion");
await dir.goto(APP + "equipos/" + idApl); await dir.waitForSelector(".placa");
prueba("dirección ve la ficha pero no los documentos", !(await dir.$("button[role=tab]:has-text('Documentos')")));
const anon = await como(null, true);
await anon.goto(APP + "e/LIM-APL-001"); await anon.waitForSelector("#l-u");
prueba("sin sesión pide ingresar y avisa qué equipo se va a abrir", /LIM-APL-001/.test(await anon.textContent(".inicio")));
await anon.fill("#l-u", "jefe"); await anon.fill("#l-p", "clave-jefe"); await anon.click("form button[type=submit]");
await anon.waitForSelector(".placa"); prueba("y después de ingresar vuelve al equipo", anon.url().endsWith("/equipos/" + idApl), anon.url());
await jefe.goto(APP + "e/LH-DEP-API-001"); await jefe.waitForSelector("h1");
prueba("un código desconocido avisa que no existe", /No encontramos/.test(await jefe.textContent("main")));

console.log("Reporte del operario y orden de trabajo completa");
const estadoEq = (c) => sql(`select estado from equipos where codigo = '${c}'`);
const op = await como("operario", true);
await foto(op, "20-operario-inicio");
await op.goto(APP + "e/INY-INY-001"); await op.waitForSelector(".fallas");
prueba("operario: la etiqueta abre el reporte de esa máquina", /\/reportar\//.test(op.url()), op.url());
await op.click(".falla:has-text('Pérdida de aceite')");                                   // toque 1
await op.click("button:has-text('Sí, parada')");                                          // toque 2
await op.click("summary:has-text('Agregar foto')");
await op.setInputFiles("input[accept='image/*,video/*']", { name: "aceite.png", mimeType: "image/png", buffer: png });
await op.waitForSelector(".captura .medios img");
await op.fill("textarea", "Gotea aceite debajo del cilindro");
await foto(op, "21-operario-reporte");
await op.click("button:has-text('3. Enviar reporte')");                                    // toque 3
await op.waitForSelector("h1:has-text('Reporte enviado')");
prueba("el reporte se envía en 3 toques (más la foto opcional)", true);
prueba("con la máquina parada, el equipo queda «detenido»", estadoEq("INY-INY-001") === "detenido", estadoEq("INY-INY-001"));
prueba("la foto quedó adjunta al reporte", sql("select count(*) from adjuntos where tabla = 'reportes_falla'") === "1");
await foto(op, "22-operario-enviado");
await op.click("text=Volver al inicio"); await op.waitForSelector("text=Mis reportes");
prueba("«Mis reportes» lo muestra como recibido", /Recibido/.test(await op.textContent(".op")));

const enc = await como("encargado");
await enc.click("nav a[href='/reportes']"); await enc.waitForSelector("article.panel");
prueba("el encargado ve el reporte con la foto", /Pérdida de aceite/.test(await enc.textContent("main")) && !!(await enc.waitForSelector("article .medios img", { timeout: 8000 }).catch(() => null)));
await foto(enc, "23-bandeja-reportes");
await enc.click("article a:has-text('Crear')"); await enc.waitForSelector("select[name=asignado]");
await enc.selectOption("select[name=asignado]", { label: "Diego Ríos · Técnico" });
await enc.click("button[type=submit]:has-text('Crear')"); await enc.waitForURL(/\/ordenes\/[0-9a-f-]{36}$/);
const idOt = enc.url().split("/").pop();
let cab = await enc.textContent(".encabezado");
prueba("orden creada desde el reporte: urgente (equipo crítico y parado) y asignada", /Urgente/.test(cab) && /Asignada/.test(cab), cab.slice(0, 160));
prueba("el equipo pasa a «en reparación»", estadoEq("INY-INY-001") === "en_reparacion");
await foto(enc, "24-orden-creada");

await tec.goto(APP + "ordenes/" + idOt); await tec.waitForSelector("text=Empezar el trabajo");
await tec.click("text=Empezar el trabajo"); prueba("el técnico empieza el trabajo", await aviso(tec, /Trabajo empezado/));
await tec.click("button:has-text('Pedir repuesto')");
await tec.fill(".ventana input[name=descripcion]", "Juego de sellos del cilindro"); await tec.fill(".ventana input[name=monto]", "120.000");
await tec.click(".ventana button[type=submit]");
prueba("pide el repuesto y la orden queda esperando", await aviso(tec, /esperando el repuesto/) && sql(`select estado from ordenes where id = '${idOt}'`) === "esperando_repuesto");

await jefe.goto(APP + "compras"); await jefe.waitForSelector("text=PC-0001");
prueba("sin tope configurado, el jefe no aprueba compras", !(await jefe.$("td button:has-text('Aprobar')")));
await dir.goto(APP + "compras"); await dir.waitForSelector("text=PC-0001");
await dir.click("td button:has-text('Aprobar')"); await dir.click(".ventana button[type=submit]");
prueba("dirección aprueba el pedido", await aviso(dir, /Pedido aprobado/));
prueba("queda registrado quién aprobó", sql("select count(*) from registro_cambios where tabla = 'pedidos_compra' and aprobo_id is not null") !== "0");
await dir.goto(APP + "ordenes/" + idOt); await dir.waitForSelector("text=Falta que dirección la confirme");
await dir.click("button:has-text('Confirmar urgente')");
prueba("dirección confirma la prioridad", await aviso(dir, /Prioridad confirmada/));
await foto(dir, "25-direccion-orden");
await enc.goto(APP + "compras"); await enc.click("button[role=tab]:has-text('Aprobados')"); await enc.click("button:has-text('Llegó')"); await enc.click(".ventana button[type=submit]");
prueba("llega el repuesto y la orden vuelve a «en curso»", await aviso(enc, /Recepción registrada/) && sql(`select estado from ordenes where id = '${idOt}'`) === "en_curso");

await tec.goto(APP + "ordenes/" + idOt + "/ficha"); await tec.fill("textarea[name=trabajo]", "Desarme del cilindro, diagnóstico de sellos"); await tec.fill("input[name=horas]", "2");
await tec.click("button:has-text('Guardar ficha')"); await tec.waitForURL(/\/ordenes\/[0-9a-f-]{36}$/);
prueba("el técnico carga una ficha de trabajo", /Desarme del cilindro/.test(await tec.textContent("main")));
await tec.click("a:has-text('Ficha de cierre')"); await tec.waitForSelector("canvas.firma");
await tec.fill("textarea[name=trabajo]", "Cambio de sellos y prueba en vacío"); await tec.fill("input[name=horas]", "1,5"); await tec.fill("input[name=horas_parada]", "4");
await tec.selectOption("select[name=causa]", "desgaste");
await tec.setInputFiles(".captura:has-text('después') input[accept='image/*'][multiple]", { name: "despues.png", mimeType: "image/png", buffer: png });
await tec.fill("input[name=supervisor]", "Carla Méndez");
await tec.click("button:has-text('Terminar la orden')");
prueba("equipo crítico: sin firma no se termina", await aviso(tec, /Falta la firma/));
const cv = await (await tec.$("canvas.firma")).boundingBox();
await tec.mouse.move(cv.x + 30, cv.y + 120); await tec.mouse.down();
for (let i = 1; i <= 12; i++) await tec.mouse.move(cv.x + 30 + i * 18, cv.y + 120 - Math.sin(i / 2) * 50);
await tec.mouse.up();
await foto(tec, "26-ficha-cierre-firma");
await tec.click("button:has-text('Terminar la orden')"); await tec.waitForURL(/\/ordenes\/[0-9a-f-]{36}$/);
prueba("con la firma del supervisor, la orden queda verificada", sql(`select estado from ordenes where id = '${idOt}'`) === "verificada");
prueba("y el equipo vuelve a «operativo»", estadoEq("INY-INY-001") === "operativo");
prueba("la ficha muestra la firma", !!(await tec.waitForSelector("img[alt='Firma del supervisor']", { timeout: 8000 }).catch(() => null)));
const total = await tec.textContent("main");
prueba("costos: 3,5 h de mano de obra", /3,5 h/.test(total));
await foto(tec, "27-orden-verificada");
await enc.goto(APP + "ordenes/" + idOt); await enc.click("button:has-text('Cerrar la orden')"); await enc.click(".ventana button[type=submit]");
prueba("el encargado cierra la orden", await aviso(enc, /Orden cerrada/) && sql(`select estado from ordenes where id = '${idOt}'`) === "cerrada");
await tec2.goto(APP + "ordenes/" + idOt); await tec2.waitForSelector("h1");
prueba("un técnico de otra empresa no ve la orden", /No existe o no tenés acceso/.test(await tec2.textContent("main")));
await op.goto(APP); await op.waitForSelector("text=Mis reportes");
prueba("el operario ve su reporte como atendido", /Atendido/.test(await op.textContent(".op")));

// Un reporte que se descarta
await op.goto(APP + "e/INY-COM-001"); await op.click(".falla:has-text('Ruido')"); await op.click("button:has-text('No, funciona')"); await op.click("button:has-text('3. Enviar reporte')");
await op.waitForSelector("h1:has-text('Reporte enviado')");
prueba("sin máquina parada, el equipo sigue operativo", estadoEq("INY-COM-001") === "operativo");
await enc.goto(APP + "reportes"); await enc.click("article button:has-text('Descartar')"); await enc.fill(".ventana input[name=motivo]", "Ruido normal de la purga");
await enc.click(".ventana button[type=submit]"); prueba("el encargado descarta el reporte con motivo", await aviso(enc, /Reporte descartado/));
await op.goto(APP); await op.waitForSelector("text=Mis reportes");
prueba("el operario ve el motivo del descarte", !!(await op.waitForSelector("text=Ruido normal de la purga", { timeout: 8000 }).catch(() => null)));
await foto(op, "28-operario-mis-reportes");
await op.goto(APP + "ordenes"); await op.waitForSelector(".op h1");
prueba("el operario no entra a las órdenes", !/\/ordenes/.test(op.url()), op.url());

console.log("Movimientos de equipos");
const ubic = (c) => sql(`select e.sigla || '|' || coalesce(q.ubicacion, '') from equipos q join empresas e on e.id = q.empresa_ubicacion_id where q.codigo = '${c}'`);
const menuMov = async (p, id, opcion) => {
  await p.goto(APP + "equipos/" + id); await p.click(".encabezado button:has-text('Movimientos')");
  await p.click(`.ventana button.item:has-text('${opcion}')`); await p.waitForSelector(".ventana form");
};
await menuMov(jefe, idApl, "Préstamo");
await jefe.selectOption(".ventana select[name=destino]", emp.PIN); await jefe.fill(".ventana input[name=ubicacion]", "Sector envasado");
await jefe.fill(".ventana input[name=motivo]", "Pico de producción en PIN"); await jefe.click(".ventana button[type=submit]");
prueba("el jefe pide el préstamo desde la ficha", await aviso(jefe, /lo tiene que aprobar dirección/));
await dir.goto(APP); await dir.waitForSelector("nav a[href='/movimientos'] .insignia");
prueba("dirección ve el préstamo por aprobar en el menú", (await dir.textContent("nav a[href='/movimientos'] .insignia")) === "1");
await dir.click("nav a[href='/movimientos']"); await dir.click("td button:has-text('Aprobar')"); await dir.click(".ventana button[type=submit]");
prueba("dirección aprueba el préstamo", await aviso(dir, /Préstamo aprobado/));
await jefe.goto(APP + "movimientos"); await jefe.click("td button:has-text('Salió')"); await jefe.click(".ventana button[type=submit]");
prueba("el jefe registra la salida: el equipo figura en PIN y conserva su código", await aviso(jefe, /Salida registrada/) && ubic("LIM-APL-001") === "PIN|Sector envasado", ubic("LIM-APL-001"));
await foto(jefe, "30-movimientos");
await jefe.click("td button:has-text('Volvió')"); await jefe.click(".ventana button[type=submit]");
prueba("al volver, regresa a INY y al lugar donde estaba", await aviso(jefe, /Vuelta registrada/) && ubic("LIM-APL-001") === "INY|Depósito de producto terminado", ubic("LIM-APL-001"));

sql("insert into proveedores (nombre, rubro) values ('Bobinados Sur', 'Motores eléctricos')");
await jefe.goto(APP); await jefe.reload(); await jefe.waitForSelector("main h1");
const idCom = sql("select id from equipos where codigo = 'INY-COM-001'");
await menuMov(jefe, idCom, "Reparación externa");
await jefe.selectOption(".ventana select[name=proveedor]", { label: "Bobinados Sur" }); await jefe.fill(".ventana input[name=presupuesto]", "250.000");
await jefe.fill(".ventana input[name=remito]", "R-0001-123"); await jefe.fill(".ventana input[name=motivo]", "Rebobinado del motor");
await jefe.setInputFiles(".ventana input[accept='image/*'][multiple]", { name: "remito.png", mimeType: "image/png", buffer: png });
await jefe.waitForSelector(".ventana .captura .medios img");
await jefe.click(".ventana button[type=submit]");
prueba("el jefe manda a reparar afuera con foto del remito", await aviso(jefe, /Salida a reparación/) && estadoEq("INY-COM-001") === "reparacion_externa" && sql("select count(*) from adjuntos where tabla = 'movimientos_equipo'") === "1");
prueba("presupuesto con formato argentino (250.000 → 250000)", sql("select presupuesto::int from movimientos_equipo where tipo = 'reparacion_externa'") === "250000");
await jefe.goto(APP + "movimientos"); await jefe.click("td button:has-text('Volvió')");
await jefe.fill(".ventana input[name=costo]", "231.500"); await jefe.fill(".ventana input[name=garantia]", "2027-05-14"); await jefe.click(".ventana button[type=submit]");
prueba("vuelve de la reparación: operativo, con costo y garantía", await aviso(jefe, /Vuelta registrada/) && estadoEq("INY-COM-001") === "operativo"
  && sql("select presupuesto::int || '|' || garantia_hasta from movimientos_equipo where tipo = 'reparacion_externa'") === "231500|2027-05-14");

const idIny = sql("select id from equipos where codigo = 'INY-INY-001'");
await menuMov(jefe, idIny, "Reubicar"); await jefe.fill(".ventana input[name=ubicacion]", "Nave 2, línea 3"); await jefe.click(".ventana button[type=submit]");
prueba("el jefe reubica dentro de la empresa", await aviso(jefe, /Equipo reubicado/) && ubic("INY-INY-001") === "INY|Nave 2, línea 3");

await menuMov(jefe, idApl, "Dar de baja");
await jefe.selectOption(".ventana select[name=destino]", "venta"); await jefe.fill(".ventana input[name=motivo]", "Reemplazado por uno nuevo"); await jefe.click(".ventana button[type=submit]");
prueba("baja con motivo y destino", await aviso(jefe, /dado de baja/) && estadoEq("LIM-APL-001") === "baja");
await jefe.goto(APP + "equipos/" + idApl); await jefe.waitForSelector(".placa .pastilla:has-text('De baja')", { timeout: 8000 }).catch(() => {});
prueba("el equipo dado de baja conserva su historial y ya no ofrece movimientos", /De baja/.test(await jefe.textContent(".placa")) && !(await jefe.$(".encabezado button:has-text('Movimientos')")));
await jefe.click("button[role=tab]:has-text('Movimientos')");
prueba("la ficha lista sus movimientos (préstamo y baja)", (await jefe.$$("table tbody tr")).length === 2);
await foto(jefe, "31-ficha-baja");
await op.goto(APP + "e/LIM-APL-001"); await op.waitForSelector(".op h1");
prueba("el operario no puede reportar un equipo dado de baja", /dado de baja/.test(await op.textContent(".op")));

await enc.goto(APP + "equipos/" + idIny); await enc.click(".encabezado button:has-text('Movimientos')"); await enc.waitForSelector(".ventana");
const opsEnc = await enc.textContent(".ventana");
prueba("el encargado solo marca detenido u operativo (no presta, no manda a reparar, no da de baja)", /Marcar detenido/.test(opsEnc) && !/Préstamo|Reparación externa|Dar de baja|Reubicar/.test(opsEnc), opsEnc);
await enc.click(".ventana button.item:has-text('Marcar detenido')"); await enc.fill(".ventana input[name=motivo]", "Guarda de seguridad rota"); await enc.click(".ventana button[type=submit]");
prueba("el encargado detiene el equipo", await aviso(enc, /Equipo detenido/) && estadoEq("INY-INY-001") === "detenido");
await tec.goto(APP + "equipos/" + idIny); await tec.waitForSelector(".placa");
prueba("el técnico no tiene el botón de movimientos", !(await tec.$(".encabezado button:has-text('Movimientos')")));

console.log("Sin señal");
const barra = (p) => p.textContent(".conexion");
const esperarBarra = async (p, re) => { const fin = Date.now() + 20000; while (Date.now() < fin) { if (re.test(await barra(p).catch(() => ""))) return true; await p.waitForTimeout(250); } return false; };
// El operario abre la app con señal (queda guardada en el celular) y después se queda sin señal
await op.goto(APP); await op.waitForSelector(".op h1"); await op.reload(); await op.waitForSelector(".op h1"); await op.waitForTimeout(1500);
await op.context().setOffline(true);
prueba("la barra avisa «Sin señal»", await esperarBarra(op, /Sin señal/));
await op.goto(APP + "e/INY-INY-001").catch(() => {}); await op.waitForSelector(".fallas", { timeout: 15000 }).catch(() => {});
prueba("sin señal, la app abre igual y la etiqueta lleva al reporte", !!(await op.$(".fallas")), op.url());
await op.click(".falla:has-text('Temperatura alta')"); await op.click("button:has-text('No, funciona')");
await op.click("summary:has-text('Agregar foto')");
await op.setInputFiles("input[accept='image/*,video/*']", { name: "temp.png", mimeType: "image/png", buffer: png }); await op.waitForSelector(".captura .medios img");
await op.click("button:has-text('3. Enviar reporte')");
await op.waitForSelector("h1:has-text('Reporte guardado')", { timeout: 10000 }).catch(() => {});
prueba("el reporte queda guardado en el celular", /quedó guardado en el celular/.test(await op.textContent(".op")));
prueba("la barra cuenta las cargas pendientes (reporte, foto y su registro)", /Sin señal: 3 cargas pendientes/.test(await barra(op)), await barra(op));
await op.click("text=Volver al inicio"); await op.waitForSelector("text=Mis reportes");
prueba("«Mis reportes» lo muestra sin enviar", /Sin enviar/.test(await op.textContent(".op")));
await foto(op, "40-sin-senal");
prueba("todavía no llegó al servidor", sql("select count(*) from reportes_falla where tipo_falla = 'temperatura'") === "0");
await op.context().setOffline(false);
prueba("al volver la señal se envía solo", await esperarBarra(op, /^Conectado$/));
prueba("el reporte, la foto y su registro llegaron", sql("select count(*) from reportes_falla where tipo_falla = 'temperatura'") === "1"
  && sql("select count(*) from adjuntos a join reportes_falla r on r.id = a.registro_id where r.tipo_falla = 'temperatura'") === "1"
  && sql("select count(*) from storage.objects o join adjuntos a on a.ruta = o.name where o.bucket_id = 'adjuntos'") === sql("select count(*) from adjuntos where bucket = 'adjuntos'"));
await op.waitForSelector("text=Recibido"); prueba("y en «Mis reportes» pasa a recibido", !/Sin enviar/.test(await op.textContent(".op")));

// El técnico carga una ficha sin señal
const idRep = sql("select id from reportes_falla where tipo_falla = 'temperatura'");
await enc.goto(APP + "ordenes/nueva?reporte=" + idRep); await enc.selectOption("select[name=asignado]", { label: "Diego Ríos · Técnico" });
await enc.click("button[type=submit]:has-text('Crear')"); await enc.waitForURL(/\/ordenes\/[0-9a-f-]{36}$/);
const idOt2 = enc.url().split("/").pop();
await tec.goto(APP + "ordenes/" + idOt2); await tec.waitForSelector("a:has-text('Cargar ficha')"); await tec.waitForTimeout(1500);
await tec.context().setOffline(true);
await tec.click("a:has-text('Cargar ficha')"); await tec.fill("textarea[name=trabajo]", "Limpieza del intercambiador"); await tec.fill("input[name=horas]", "1");
await tec.click("button:has-text('Guardar ficha')");
prueba("sin señal, la ficha queda guardada", await aviso(tec, /la ficha quedó guardada en el celular/));
await tec.waitForURL(/\/ordenes\/[0-9a-f-]{36}$/);
prueba("y se ve en la orden mientras tanto", /Limpieza del intercambiador/.test(await tec.textContent("main")));
await tec.click("button:has-text('Pedir repuesto')"); await tec.waitForSelector(".ventana");
await tec.fill(".ventana input[name=descripcion]", "Junta del intercambiador"); await tec.click(".ventana button[type=submit]");
prueba("el pedido de repuesto también queda en la cola", await aviso(tec, /esperando el repuesto/));
await tec.context().setOffline(false);
prueba("al volver la señal se envía todo en orden", await esperarBarra(tec, /^Conectado$/));
prueba("la ficha y el pedido llegaron y la orden espera el repuesto", sql(`select count(*) from fichas where orden_id = '${idOt2}'`) === "1" && sql(`select estado from ordenes where id = '${idOt2}'`) === "esperando_repuesto"
  && sql(`select count(*) from pedidos_compra where orden_id = '${idOt2}'`) === "1", sql(`select estado from ordenes where id = '${idOt2}'`));
await dir.goto(APP + "compras"); await dir.waitForSelector("text=Junta del intercambiador");
await dir.context().setOffline(true);
await dir.click("td button:has-text('Aprobar')"); await dir.click(".ventana button[type=submit]");
prueba("aprobar necesita señal (depende del estado del servidor) y lo avisa", await aviso(dir, /hace falta señal/));
await dir.context().setOffline(false);

// Conflicto: el encargado edita sin señal una orden que el jefe cambió mientras tanto → gana la última
await enc.goto(APP + "ordenes/" + idOt2); await enc.waitForSelector("button:has-text('Editar / asignar')"); await enc.waitForTimeout(1500);
await enc.context().setOffline(true);
sql(`update ordenes set descripcion = 'Cambio del jefe', modificado_en = now() where id = '${idOt2}'`);
await enc.waitForTimeout(300);
await enc.click("button:has-text('Editar / asignar')"); await enc.fill(".ventana textarea[name=descripcion]", "Cambio del encargado sin señal"); await enc.click(".ventana button[type=submit]");
await enc.context().setOffline(false);
prueba("se sincroniza la edición", await esperarBarra(enc, /^Conectado$/));
prueba("gana la última modificación (la del encargado, hecha después)", sql(`select descripcion from ordenes where id = '${idOt2}'`) === "Cambio del encargado sin señal");
prueba("y el conflicto queda en el registro de cambios", sql("select count(*) from registro_cambios where operacion = 'conflicto' and tabla = 'ordenes'") === "1");

console.log(`\n${ok} correctas, ${mal} con problemas, ${errores.length} errores de página`);
await b.close();
process.exit(mal || errores.length ? 1 : 0);
