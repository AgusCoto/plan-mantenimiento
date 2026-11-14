// Prueba de la función «avisos» (supabase/functions/avisos) corriendo en Node contra un Supabase local:
// usa el mismo código, con un servidor de notificaciones de prueba que registra lo que recibe.
// Correr después de permisos.test.mjs (usa los usuarios y avisos que deja esa prueba):
//   SUPABASE_URL=… SERVICE_ROLE_KEY=… DB_URL=… node --experimental-strip-types supabase/tests/funcion-avisos.test.mjs
import fs from "node:fs";
import https from "node:https";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DB = process.env.DB_URL, URL_SB = process.env.SUPABASE_URL, SERVICE = process.env.SERVICE_ROLE_KEY;
const sql = (q) => execFileSync("psql", [DB, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
let ok = 0, mal = 0;
const prueba = (n, c, x) => { if (c) { ok++; console.log("  ✓ " + n); } else { mal++; console.log("  ✗ " + n + (x !== undefined ? "  → " + JSON.stringify(x).slice(0, 300) : "")); } };

// Servidor de notificaciones de prueba (HTTPS con certificado propio, solo para esta prueba)
const dir = fs.mkdtempSync("/tmp/push-prueba-");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", dir + "/k.pem", "-out", dir + "/c.pem", "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const recibidos = [];
const srv = https.createServer({ key: fs.readFileSync(dir + "/k.pem"), cert: fs.readFileSync(dir + "/c.pem") }, (req, res) => {
  let n = 0; req.on("data", (c) => (n += c.length));
  req.on("end", () => { recibidos.push({ path: req.url, headers: req.headers, bytes: n }); res.statusCode = req.url.startsWith("/ya-no-existe") ? 410 : 201; res.end(); });
}).listen(8443);
const claves = () => { const e = crypto.createECDH("prime256v1"); e.generateKeys(); return { p256dh: e.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") }; };

// El jefe tiene un celular activo y dirección uno que ya no existe
const jefe = sql("select id from usuarios where usuario = 'jefe'"), dire = sql("select id from usuarios where usuario = 'direccion'");
sql("delete from push_suscripciones");
for (const [u, ruta] of [[jefe, "/celular-jefe"], [dire, "/ya-no-existe"]]) { const k = claves(); sql(`insert into push_suscripciones (usuario_id, endpoint, p256dh, auth) values ('${u}', 'https://127.0.0.1:8443${ruta}', '${k.p256dh}', '${k.auth}')`); }
sql("update avisos set enviado_en = null, intentos = 0, tomado_en = null, error = null");
const pendientesJefe = Number(sql(`select count(*) from avisos where usuario_id = '${jefe}'`));
const total = Number(sql("select count(*) from avisos"));

// Mismo código de la función, con Deno simulado
const vapid = (await import("web-push")).default.generateVAPIDKeys();
const env = { SUPABASE_URL: URL_SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "https://mantenimiento.ejemplo" };
let manejador;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { manejador = h; } };
const fuente = fs.readFileSync(new globalThis.URL("../functions/avisos/index.ts", import.meta.url), "utf8")
  .replace('"npm:@supabase/supabase-js@2.49.4"', '"@supabase/supabase-js"').replace('"npm:web-push@3.6.7"', '"web-push"');
const tmp = new globalThis.URL("./.funcion-avisos.tmp.ts", import.meta.url);
fs.writeFileSync(tmp, fuente);
try { await import(tmp.href); } finally { fs.unlinkSync(tmp); }

console.log("Función de envío de avisos");
let r = await manejador(new Request("http://x/avisos", { method: "POST", body: "{}" }));
const res = await r.json();
prueba("responde con el resumen del envío", r.status === 200 && res.enviados === pendientesJefe, res);
const alJefe = recibidos.filter((x) => x.path === "/celular-jefe");
prueba("cada aviso del jefe llegó a su celular", alJefe.length === pendientesJefe, { recibidos: alJefe.length, pendientesJefe });
prueba("cifrado (aes128gcm) y firmado con VAPID", alJefe.every((x) => x.headers["content-encoding"] === "aes128gcm" && /^vapid t=.+, k=/.test(x.headers.authorization || "") && x.bytes > 0), alJefe[0]?.headers);
prueba("la máquina parada sale con urgencia alta", alJefe.some((x) => x.headers.urgency === "high"));
prueba("el celular que ya no existe (410) se borra", sql(`select count(*) from push_suscripciones where usuario_id = '${dire}'`) === "0");
prueba("los avisos del jefe quedan enviados", sql(`select count(*) from avisos where usuario_id = '${jefe}' and enviado_en is not null`) === String(pendientesJefe));
prueba("los de quien no activó los avisos quedan en la app, con el motivo", Number(sql("select count(*) from avisos where error like 'El usuario no activó%'")) > 0);
prueba("ninguno queda tomado a medias", sql("select count(*) from avisos where tomado_en is not null") === "0");
const antes = recibidos.length;
r = await manejador(new Request("http://x/avisos", { method: "POST", body: "{}" }));
prueba("llamarla de nuevo no manda nada dos veces", (await r.json()).enviados === 0 && recibidos.length === antes);
prueba("lo fallido se reintenta hasta 5 veces como mucho", Number(sql("select max(intentos) from avisos")) <= 5 && total > 0);
// La base llama a la función apenas se crea un aviso (pg_net)
sql("insert into servidor values ('url_funcion_avisos', 'http://127.0.0.1:9/functions/v1/avisos'), ('clave_publica', 'clave') on conflict (clave) do update set valor = excluded.valor");
const llamadas = () => Number(sql("select last_value + (case when is_called then 1 else 0 end) from net.http_request_queue_id_seq"));
const n0 = llamadas();
sql(`insert into avisos (usuario_id, tipo, titulo) values ('${jefe}', 'prueba', 'Prueba')`);
prueba("al crearse un aviso, la base llama a la función de envío", llamadas() === n0 + 1, { antes: n0, despues: llamadas() });
sql("delete from servidor");
srv.close(); fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${ok} correctas, ${mal} con problemas`);
process.exit(mal ? 1 : 0);
