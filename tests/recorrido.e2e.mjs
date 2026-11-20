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

await dir.goto(APP + "compras"); await dir.waitForSelector("text=PC-0001");
prueba("dirección ve las compras pero no las aprueba", !(await dir.$("td button:has-text('Aprobar')")));
await jefe.goto(APP); await jefe.waitForSelector("nav a[href='/compras'] .insignia");
prueba("el jefe ve en el menú la compra por aprobar", (await jefe.textContent("nav a[href='/compras'] .insignia")) === "1");
await jefe.click("nav a[href='/compras']"); await jefe.waitForSelector("text=PC-0001");
await jefe.click("td button:has-text('Aprobar')"); await jefe.click(".ventana button[type=submit]");
prueba("el jefe aprueba el pedido", await aviso(jefe, /Pedido aprobado/));
prueba("queda registrado quién aprobó", sql("select count(*) from registro_cambios where tabla = 'pedidos_compra' and aprobo_id is not null") !== "0");
await dir.goto(APP + "ordenes/" + idOt); await dir.waitForSelector("text=El jefe la puede confirmar");
prueba("dirección ve la orden pero no cambia la prioridad", !(await dir.$("select[aria-label=Prioridad]")) && !(await dir.$("button:has-text('Confirmar urgente')")));
await jefe.goto(APP + "ordenes/" + idOt); await jefe.click("button:has-text('Confirmar urgente')");
prueba("el jefe confirma la prioridad", await aviso(jefe, /Prioridad confirmada/));
await foto(jefe, "25-jefe-orden");
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
await enc.goto(APP + "ordenes/" + idOt); await enc.click("button:has-text('Cerrar la orden')");
const [remito] = await Promise.all([enc.waitForEvent("download", { timeout: 20000 }), enc.click(".ventana button[type=submit]")]);
prueba("el encargado cierra la orden", await aviso(enc, /Orden cerrada/) && sql(`select estado from ordenes where id = '${idOt}'`) === "cerrada");
const remitoPdf = (await fs.promises.readFile(await remito.path())).toString("latin1");
prueba("al cerrar se descarga solo el remito interno de la orden", remito.suggestedFilename() === "remito-RI-0001.pdf" && remitoPdf.startsWith("%PDF"), remito.suggestedFilename());
prueba("el remito trae el número, el equipo, los trabajos, la firma y los costos", ["RI-0001", "INY-INY-001", "Cambio de sellos", "Carla M", "Total", "no v"].every((t) => remitoPdf.includes(t)) && /\/Subtype \/Image/.test(remitoPdf),
  ["RI-0001", "INY-INY-001", "Cambio de sellos", "Carla M", "Total"].filter((t) => !remitoPdf.includes(t)));
await enc.waitForSelector("button:has-text('Remito interno (PDF)')");
prueba("y se puede volver a bajar desde la orden", true);
await tec2.goto(APP + "ordenes/" + idOt); await tec2.waitForSelector("h1");
prueba("un técnico de otra empresa no ve la orden", /No existe o no tenés acceso/.test(await tec2.textContent("main")));
await op.goto(APP); await op.waitForSelector("text=Mis reportes");
prueba("el operario ve su reporte como atendido", !!(await op.waitForSelector(".op .pastilla:has-text('Atendido')", { timeout: 8000 }).catch(() => null)));

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
  await p.goto(APP + "equipos/" + id); await p.click(".encabezado button:has-text('Préstamo, reparación externa')");
  await p.click(`.ventana button.item:has-text('${opcion}')`); await p.waitForSelector(".ventana form");
};
await menuMov(jefe, idApl, "Préstamo");
await jefe.selectOption(".ventana select[name=destino]", emp.PIN); await jefe.fill(".ventana input[name=ubicacion]", "Sector envasado");
await jefe.fill(".ventana input[name=motivo]", "Pico de producción en PIN"); await jefe.click(".ventana button[type=submit]");
prueba("el préstamo que decide el jefe queda aprobado al pedirlo", await aviso(jefe, /Préstamo aprobado/));
await jefe.goto(APP); await jefe.waitForSelector("nav a[href='/movimientos'] .insignia");
prueba("el jefe ve en el menú el préstamo por despachar", (await jefe.textContent("nav a[href='/movimientos'] .insignia")) === "1");
await dir.goto(APP + "movimientos"); await dir.waitForSelector("td:has-text('LIM-APL-001')");
prueba("dirección ve los movimientos pero no aprueba ni registra nada", !(await dir.$("td button")));
await jefe.goto(APP + "movimientos"); await jefe.click("td button:has-text('Salió')"); await jefe.click(".ventana button[type=submit]");
prueba("el jefe registra la salida: el equipo figura en PIN y conserva su código", await aviso(jefe, /Salida registrada/) && ubic("LIM-APL-001") === "PIN|Sector envasado", ubic("LIM-APL-001"));
await foto(jefe, "30-movimientos");
await jefe.click("td button:has-text('Volvió')"); await jefe.click(".ventana button[type=submit]");
prueba("al volver, regresa a INY y al lugar donde estaba", await aviso(jefe, /Vuelta registrada/) && ubic("LIM-APL-001") === "INY|Depósito de producto terminado", ubic("LIM-APL-001"));

sql("insert into proveedores (nombre, rubro) values ('Bobinados Sur', 'Motores eléctricos')");
await jefe.goto(APP); await jefe.reload(); await jefe.waitForSelector("main h1");
const idCom = sql("select id from equipos where codigo = 'INY-COM-001'");
await menuMov(jefe, idCom, "Reparación externa");
await jefe.selectOption(".ventana select[name=proveedor]", { label: "Bobinados Sur · Motores eléctricos" }); await jefe.fill(".ventana input[name=presupuesto]", "250.000");
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
await jefe.goto(APP + "equipos/" + idIny); await jefe.click(".encabezado button:has-text('Reubicar')"); await jefe.waitForSelector(".ventana form"); await jefe.fill(".ventana input[name=ubicacion]", "Nave 2, línea 3"); await jefe.click(".ventana button[type=submit]");
prueba("el jefe reubica dentro de la empresa", await aviso(jefe, /Equipo reubicado/) && ubic("INY-INY-001") === "INY|Nave 2, línea 3");

await jefe.goto(APP + "equipos/" + idApl); await jefe.click(".encabezado button:has-text('Dar de baja')"); await jefe.waitForSelector(".ventana form");
await jefe.selectOption(".ventana select[name=destino]", "venta");
await jefe.fill(".ventana textarea[name=motivo]", "Bateria agotada y motor de traccion quemado: repararlo cuesta mas que uno nuevo. Se reemplaza por un apilador nuevo.");
await jefe.fill(".ventana input[name=receptor]", "Autoelevadores Oeste"); await jefe.fill(".ventana input[name=valor]", "850.000");
const [infBaja] = await Promise.all([jefe.waitForEvent("download", { timeout: 20000 }), jefe.click(".ventana button[type=submit]")]);
prueba("baja con motivo detallado, destino, quién lo retira y valor", estadoEq("LIM-APL-001") === "baja"
  && sql("select receptor || '|' || valor_recupero::int from movimientos_equipo where tipo = 'baja'") === "Autoelevadores Oeste|850000");
const bajaPdf = (await fs.promises.readFile(await infBaja.path())).toString("latin1");
const enBaja = ["LIM-APL-001", "Bateria agotada", "motor de traccion", "Autoelevadores Oeste", "850.000", "Historial de mantenimiento", "Movimientos anteriores"];
prueba("se descarga solo el informe de baja con el motivo y el historial del equipo", infBaja.suggestedFilename() === "informe-baja-LIM-APL-001.pdf" && bajaPdf.startsWith("%PDF")
  && enBaja.every((t) => bajaPdf.includes(t)), enBaja.filter((t) => !bajaPdf.includes(t)));
await jefe.goto(APP + "equipos/" + idApl); await jefe.waitForSelector(".placa .pastilla:has-text('De baja')", { timeout: 8000 }).catch(() => {});
prueba("el equipo dado de baja conserva su historial y ya no ofrece movimientos", /De baja/.test(await jefe.textContent(".placa")) && !(await jefe.$(".encabezado button:has-text('Dar de baja')")) && !(await jefe.$(".encabezado button:has-text('Préstamo')")));
await jefe.click("button[role=tab]:has-text('Movimientos')");
prueba("la ficha lista sus movimientos (préstamo y baja)", (await jefe.$$("table tbody tr")).length === 2);
prueba("la ficha muestra la baja con su motivo", /Dado de baja el/.test(await jefe.textContent("main")) && /motor de traccion quemado/.test(await jefe.textContent("main")));
prueba("y el informe de baja se puede volver a bajar desde la ficha", !!(await jefe.$("button:has-text('Informe de baja (PDF)')")));
await jefe.goto(APP + "movimientos"); await jefe.click("button[role=tab]:has-text('Historial')"); await jefe.selectOption("select[aria-label='Tipo de movimiento']", "baja");
prueba("Movimientos → Historial filtra las bajas, con su informe", (await jefe.$$("main table tbody tr")).length === 1 && !!(await jefe.$("tr:has-text('LIM-APL-001') button:has-text('Informe PDF')")));
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
await jefe.goto(APP + "compras"); await jefe.waitForSelector("text=Junta del intercambiador");
await jefe.context().setOffline(true);
await jefe.click("td button:has-text('Aprobar')"); await jefe.click(".ventana button[type=submit]");
prueba("aprobar necesita señal (depende del estado del servidor) y lo avisa", await aviso(jefe, /hace falta señal/));
await jefe.keyboard.press("Escape");
await jefe.context().setOffline(false);

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

console.log("Registro, intervenciones externas y usuarios");
await jefe.goto(APP + "registro"); await jefe.waitForSelector("main table tbody tr");
const regTxt = await jefe.textContent("main table");
prueba("el registro muestra por defecto los cambios de las órdenes, sin los ingresos", /orden OT-0001/.test(regTxt) && /cerrada/.test(regTxt) && !/Ingresó/.test(regTxt), regTxt.slice(0, 200));
await jefe.selectOption("select[aria-label='Qué']", "ingresos"); await jefe.waitForSelector("main table tbody tr:has-text('Ingresó')", { timeout: 8000 }).catch(() => {});
prueba("los ingresos siguen guardados y se ven si se piden", /Ingresó/.test(await jefe.textContent("main")));
await foto(jefe, "35-registro");
sql(`insert into fichas (orden_id, contratista_id, trabajo, horas, remito) select o.id, p.id, 'Medición de aislación del motor principal', 2, 'R-0003-0000777' from ordenes o, proveedores p where o.numero = 2 and p.nombre = 'Bobinados Sur' limit 1`);
await jefe.goto(APP); await jefe.reload(); await jefe.waitForSelector("nav a[href='/externos']"); await jefe.click("nav a[href='/externos']");
await jefe.waitForSelector("td:has-text('Medición de aislación')", { timeout: 10000 }).catch(() => {});
const extTxt = await jefe.textContent("main table");
prueba("intervenciones externas: lista la reparación externa y el trabajo del contratista", /Bobinados Sur/.test(extTxt) && /Rebobinado del motor/.test(extTxt) && /Medición de aislación/.test(extTxt) && /Volvió/.test(extTxt), extTxt.slice(0, 300));
await foto(jefe, "36-externos");
const [inf] = await Promise.all([jefe.waitForEvent("download", { timeout: 20000 }), jefe.click("tr:has-text('Rebobinado del motor') button:has-text('Informe PDF')")]);
const infPdf = (await fs.promises.readFile(await inf.path())).toString("latin1");
prueba("cada caso tiene su informe PDF (taller, salida, vuelta, costo, garantía y foto del remito)", infPdf.startsWith("%PDF") && ["INY-COM-001", "Bobinados Sur", "231.500", "R-0001-123", "14/05/2027"].every((t) => infPdf.includes(t)) && /\/Subtype \/Image/.test(infPdf),
  ["INY-COM-001", "Bobinados Sur", "231.500", "R-0001-123", "14/05/2027"].filter((t) => !infPdf.includes(t)));
const [ext] = await Promise.all([jefe.waitForEvent("download", { timeout: 20000 }), jefe.click("button:has-text('Excel')")]);
prueba("y el listado se exporta a Excel", ext.suggestedFilename().endsWith(".xlsx"));
await enc.goto(APP + "externos"); await enc.waitForSelector("h1:has-text('Intervenciones externas')");
prueba("el encargado también lo ve", /Bobinados Sur/.test(await enc.textContent("main")));
await jefe.goto(APP + "usuarios"); await jefe.waitForSelector("tr:has-text('Lucas Paz')");
await jefe.click("tr:has-text('Lucas Paz') button:has-text('Dar de baja')"); await jefe.click(".ventana button[type=submit]");
prueba("el jefe da de baja a un usuario (no puede ingresar más; el historial queda)", await aviso(jefe, /dado de baja/) && sql("select activo from usuarios where usuario = 'tecnico2'") === "f");
await jefe.click("tr:has-text('Lucas Paz') button:has-text('Reactivar')"); await jefe.click(".ventana button[type=submit]");
prueba("y lo reactiva", await aviso(jefe, /reactivado/) && sql("select activo from usuarios where usuario = 'tecnico2'") === "t");

console.log("Contratista cargado a mano, eliminar usuarios y siglas");
await jefe.goto(APP + "ordenes/nueva?equipo=" + idIny); await jefe.waitForSelector("select[name=contratista]");
await jefe.selectOption("select[name=contratista]", "__nuevo__");
await jefe.fill("input[name=contratista_nombre]", "Tornería López"); await jefe.fill("input[name=contratista_rubro]", "Tornería"); await jefe.fill("input[name=contratista_telefono]", "11 4000-2222");
await jefe.fill("input[name=titulo]", "Rectificar el eje del tornillo");
await jefe.click("button[type=submit]:has-text('Crear')"); await jefe.waitForURL(/\/ordenes\/[0-9a-f-]{36}$/);
prueba("orden asignada a un contratista escrito a mano (queda cargado como proveedor)", /Tornería López/.test(await jefe.textContent("main"))
  && sql("select p.rubro || '|' || p.telefono from ordenes o join proveedores p on p.id = o.contratista_id where o.titulo = 'Rectificar el eje del tornillo'") === "Tornería|11 4000-2222");
await jefe.goto(APP + "proveedores"); await jefe.waitForSelector("td:has-text('Tornería López')", { timeout: 8000 }).catch(() => {});
prueba("y aparece en Proveedores y contratistas", /Tornería López/.test(await jefe.textContent("main")) && /Bobinados Sur/.test(await jefe.textContent("main")));
await foto(jefe, "37-proveedores");
await jefe.goto(APP + "usuarios"); await jefe.waitForSelector("tr:has-text('Lucas Paz')");
prueba("un usuario activo no muestra «Eliminar»", !(await jefe.$("tr:has-text('Lucas Paz') button:has-text('Eliminar')")));
await jefe.click("tr:has-text('Lucas Paz') button:has-text('Dar de baja')"); await jefe.click(".ventana button[type=submit]"); await aviso(jefe, /dado de baja/);
await jefe.click("tr:has-text('Lucas Paz') button:has-text('Eliminar')"); await jefe.click(".ventana button[type=submit]");
prueba("dado de baja, el jefe lo elimina", await aviso(jefe, /Usuario eliminado/) && sql("select count(*) from usuarios where usuario = 'tecnico2' and not eliminado") === "0");
await jefe.waitForTimeout(500);
prueba("y ya no figura en la lista", !(await jefe.$("tr:has-text('Lucas Paz')")));
await jefe.goto(APP + "apariencia"); await jefe.click("button[role=tab]:has-text('Estados y empresas')");
// Cada empresa es una fila con su sigla, su nombre y «Guardar»
const filaEmp = (nombre) => jefe.locator(".fila").filter({ has: jefe.locator("button:text-is('Guardar')") }).filter({ has: jefe.locator(`input[value="${nombre}"]`) }).last();
await filaEmp("Inyectora de plásticos").waitFor();
prueba("la sigla de una empresa con equipos activos (INY) no se puede tocar", await filaEmp("Inyectora de plásticos").locator("input[maxlength='4']").isDisabled());
const sal = filaEmp("Salsas y aderezos");
await sal.locator("input[maxlength='4']").fill("SYA"); await sal.locator("button:text-is('Guardar')").click();
prueba("la de una empresa sin equipos activos (SAL → SYA) sí", await aviso(jefe, /Empresa guardada/) && sql("select count(*) from empresas where sigla = 'SYA'") === "1");
await foto(jefe, "38-siglas");
await sal.locator("input[maxlength='4']").fill("SAL"); await sal.locator("button:text-is('Guardar')").click(); await aviso(jefe, /Empresa guardada/);

console.log("Exportar datos");
await jefe.goto(APP + "exportar"); await jefe.waitForSelector("h1:has-text('Exportar datos')");
const [xl] = await Promise.all([jefe.waitForEvent("download", { timeout: 30000 }), jefe.click("button:has-text('Excel (.xlsx)')")]);
const rutaXl = await xl.path();
let leido = "";
try {
  leido = execFileSync("python3", ["-I", "-c", `
import openpyxl, sys, json
wb = openpyxl.load_workbook(open(sys.argv[1], "rb"), read_only=True)
eq = wb["Equipos"]; filas = list(eq.iter_rows(values_only=True)); cab = filas[0]
ot = list(wb["Órdenes"].iter_rows(values_only=True)); oc = ot[0]
print(json.dumps({"hojas": wb.sheetnames, "codigos": sorted(r[cab.index("codigo")] for r in filas[1:]),
  "duenas": sorted(set(r[cab.index("empresa_duena_id")] for r in filas[1:])), "equipo_ot": ot[1][oc.index("equipo_id")] if len(ot) > 1 else None,
  "asignado": [r[oc.index("asignado_a")] for r in ot[1:]]}))`, rutaXl], { encoding: "utf8" });
} catch (e) { leido = "ERROR " + String(e.stderr || e.message).split("\n").slice(-4).join(" "); }
const xj = (() => { try { return JSON.parse(leido); } catch { return {}; } })();
prueba("el Excel abre y tiene una hoja por tabla", Array.isArray(xj.hojas) && ["Equipos", "Órdenes", "Fichas de trabajo", "Registro de cambios", "Movimientos"].every((h) => xj.hojas.includes(h)), leido.slice(0, 300));
prueba("con los equipos por código y la empresa por sigla", xj.codigos?.includes("INY-INY-001") && xj.duenas?.includes("LIM") && !xj.duenas?.some((x) => /^[0-9a-f-]{36}$/.test(x)), xj.duenas);
prueba("y las órdenes con el equipo y el técnico por nombre", /^(INY|LIM|PIN|SAL)-/.test(xj.equipo_ot || "") && xj.asignado?.includes("Diego Ríos"), leido.slice(0, 300));
const [cz] = await Promise.all([jefe.waitForEvent("download", { timeout: 30000 }), jefe.click("button:has-text('CSV')")]);
const zipTxt = execFileSync("python3", ["-I", "-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print('|'.join(z.namelist())); print(z.read('Equipos.csv').decode('utf-8-sig').splitlines()[0][:80])", await cz.path()], { encoding: "utf8" });
prueba("el CSV viene en un .zip, un archivo por tabla, separado con «;»", /Equipos\.csv/.test(zipTxt) && /Órdenes\.csv/.test(zipTxt) && /;/.test(zipTxt.split("\n")[1]), zipTxt.slice(0, 200));
await op.goto(APP + "exportar"); await op.waitForSelector(".op h1");
prueba("el operario no exporta", !/exportar/.test(op.url()));

console.log("Avisos");
await tec.goto(APP); await tec.waitForSelector(".campanita");
const insignia = await tec.$(".campanita .insignia");
prueba("el técnico tiene avisos sin leer en la campanita", !!insignia && Number(await insignia.textContent()) > 0);
await tec.click(".campanita"); await tec.waitForSelector(".ventana:has-text('Avisos')");
const textoAvisos = await tec.textContent(".ventana");
prueba("ve «Máquina parada» y la orden que le asignaron", /Máquina parada: INY-INY-001/.test(textoAvisos) && /Te asignaron la OT-0001/.test(textoAvisos), textoAvisos.slice(0, 300));
await foto(tec, "50-avisos");
await tec.click(".ventana button.item:has-text('Te asignaron la OT-0001')"); await tec.waitForURL(/\/ordenes\//);
prueba("tocar un aviso lleva a la orden", /\/ordenes\/[0-9a-f-]{36}$/.test(tec.url()));
await tec.waitForTimeout(2500); await tec.reload(); await tec.waitForSelector(".campanita");
prueba("al abrirlos quedan leídos", !(await tec.$(".campanita .insignia")));
prueba("el operario no tiene campanita", !(await op.$(".campanita")));
await jefe.context().grantPermissions(["notifications"]);
await jefe.goto(APP); await jefe.waitForSelector(".campanita"); await jefe.click(".campanita");
// Según el navegador de prueba: deja pedir el permiso (y falla al registrarse en el servicio push, que no tiene)
// o ya lo trae bloqueado. En los dos casos la app tiene que explicar qué hacer.
await jefe.waitForSelector(".ventana button:has-text('Activar avisos en este celular'), .ventana .nota:has-text('bloqueadas')");
const bloqueadas = !!(await jefe.$(".ventana .nota:has-text('bloqueadas')"));
const jefeId = sql("select id from usuarios where usuario = 'jefe'");
let subOk = false;
if (bloqueadas) prueba("con las notificaciones bloqueadas, explica cómo habilitarlas", /Permitir/.test(await jefe.textContent(".ventana")));
else {
  const avisoPush = aviso(jefe, /servicio de notificaciones/);
  await jefe.click(".ventana button:has-text('Activar avisos en este celular')");
  subOk = await (async () => { for (let i = 0; i < 40; i++) { if (sql(`select count(*) from push_suscripciones where usuario_id = '${jefeId}'`) === "1") return true; await jefe.waitForTimeout(250); } return false; })();
  prueba("el jefe activa los avisos en su celular (el navegador de prueba no tiene servicio push: debe explicar por qué)", subOk || await avisoPush);
}
if (subOk) {
  await foto(jefe, "51-avisos-activos");
  await jefe.click(".encabezado ~ * , body", { position: { x: 5, y: 5 } }).catch(() => {});
  await jefe.keyboard.press("Escape");
  await jefe.click("button:has-text('Salir')"); await jefe.waitForSelector("#l-u");
  prueba("al salir de la cuenta, el celular deja de recibir sus avisos", sql(`select count(*) from push_suscripciones where usuario_id = '${jefeId}'`) === "0");
}

console.log("Editar mis datos");
const yo = await como("jefe");
await yo.goto(APP + "usuarios"); await yo.click("button:has-text('Editar mis datos')"); await yo.waitForSelector(".ventana form");
prueba("el perfil de jefe no se puede cambiar desde ahí", (await yo.$eval(".ventana input[disabled]", (x) => x.value)) === "Gerente de mantenimiento");
await yo.fill(".ventana input[name=nombre]", "Agustín Coto T."); await yo.fill(".ventana input[name=usuario]", "agustin"); await yo.fill(".ventana input[name=telefono]", "11 6000-1234");
await yo.click(".ventana button[type=submit]");
prueba("el jefe edita su nombre, teléfono y usuario de ingreso", await aviso(yo, /Tus datos se guardaron/)
  && sql("select usuario || '|' || nombre || '|' || telefono from usuarios where perfil = 'jefe'") === "agustin|Agustín Coto T.|11 6000-1234");
const yo2 = await como(null); await yo2.goto(APP); await yo2.fill("#l-u", "agustin"); await yo2.fill("#l-p", "clave-jefe"); await yo2.click("form button[type=submit]");
prueba("y entra con el usuario nuevo y la misma contraseña", !!(await yo2.waitForSelector("main h1", { timeout: 15000 }).catch(() => null)));

console.log("Fusión con W-Main: navegación, preventivos, consultas y etiquetas viejas");
const cel = await como(null, true); await cel.goto(APP); await cel.fill("#l-u", "agustin"); await cel.fill("#l-p", "clave-jefe"); await cel.click("form button[type=submit]"); await cel.waitForSelector("main h1");
prueba("celular: barra de abajo con Inicio, Órdenes, Escanear, Falla y Menú", (await cel.textContent(".nav-abajo")).replace(/\s+/g, "").startsWith("InicioÓrdenesEscanearFallaMenú") && !(await cel.isVisible(".menu")));
await cel.click(".nav-abajo button:has-text('Menú')"); await cel.waitForSelector(".cajon");
const cajonTxt = await cel.textContent(".cajon");
prueba("el Menú se abre por secciones, como W-Main", ["Día a día", "Equipos", "Consultas e informes", "Ajustes", "Usuarios y permisos", "Configuración", "Buscar fallas anteriores", "Historial de modificaciones", "¿Dónde está cada cosa?", "Gerente de mantenimiento"].every((t) => cajonTxt.includes(t)), cajonTxt.slice(0, 300));
await foto(cel, "60-menu-celular");
await cel.click(".cajon a:has-text('Preventivos')"); await cel.waitForSelector("h1:has-text('Preventivos')");
prueba("tocar una opción cierra el menú y abre la pantalla", !(await cel.$(".cajon")));
await cel.click(".nav-abajo a:has-text('Escanear')"); await cel.waitForSelector("h1:has-text('Escanear QR / NFC')");
prueba("el botón Escanear abre el lector", true);
await foto(cel, "61-escanear");

await yo2.goto(APP + "preventivos"); await yo2.waitForSelector("h1:has-text('Preventivos')");
await yo2.click("button:has-text('Tarea')"); await yo2.waitForSelector(".ventana form");
await yo2.selectOption(".ventana select[aria-label=Equipo]", idCom);
await yo2.fill(".ventana input[name=titulo]", "Cambio de filtro de aire"); await yo2.fill(".ventana input[name=frecuencia]", "1");
const haceDosMeses = new Date(Date.now() - 62 * 864e5).toISOString().slice(0, 10);
await yo2.fill(".ventana input[name=ultima_fecha]", haceDosMeses); await yo2.click(".ventana button[type=submit]");
prueba("el jefe carga una tarea preventiva mensual", await aviso(yo2, /Tarea agregada/));
await yo2.waitForSelector(".kpi-vencida .v:text-is('1')", { timeout: 8000 }).catch(() => {});
prueba("hecha hace dos meses: figura vencida en las tarjetas", (await yo2.textContent(".kpi-vencida .v")) === "1");
await foto(yo2, "62-preventivos");
await yo2.click(".tarea-prev button:has-text('Generar orden')"); await yo2.waitForURL(/\/ordenes\/[0-9a-f-]{36}$/);
const otPrev = yo2.url().split("/").pop();
prueba("«Generar orden» crea la orden preventiva", sql(`select tipo || '|' || titulo from ordenes where id = '${otPrev}'`) === "preventiva|Preventivo: Cambio de filtro de aire");
sql(`select public._transicion(); update ordenes set estado = 'terminada', terminada_en = now() where id = '${otPrev}';`);
prueba("al terminar la orden, la tarea queda al día", sql("select ultima_fecha = current_date from preventivos where titulo = 'Cambio de filtro de aire'") === "t");
await yo2.goto(APP + "equipos/" + idCom); await yo2.click("button[role=tab]:has-text('Preventivos')");
await yo2.waitForSelector("text=Al día", { timeout: 8000 }).catch(() => {});
prueba("la ficha del equipo muestra sus preventivos", /Cambio de filtro de aire/.test(await yo2.textContent("main")) && /Al día/.test(await yo2.textContent("main")));

await yo2.goto(APP + "fallas"); await yo2.fill("input[type=search]", "aceite");
prueba("Buscar fallas anteriores encuentra la de aceite y qué se hizo", /INY-INY-001/.test(await yo2.textContent("main")) && /Cambio de sellos/.test(await yo2.textContent("main")));
await foto(yo2, "63-buscar-fallas");
await yo2.goto(APP + "intervenciones"); await yo2.waitForSelector("main table tbody tr");
prueba("Historial de intervenciones lista las fichas", /Desarme del cilindro/.test(await yo2.textContent("main table")));
await yo2.goto(APP + "informe"); await yo2.waitForSelector("h1:has-text('Informe mensual')");
prueba("Informe mensual con sus indicadores", /Órdenes terminadas/.test(await yo2.textContent("main")) && /Gasto por empresa/.test(await yo2.textContent("main")));
await foto(yo2, "64-informe");
await yo2.goto(APP + "resumen"); await yo2.waitForSelector("h1:has-text('Resumen para Dirección')");
prueba("Resumen para Dirección", /Lo más urgente/.test(await yo2.textContent("main")));
await yo2.goto(APP + "manuales"); await yo2.waitForSelector("h1:has-text('Manuales')");
prueba("Manuales reúne los documentos de todos los equipos", /Manual de operación/.test(await yo2.textContent("main")));
await yo2.goto(APP + "ayuda"); await yo2.waitForSelector("h1:has-text('¿Dónde está cada cosa?')");
prueba("«¿Dónde está cada cosa?»", (await yo2.$$("details.ayuda")).length >= 8);
await yo2.goto(APP + "#INY-INY-001"); await yo2.waitForURL(/\/equipos\/[0-9a-f-]{36}/, { timeout: 15000 }).catch(() => {});
prueba("una etiqueta vieja de W-Main (dirección#código) abre el equipo en la app nueva", yo2.url().endsWith("/equipos/" + idIny), yo2.url());

console.log(`\n${ok} correctas, ${mal} con problemas, ${errores.length} errores de página`);
await b.close();
process.exit(mal || errores.length ? 1 : 0);
