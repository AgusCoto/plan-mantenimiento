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

console.log(`\n${ok} correctas, ${mal} con problemas, ${errores.length} errores de página`);
await b.close();
process.exit(mal || errores.length ? 1 : 0);
