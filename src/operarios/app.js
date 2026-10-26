// W-Main Operarios: app aparte para que los operarios avisen anomalías de las máquinas.
// No usa cuentas: el operario entra con el código de su planta y su nombre, y solo puede
// llamar a tres funciones de la base (operario_ingresar, reportar_anomalia, estado_avisos_operario).
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const leer = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (_) { return d; } };
  const guardar = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const ico = (body) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  const ICONOS = {
    qr: ico('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>'),
    nfc: ico('<path d="M6 8.5a6 6 0 0 1 0 7"/><path d="M9.5 6a10 10 0 0 1 0 12"/><path d="M13 3.5a14 14 0 0 1 0 17"/>'),
    lista: ico('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
    foto: ico('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    mic: ico('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
    stop: ico('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    ok: ico('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  };
  const SINTOMAS = ["Ruido extraño", "Vibración", "Olor raro / a quemado", "Humo", "Chispas", "Pérdida de aceite", "Pérdida de agua o aire", "Recalentamiento", "No arranca o se detiene", "Funciona mal o lento", "Pieza suelta o rota", "Otro"];
  const FUNC = [["normal", "Funciona normal", "#2E9E5B"], ["limitado", "Funciona con problemas", "#E0A100"], ["parado", "Está parada", "#D93025"]];
  const MAX_FOTOS = 3, AUDIO_SEG = 20;

  // ---------- conexión (solo la clave pública; los permisos los controla la base) ----------
  const cfgLocal = leer("pm-config", {}) || {};
  const AC = window.APP_CONFIG || {};
  const URL_DB = String(AC.supabaseUrl || cfgLocal.supabaseUrl || "").trim().replace(/\/+$/, "");
  const KEY = String(AC.supabaseAnonKey || cfgLocal.supabaseAnonKey || "").trim();
  const sb = URL_DB && KEY && window.supabase ? window.supabase.createClient(URL_DB, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;

  let OP = null;   // {codigo, nombre, empresa, empresaNombre, equipos, cfg}
  let scan = null; // cámara abierta
  const app = $("#app");
  app.addEventListener("change", () => { const e = $("#e"); if (e) e.textContent = ""; });

  function pintar(html) {
    pararCamara();
    app.innerHTML = '<header class="top"><img src="iconos/icono.svg" alt=""><div class="t"><b>W-Main Operarios</b><span>' +
      (OP ? esc(OP.nombre + " · " + (OP.empresaNombre || OP.empresa)) : "Avisos de anomalías para mantenimiento") + "</span></div></header>" + html;
    window.scrollTo(0, 0);
  }
  function toast(msg) {
    const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  }
  const msgError = (e) => {
    const m = String((e && e.message) || e || "").replace(/^.*?ERROR:\s*/, "");
    return /Failed to fetch|NetworkError|Load failed|network/i.test(m) ? "Sin conexión. Revisá internet y probá de nuevo." : m || "No se pudo completar. Probá de nuevo.";
  };
  async function rpc(fn, args) {
    if (!sb) throw new Error("La app no está conectada a la base de mantenimiento.");
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    return data;
  }

  // ---------- nombres de empresa / sector / tipo (los mismos que usa W-Main) ----------
  const CAT = window.PM_CAT;
  const areaNom = (c) => ((CAT.areas(OP && OP.cfg).find((a) => a[0] === c) || [])[1]) || c || "";
  const tipoNom = (c) => (((CAT.tipos(OP && OP.cfg).find((t) => t[0] === c) || [])[1]) || {}).d || c || "";

  // ---------- etiqueta del equipo (QR / NFC / link) ----------
  function tokenDe(raw) {
    let t = String(raw || "").trim();
    if (/#conectar=/.test(t)) return "";
    if (t.includes("#")) t = t.split("#").pop();
    try { t = decodeURIComponent(t); } catch (_) {}
    return t.length < 60 ? t : "";
  }
  function equipoDe(tok) {
    if (!tok || !OP) return null;
    const T = tok.toUpperCase();
    return OP.equipos.find((e) => String(e.idActivo || "").toUpperCase() === T || String(e.codigo || "").toUpperCase() === T || e.id === tok) ||
      OP.equipos.find((e) => (e.codigosAnteriores || []).some((c) => String(c).toUpperCase() === T)) || null;
  }
  const limpiarHash = () => { try { history.replaceState(null, "", location.pathname + location.search); } catch (_) {} };

  // ---------- ingreso ----------
  function pantallaIngreso(err) {
    const mem = leer("pm-operario", null);
    if (!sb) {
      pintar('<div class="card"><h1>Falta la conexión</h1><p>Esta app tiene que abrirse desde la dirección que da mantenimiento (el QR del cartel). Pedile el link a tu supervisor.</p></div>');
      return;
    }
    pintar('<form class="card" id="f-in" novalidate><h1>Avisá a mantenimiento</h1><p>Si ves, escuchás u olés algo raro en una máquina, reportalo desde acá. Ingresá el código de tu planta (te lo da tu supervisor) y tu nombre. Quedan guardados en este celular.</p>' +
      '<label class="f">Código de planta<input id="in-c" class="code-in" inputmode="numeric" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>' +
      '<label class="f">Tu nombre y apellido<input id="in-n" autocomplete="name" value="' + esc((mem && mem.nombre) || "") + '"></label>' +
      '<div class="err" id="in-e">' + esc(err || "") + '</div><button class="btn big red" type="submit">Entrar</button></form>');
    $("#f-in").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const c = $("#in-c").value.trim(), n = $("#in-n").value.trim().replace(/\s+/g, " ");
      if (!c || n.length < 2) { $("#in-e").textContent = "Completá el código y tu nombre."; return; }
      const b = $("#f-in button[type=submit]"); b.disabled = true; b.textContent = "Verificando…";
      try { await ingresar(c, n); }
      catch (e) { b.disabled = false; b.textContent = "Entrar"; $("#in-e").textContent = msgError(e); }
    });
  }
  async function ingresar(codigo, nombre) {
    const r = await rpc("operario_ingresar", { p_codigo: codigo });
    guardar("pm-operario", { codigo, nombre });
    OP = { codigo, nombre, empresa: r.empresa, cfg: r.config || null, equipos: r.equipos || [] };
    OP.empresaNombre = CAT.empresas(OP.cfg)[OP.empresa] || OP.empresa;
    const tok = tokenDe(location.hash);
    limpiarHash();
    if (tok) { const e = equipoDe(tok); if (e) return formulario(e); inicio("La etiqueta escaneada no es de un equipo de tu planta."); return; }
    inicio();
  }

  // ---------- inicio ----------
  function inicio(aviso) {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const nfc = "NDEFReader" in window;
    pintar((aviso ? '<div class="banner">' + esc(aviso) + "</div>" : "") +
      '<section class="card"><h1>¿Qué máquina tiene un problema?</h1><p class="hint">Escaneá la etiqueta del equipo o buscalo en la lista.</p><div class="acciones">' +
      '<button class="btn big red" id="b-qr">' + ICONOS.qr + "Escanear el QR del equipo</button>" +
      (nfc ? '<button class="btn big" id="b-nfc">' + ICONOS.nfc + "Leer la etiqueta NFC</button>" : "") +
      '<button class="btn big" id="b-lista">' + ICONOS.lista + "Buscar el equipo en la lista</button></div>" +
      (!nfc && ios ? '<p class="hint">Etiqueta NFC en iPhone: con la pantalla desbloqueada, acercá la parte de arriba del iPhone a la etiqueta y tocá el aviso que aparece.</p>' : "") +
      '<div id="cam-box"></div></section>' +
      '<section class="card"><h2>Mis avisos</h2><div class="lista" id="mis"></div></section>' +
      '<p class="pie"><button class="btn link" id="b-salir">Cambiar de operario o de planta</button></p>');
    $("#b-qr").addEventListener("click", abrirCamara);
    if ($("#b-nfc")) $("#b-nfc").addEventListener("click", leerNFC);
    $("#b-lista").addEventListener("click", () => formulario(null));
    $("#b-salir").addEventListener("click", () => { guardar("pm-operario", null); OP = null; pantallaIngreso(); });
    misAvisos();
  }
  function equipoEncontrado(raw) {
    const tok = tokenDe(raw);
    const e = equipoDe(tok);
    if (!e) { toast(tok ? "Ese código no es de un equipo de tu planta." : "No es la etiqueta de un equipo."); return false; }
    if (navigator.vibrate) try { navigator.vibrate(80); } catch (_) {}
    formulario(e);
    return true;
  }
  async function abrirCamara() {
    const box = $("#cam-box");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast("Este celular no permite usar la cámara desde la app."); return; }
    box.innerHTML = '<div class="cam"><video playsinline muted></video><div class="frame"></div></div><p class="hint" style="text-align:center">Apuntá al código QR de la etiqueta.</p><button class="btn big" id="b-cancel">Cancelar</button>';
    $("#b-cancel").addEventListener("click", () => { pararCamara(); box.innerHTML = ""; });
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); }
    catch (_) { box.innerHTML = '<div class="banner">No se pudo abrir la cámara. Permití el acceso a la cámara para esta app.</div>'; return; }
    const v = $("video", box); v.srcObject = stream; await v.play().catch(() => {});
    const c = document.createElement("canvas"), ctx = c.getContext("2d", { willReadFrequently: true });
    scan = { stream, raf: 0 };
    const tick = () => {
      if (!scan) return;
      if (v.readyState >= 2 && v.videoWidth) {
        const w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
        c.width = w; c.height = h; ctx.drawImage(v, 0, 0, w, h);
        const r = window.jsQR && window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
        if (r && r.data && equipoEncontrado(r.data)) return;
      }
      scan.raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function pararCamara() { if (scan) { cancelAnimationFrame(scan.raf); scan.stream.getTracks().forEach((t) => t.stop()); scan = null; } }
  async function leerNFC() {
    try {
      const r = new window.NDEFReader(); await r.scan(); toast("Acercá el celular a la etiqueta…");
      r.onreading = (ev) => {
        for (const rec of ev.message.records) {
          if (["url", "absolute-url", "text"].includes(rec.recordType) && equipoEncontrado(new TextDecoder().decode(rec.data))) return;
        }
        toast("La etiqueta no tiene un código de equipo.");
      };
      r.onreadingerror = () => toast("No se pudo leer la etiqueta. Probá de nuevo.");
    } catch (x) { toast(x && x.name === "NotAllowedError" ? "Hay que permitir el uso de NFC." : "No se pudo activar NFC: revisá que esté encendido."); }
  }

  // ---------- mis avisos (se guardan en el celular; el estado se consulta a la base) ----------
  const ESTADOS = {
    Nuevo: ["Recibido, esperando revisión", "nuevo"],
    Descartado: ["Revisado: no hace falta reparar", ""],
  };
  function estadoAviso(s) {
    if (!s) return ["Enviado", "nuevo"];
    if (ESTADOS[s.estado]) return ESTADOS[s.estado];
    if (s.orden === "Cerrada") return ["Resuelto", "ok"];
    if (s.orden === "Anulada") return ["Revisado: no hace falta reparar", ""];
    if (s.orden === "En curso") return ["En reparación", "curso"];
    if (s.orden === "Esperando repuesto") return ["En reparación: esperando repuesto", "curso"];
    return ["Mantenimiento lo tiene en agenda", "curso"];
  }
  async function misAvisos() {
    const box = $("#mis"); if (!box) return;
    const l = (leer("pm-op-avisos", []) || []).filter((a) => a.empresa === OP.empresa);
    if (!l.length) { box.innerHTML = '<p class="hint">Todavía no enviaste avisos desde este celular.</p>'; return; }
    const fila = (a, s) => { const [t, c] = estadoAviso(s); return '<div class="av"><div class="l1"><span class="n">' + esc(a.num) + '</span><span class="st ' + c + '">' + esc(t) + "</span></div><b>" + esc(a.equipo) + '</b><span class="hint">' + esc(new Date(a.fecha).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })) + (a.resumen ? " · " + esc(a.resumen) : "") + "</span></div>"; };
    box.innerHTML = l.map((a) => fila(a, null)).join("");
    try {
      const st = await rpc("estado_avisos_operario", { p_codigo: OP.codigo, p_numeros: l.map((a) => a.numero) });
      const m = new Map((st || []).map((s) => [s.numero, s]));
      if ($("#mis") === box) box.innerHTML = l.map((a) => fila(a, m.get(a.numero))).join("");
    } catch (_) { /* sin conexión: se muestra lo guardado */ }
  }
  function recordarAviso(num, e, sint) {
    const l = leer("pm-op-avisos", []) || [];
    l.unshift({ num, numero: parseInt(String(num).replace(/\D/g, ""), 10), empresa: OP.empresa, equipo: e.codigo + " · " + e.nombre, fecha: new Date().toISOString(), resumen: sint.slice(0, 3).join(", ") });
    guardar("pm-op-avisos", l.slice(0, 30));
  }

  // ---------- formulario del aviso ----------
  function formulario(eq) {
    const eqs = OP.equipos;
    const sectores = [...new Set(eqs.map((e) => e.area))].sort((a, b) => areaNom(a).localeCompare(areaNom(b)));
    const bloqueEquipo = eq
      ? '<section class="card eq"><span class="hint">Equipo</span><span class="cod">' + esc(eq.codigo) + "</span><b>" + esc(eq.nombre) + '</b><span class="hint">' + esc([OP.empresaNombre, areaNom(eq.area), eq.ubicacion].filter(Boolean).join(" · ")) + '</span><button class="btn link" type="button" id="b-otro" style="align-self:flex-start;padding-left:0">No es este equipo</button></section>'
      : '<section class="card"><h2>¿Qué equipo?</h2>' +
        '<label class="f">Empresa / planta<input value="' + esc(OP.empresaNombre) + '" disabled></label>' +
        '<label class="f">Sector<select id="s-a"><option value="">Elegí…</option>' + sectores.map((a) => '<option value="' + esc(a) + '">' + esc(areaNom(a)) + "</option>").join("") + "</select></label>" +
        '<label class="f">Tipo de equipo<select id="s-t" disabled><option value="">Elegí el sector primero</option></select></label>' +
        '<label class="f">Equipo (número)<select id="s-q" disabled><option value="">Elegí el tipo primero</option></select></label></section>';
    pintar(bloqueEquipo +
      '<section class="card"><h2>¿Qué notás?</h2><p class="hint">Tocá todo lo que corresponda.</p><div class="chips">' + SINTOMAS.map((x) => '<label><input type="checkbox" name="sint" value="' + esc(x) + '">' + esc(x) + "</label>").join("") + "</div></section>" +
      '<section class="card"><h2>¿La máquina…?</h2><div class="func">' + FUNC.map(([k, l, c]) => '<label class="' + k + '"><input type="radio" name="func" value="' + k + '"><span class="dot" style="background:' + c + '"></span>' + esc(l) + "</label>").join("") + "</div></section>" +
      '<section class="card"><h2>Contalo en pocas palabras</h2><textarea id="t-d" rows="4" maxlength="1500" placeholder="Qué ves, escuchás u olés; desde cuándo; cuándo pasa (al arrancar, con carga…)"></textarea>' +
        '<div class="adj-btns"><label class="btn" style="cursor:pointer">' + ICONOS.foto + 'Agregar foto<input type="file" id="i-ph" accept="image/*" capture="environment" multiple hidden></label>' +
        (window.MediaRecorder && navigator.mediaDevices ? '<button class="btn" type="button" id="b-au">' + ICONOS.mic + "Grabar sonido</button>" : "") + "</div>" +
        '<div class="adj" id="prev"></div><p class="hint">Hasta ' + MAX_FOTOS + " fotos y una grabación de " + AUDIO_SEG + " segundos. Son opcionales.</p></section>" +
      '<div class="err" id="e"></div><button class="btn big red" type="button" id="b-send">Enviar aviso a mantenimiento</button>' +
      '<p class="pie"><button class="btn link" type="button" id="b-volver">Volver</button></p>');
    let equipo = eq; const fotos = []; let audio = null;
    const prev = () => {
      $("#prev").innerHTML = fotos.map((f, i) => '<div class="ph"><img src="' + f + '" alt="Foto ' + (i + 1) + '"><button class="x" type="button" data-i="' + i + '" aria-label="Quitar foto">×</button></div>').join("") + (audio ? '<audio controls src="' + audio + '"></audio>' : "");
      $("#prev").querySelectorAll(".x").forEach((b) => b.addEventListener("click", () => { fotos.splice(+b.dataset.i, 1); prev(); }));
    };
    if ($("#b-otro")) $("#b-otro").addEventListener("click", () => formulario(null));
    $("#b-volver").addEventListener("click", () => inicio());
    const sa = $("#s-a"), st = $("#s-t"), sq = $("#s-q");
    if (sa) {
      sa.addEventListener("change", () => {
        const l = [...new Set(eqs.filter((e) => e.area === sa.value).map((e) => e.tipo))];
        st.innerHTML = '<option value="">Elegí…</option>' + l.map((t) => '<option value="' + esc(t) + '">' + esc(tipoNom(t)) + "</option>").join("");
        st.disabled = !sa.value; sq.innerHTML = '<option value="">Elegí el tipo primero</option>'; sq.disabled = true; equipo = null;
        if (l.length === 1) { st.value = l[0]; st.dispatchEvent(new Event("change")); }
      });
      st.addEventListener("change", () => {
        const l = eqs.filter((e) => e.area === sa.value && e.tipo === st.value);
        sq.innerHTML = '<option value="">Elegí…</option>' + l.map((e) => '<option value="' + esc(e.id) + '">' + esc((e.numero != null && e.numero !== "" ? "Nº " + e.numero + " · " : "") + e.nombre) + "</option>").join("");
        sq.disabled = !st.value; equipo = null;
        if (l.length === 1) { sq.value = l[0].id; equipo = l[0]; }
      });
      sq.addEventListener("change", () => { equipo = eqs.find((e) => e.id === sq.value) || null; });
    }
    $("#i-ph").addEventListener("change", async (ev) => {
      for (const f of [...ev.target.files]) { if (fotos.length >= MAX_FOTOS) { toast("Máximo " + MAX_FOTOS + " fotos."); break; } try { fotos.push(await comprimirFoto(f)); } catch (_) { toast("No se pudo usar esa foto."); } }
      ev.target.value = ""; prev();
    });
    const au = $("#b-au");
    if (au) au.addEventListener("click", async () => {
      if (au._rec) { au._rec.stop(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "";
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
        const partes = []; let seg = AUDIO_SEG;
        rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop()); clearInterval(au._t); au._rec = null; au.innerHTML = ICONOS.mic + "Grabar de nuevo";
          const fr = new FileReader(); fr.onload = () => { audio = fr.result; prev(); }; fr.readAsDataURL(new Blob(partes, { type: rec.mimeType || mime || "audio/webm" }));
        };
        rec.start(); au._rec = rec; au.innerHTML = ICONOS.stop + "Detener (" + seg + " s)";
        au._t = setInterval(() => { seg--; if (seg <= 0) { if (rec.state === "recording") rec.stop(); } else au.innerHTML = ICONOS.stop + "Detener (" + seg + " s)"; }, 1000);
      } catch (_) { $("#e").textContent = "No se pudo usar el micrófono: permití el acceso para esta app."; }
    });
    $("#b-send").addEventListener("click", async () => {
      const e = $("#e");
      const sint = [...app.querySelectorAll("input[name=sint]:checked")].map((x) => x.value);
      const func = (app.querySelector("input[name=func]:checked") || {}).value || "";
      const desc = $("#t-d").value.trim();
      if (!equipo) { e.textContent = "Elegí el equipo."; return; }
      if (!sint.length && !desc) { e.textContent = "Marcá qué notás o escribí una descripción."; return; }
      if (!func) { e.textContent = "Indicá si la máquina funciona o está parada."; return; }
      if (au && au._rec) { e.textContent = "Detené la grabación antes de enviar."; return; }
      const b = $("#b-send"); b.disabled = true; b.textContent = "Enviando…";
      const adj = fotos.map((d) => ({ tipo: "foto", data: d })).concat(audio ? [{ tipo: "audio", data: audio }] : []);
      try {
        const num = await rpc("reportar_anomalia", { p_codigo: OP.codigo, p_nombre: OP.nombre, p_equipo_id: equipo.id, p_datos: { sintomas: sint, descripcion: desc, funcionamiento: func }, p_adjuntos: adj });
        recordarAviso(num, equipo, sint.length ? sint : [desc.slice(0, 40)]);
        listo(num, equipo, func);
      } catch (x) {
        b.disabled = false; b.textContent = "Enviar aviso a mantenimiento"; e.textContent = msgError(x);
        if (/incorrecto/i.test(e.textContent)) { guardar("pm-operario", { nombre: OP.nombre }); OP = null; pantallaIngreso("El código de planta cambió: pedí el nuevo a tu supervisor."); }
      }
    });
  }
  function listo(num, eq, func) {
    pintar('<section class="card ok"><div class="tick">' + ICONOS.ok + "</div><h1>¡Gracias, " + esc(OP.nombre.split(" ")[0]) + '!</h1><p>Tu aviso llegó a mantenimiento.</p><div class="num">' + esc(num) + '</div><p class="hint">' + esc(eq.codigo + " · " + eq.nombre) + "</p>" +
      (func === "parado" ? '<div class="banner">Si la máquina representa un riesgo para las personas, no la uses y avisale además a tu supervisor.</div>' : "") +
      '<p class="hint">Podés ver cómo sigue en <b>Mis avisos</b>.</p></section>' +
      '<button class="btn big red" type="button" id="b-mas">Avisar otra cosa de este equipo</button><button class="btn big" type="button" id="b-ini">Listo</button>');
    $("#b-mas").addEventListener("click", () => formulario(eq));
    $("#b-ini").addEventListener("click", () => inicio());
  }
  function comprimirFoto(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
        let q = 0.72, d = c.toDataURL("image/jpeg", q);
        while (d.length > 800000 && q > 0.3) { q -= 0.1; d = c.toDataURL("image/jpeg", q); }
        res(d);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("foto")); };
      img.src = url;
    });
  }

  // Si la app ya está abierta y el operario escanea otra etiqueta con la cámara del celular
  window.addEventListener("hashchange", () => { const t = tokenDe(location.hash); if (OP && t) { limpiarHash(); const e = equipoDe(t); if (e) formulario(e); else inicio("La etiqueta escaneada no es de un equipo de tu planta."); } });

  // ---------- arranque ----------
  (async () => {
    const mem = leer("pm-operario", null);
    if (sb && mem && mem.codigo && mem.nombre) {
      try { await ingresar(mem.codigo, mem.nombre); return; }
      catch (e) {
        const m = msgError(e);
        if (/incorrecto/i.test(m)) { guardar("pm-operario", { nombre: mem.nombre }); pantallaIngreso("El código de planta cambió: pedí el nuevo a tu supervisor."); return; }
        pintar('<div class="card"><h1>Sin conexión</h1><p>' + esc(m) + '</p><button class="btn big red" id="b-re">Reintentar</button></div>');
        $("#b-re").addEventListener("click", () => location.reload());
        return;
      }
    }
    pantallaIngreso();
  })();
})();
