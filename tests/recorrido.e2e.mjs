// Recorrido completo en un navegador real contra un Supabase local con las migraciones aplicadas
// y las cuentas de prueba creadas (ver README, "Pruebas").
//   APP_URL=http://localhost:4173/ node tests/recorrido.e2e.mjs [carpeta-capturas]
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP_URL || "http://localhost:4173/";
const CAP = process.argv[2] || null;
let ok = 0, mal = 0;
const prueba = (n, c, x) => { if (c) { ok++; console.log("  ✓ " + n); } else { mal++; console.log("  ✗ " + n + (x ? "  → " + String(x).slice(0, 200) : "")); } };
const b = await chromium.launch();
const errores = [];
async function pagina(movil) {
  const ctx = await b.newContext(movil ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true } : { viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { errores.push(e.message); console.log("  PAGEERROR " + e.message); });
  await p.route("https://fonts.googleapis.com/**", (r) => r.abort());
  return p;
}
const foto = async (p, n) => { if (CAP) await p.screenshot({ path: `${CAP}/${n}.png`, fullPage: false }); };
async function entrar(p, url, u, clave) {
  await p.goto(url);
  await p.fill("#l-u", u); await p.fill("#l-p", clave); await p.click("form button[type=submit]");
}
/** Espera un aviso que diga lo indicado (los avisos anteriores pueden seguir en pantalla). */
async function aviso(p, re) {
  const fin = Date.now() + 8000;
  while (Date.now() < fin) {
    const t = await p.evaluate(() => [...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" | ")).catch(() => "");
    if (re.test(t)) return true;
    await p.waitForTimeout(150);
  }
  return false;
}

console.log("Gestión · gerente de mantenimiento");
const gm = await pagina(false);
await gm.goto(APP); await foto(gm, "01-ingreso-gestion");
await entrar(gm, APP, "operario", "clave-operario");
await gm.waitForSelector("#l-err");
prueba("una cuenta de operario no entra a Gestión", /operario/.test(await gm.textContent("#l-err")), await gm.textContent("#l-err"));
await entrar(gm, APP, "gerente", "mala-clave");
await gm.waitForSelector("#l-err");
prueba("contraseña equivocada", /incorrectos/.test(await gm.textContent("#l-err")));
await entrar(gm, APP, "gerente", "clave-gerente");
await gm.waitForSelector("h1:has-text('Tablero de mantenimiento')");
prueba("ingresa y ve el tablero", true);
prueba("no le pide el código porque ya lo tiene", !(await gm.$("text=Todavía no definiste tu")));
await gm.click("a[href='#equipos']"); await gm.click("text=Nuevo equipo");
await gm.selectOption("#m-empresa", "INY"); await gm.selectOption("#m-area", "PRO"); await gm.selectOption("#m-tipo", "INY");
await gm.fill("#m-nombre", "Inyectora 280 t línea bidones"); await gm.fill("#m-marca", "Haitian"); await gm.fill("#m-ubic", "Nave 1");
await gm.fill("#m-cod", "0000"); await gm.click(".modal button[type=submit]");
prueba("con un código equivocado no da de alta", await aviso(gm, /no corresponde/));
await gm.fill("#m-cod", "1234"); await gm.click(".modal button[type=submit]");
await gm.waitForSelector("h1:has-text('Inyectora 280 t')");
prueba("alta con código → ficha del equipo INY-PRO-INY-001", gm.url().endsWith("#eq-INY-PRO-INY-001"));
await gm.waitForSelector(".qr img");
prueba("muestra el QR", true);
const [dl] = await Promise.all([gm.waitForEvent("download"), gm.click("text=Descargar etiqueta")]);
prueba("descarga la etiqueta PNG", dl.suggestedFilename() === "etiqueta-INY-PRO-INY-001.png");
prueba("el historial muestra el alta y quién autorizó", /Alta del equipo · Martín Gerente \(autorizó Martín Gerente\)/.test(await gm.textContent(".timeline")));
await foto(gm, "02-ficha-equipo");

console.log("Operarios · reporte desde el QR");
const op = await pagina(true);
await op.goto(APP + "operarios/?equipo=INY-PRO-INY-001");
await op.waitForSelector("#l-u");
prueba("el QR abre la app de operarios y avisa el equipo", /INY-PRO-INY-001/.test(await op.textContent(".start")));
await foto(op, "03-ingreso-operarios");
await op.fill("#l-u", "operario"); await op.fill("#l-p", "clave-operario"); await op.click("form button[type=submit]");
await op.waitForSelector("#r-eq");
prueba("abre el reporte con la máquina elegida", (await op.inputValue("#r-eq")) === "INY-PRO-INY-001");
await op.click("label:has-text('Ruido')"); await op.click("label:has-text('No, está detenida')");
await op.fill("#r-desc", "Golpeteo del lado del motor desde el arranque del turno");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
await op.setInputFiles("#r-files", [{ name: "foto.png", mimeType: "image/png", buffer: png }, { name: "IMG_0001.MOV", mimeType: "video/quicktime", buffer: Buffer.alloc(2048, 1) }]);
await op.waitForFunction(() => !document.querySelector("#r-send")?.hasAttribute("disabled"), null, { timeout: 15000 });
prueba("sube la foto y el video MOV del iPhone", (await op.$$("#r-media img")).length === 1 && (await op.$$("#r-media video")).length === 1, await op.textContent("#r-media"));
await foto(op, "04-reporte-operario");
await op.click("#r-send");
prueba("envía el reporte", await aviso(op, /enviado/));
await op.click("a[href='#prod']");
await op.fill("#m-cant", "1200"); await op.click("form button[type=submit]");
prueba("carga producción", await aviso(op, /Guardado/));
await op.click("a[href='#mis']");
const dos = await op.waitForFunction(() => document.querySelectorAll(".op .item").length === 2, null, { timeout: 8000 }).then(() => true, () => false);
prueba("ve sus cargas (reporte y producción)", dos, await op.textContent(".op"));
await op.goto(APP + "operarios/");
await foto(op, "05-inicio-operarios");

console.log("Gestión · reporte → orden → ficha → cierre");
await gm.goto(APP + "#reportes"); await gm.reload();
await gm.waitForSelector("text=Golpeteo del lado del motor");
await gm.waitForSelector("section.panel .media img");
prueba("el gerente ve el reporte con la foto y el video", (await gm.$$("section.panel .media video")).length === 1);
await foto(gm, "06-reportes");
await gm.click("text=Generar orden de trabajo");
prueba("la orden desde un reporte con máquina detenida viene con prioridad alta", (await gm.inputValue("#m-prioridad")) === "alta");
await gm.check("#m-parar"); await gm.fill("#m-asig", "Tomás Técnico");
await gm.click(".modal button[type=submit]");
await gm.waitForSelector("h1:has-text('OT-0001')");
prueba("crea la OT-0001", true);
const otUrl = gm.url();
const tec = await pagina(false);
await entrar(tec, APP, "tecnico", "clave-tecnico");
await tec.waitForSelector("h1:has-text('Órdenes de trabajo')");
prueba("el técnico entra a Órdenes y no ve Usuarios", !(await tec.$("a[href='#usuarios']")));
await tec.goto(otUrl); await tec.waitForSelector("text=Completar ficha de trabajo");
prueba("el técnico no ve Editar ni Cerrar", !(await tec.$("button:has-text('Cerrar orden')")));
await tec.click("text=Completar ficha de trabajo");
await tec.fill("#f-trab", "Cambio de rodamientos del motor"); await tec.fill("#f-h", "2.5"); await tec.fill("#f-p", "3");
await tec.click("label:has-text('Trabajo terminado')"); await tec.click(".modal button[type=submit]");
prueba("carga la ficha y la orden pasa a revisión", await aviso(tec, /revisión/));
await gm.reload(); await gm.waitForSelector("text=Cambio de rodamientos del motor");
await gm.click("text=Cerrar orden"); await gm.click(".modal button[type=submit]");
prueba("el gerente cierra la orden", await aviso(gm, /cerrada/));
await gm.goto(APP + "#eq-INY-PRO-INY-001"); await gm.waitForSelector(".plate");
prueba("el equipo vuelve a operativo", /Operativo/.test(await gm.textContent(".plate")));

console.log("Producción, administración y dirección");
const gp = await pagina(false);
await entrar(gp, APP, "produccion", "clave-produccion");
await gp.waitForSelector("h1:has-text('Tablero de producción')");
await gp.click("a[href='#registros']"); await gp.click("button:has-text('Observar')");
await gp.fill("#m-nota", "El parte del turno dice 1150"); await gp.click(".modal button[type=submit]");
prueba("producción observa el registro", await aviso(gp, /observado/));
const adm = await pagina(false);
await entrar(adm, APP, "admin", "clave-admin");
await adm.waitForSelector("h1:has-text('Listados administrativos')");
const [csv] = await Promise.all([adm.waitForEvent("download"), adm.click("text=Exportar CSV")]);
const txt = fs.readFileSync(await csv.path(), "utf8");
prueba("administración exporta el CSV", txt.includes("Bidón 5 L") && txt.includes("Observado"));
const dir = await pagina(false);
await entrar(dir, APP, "direccion", "clave-direccion");
await dir.waitForSelector("h1:has-text('Resumen para dirección')");
await foto(dir, "07-resumen-direccion");
await dir.click("a[href='#empresas']"); await dir.click("tr:has-text('PIN') button");
await dir.fill("#m-new", "Pinturas del Sur"); await dir.fill("#m-cod", "1234"); await dir.click(".modal button[type=submit]");
prueba("Dirección no puede usar el código de otro", await aviso(dir, /no es correcto/));
await dir.fill("#m-cod", "4321"); await dir.click(".modal button[type=submit]");
await dir.waitForSelector("text=Pinturas del Sur");
prueba("Dirección renombra con su código", true);
await dir.click("a[href='#informe']");
const [inf] = await Promise.all([dir.waitForEvent("download"), dir.click("text=Descargar informe")]);
prueba("descarga el informe semanal", fs.readFileSync(await inf.path(), "utf8").includes("Cambio de rodamientos del motor"));
await dir.click("a[href='#registro']"); await dir.waitForSelector("td:has-text('Ingresó')");
const reg = await dir.textContent("main table");
prueba("el registro de cambios muestra quién hizo cada cosa", /Dio de alta el equipo INY-PRO-INY-001/.test(reg) && /Autorizado con el código de Martín Gerente/.test(reg) && /Cambió el nombre de la empresa PIN/.test(reg) && /Envió el reporte/.test(reg) && /Cerró la OT-0001/.test(reg), reg.slice(0, 400));
await foto(dir, "08-registro-cambios");
await dir.click("a[href='#usuarios']"); await dir.click("text=Nueva cuenta");
await dir.fill("#u-n", "Nora Nueva"); await dir.fill("#u-u", "nora"); await dir.selectOption("#u-r", "op");
await dir.selectOption("#u-e", "SAL"); await dir.fill("#u-p", "clave-nora1");
await dir.click(".modal button[type=submit]");
prueba("Dirección crea una cuenta de operario", await aviso(dir, /Cuenta creada/));
await dir.click("tr:has-text('Nora Nueva') button:has-text('Desactivar')"); await dir.click(".modal button[type=submit]");
await dir.waitForSelector("tr:has-text('Nora Nueva') .pill:has-text('Desactivada')");
const op2 = await pagina(true);
await entrar(op2, APP + "operarios/", "nora", "clave-nora1");
await op2.waitForSelector("#l-err");
prueba("la cuenta desactivada no ingresa", /desactivada/.test(await op2.textContent("#l-err")));

console.log("QR escaneado por alguien de Gestión");
await gm.goto(APP + "operarios/?equipo=INY-PRO-INY-001");
await gm.waitForURL(/#eq-INY-PRO-INY-001/, { timeout: 8000 }).catch(() => {});
prueba("con sesión de Gestión el QR abre la ficha del equipo", /#eq-INY-PRO-INY-001$/.test(gm.url()), gm.url());

console.log(`\n${ok} correctas, ${mal} con problemas, ${errores.length} errores de página`);
await b.close();
process.exit(mal || errores.length ? 1 : 0);
