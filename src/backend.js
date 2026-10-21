/* =====================================================================
   Plan de Mantenimiento · conexión con Supabase
   Implementa window.claude.use(...) con la misma interfaz que usaba la
   versión en Claude (db, user, assets, downloads, sample), de modo que el
   resto de la aplicación (index.html) funciona sin cambios.
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- configuración ---------- */
  const LS_CFG = "pm-config";
  function readCfg() {
    let local = {};
    try { local = JSON.parse(localStorage.getItem(LS_CFG) || "{}") || {}; } catch (_) {}
    const base = window.APP_CONFIG || {};
    const pick = (k) => (local[k] || base[k] || "").trim();
    return {
      supabaseUrl: pick("supabaseUrl").replace(/\/+$/, ""),
      supabaseAnonKey: pick("supabaseAnonKey"),
      publicUrl: pick("publicUrl"),
      anthropicKey: (local.anthropicKey || "").trim()
    };
  }
  function writeCfg(patch) {
    let local = {};
    try { local = JSON.parse(localStorage.getItem(LS_CFG) || "{}") || {}; } catch (_) {}
    Object.assign(local, patch);
    try { localStorage.setItem(LS_CFG, JSON.stringify(local)); } catch (_) {}
  }
  const CFG = readCfg();
  window.PM_PUBLIC_URL = CFG.publicUrl || "";

  const TAURI = window.__TAURI__ || null;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- servicios pendientes hasta iniciar sesión ---------- */
  const services = {};
  const waiters = {};
  function provide(name, value) {
    services[name] = value;
    (waiters[name] || []).forEach((r) => r(value));
    waiters[name] = [];
  }
  window.claude = {
    use(name) {
      if (name in services) return Promise.resolve(services[name]);
      return new Promise((r) => (waiters[name] = waiters[name] || []).push(r));
    }
  };

  /* ---------- descargas (no dependen de la sesión) ---------- */
  const MIME = { html: "text/html;charset=utf-8", csv: "text/csv;charset=utf-8", json: "application/json", txt: "text/plain;charset=utf-8" };
  provide("downloads", {
    async save({ filename, data }) {
      const text = typeof data === "string" ? data : String(data);
      if (TAURI && TAURI.dialog && TAURI.fs) {
        const path = await TAURI.dialog.save({ defaultPath: filename });
        if (!path) throw { code: "declined" };
        const out = /\.csv$/i.test(filename) ? "﻿" + text : text; // BOM para que Excel lea los acentos
        await TAURI.fs.writeTextFile(path, out);
        try { if (TAURI.opener) await TAURI.opener.openPath(path); } catch (_) {}
        return;
      }
      const ext = (filename.split(".").pop() || "").toLowerCase();
      const blob = new Blob([/\.csv$/i.test(filename) ? "﻿" + text : text], { type: MIME[ext] || "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }
  });

  /* ---------- abrir links externos (en la app de escritorio van al navegador) ---------- */
  function openExternal(url) {
    if (TAURI && TAURI.opener) return TAURI.opener.openUrl(url);
    window.open(url, "_blank", "noopener");
  }
  let sb = null;
  document.addEventListener("click", async (ev) => {
    const a = ev.target.closest && ev.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (href.startsWith("/_blob/")) {
      ev.preventDefault();
      const id = decodeURIComponent(href.slice(7));
      const win = TAURI ? null : window.open("about:blank", "_blank");
      try {
        const { data, error } = await sb.storage.from("manuales").createSignedUrl(id, 3600);
        if (error) throw error;
        if (win) win.location = data.signedUrl; else openExternal(data.signedUrl);
      } catch (e) {
        if (win) win.close();
        alert("No se pudo abrir el archivo: " + ((e && e.message) || e));
      }
    } else if (TAURI && /^https?:\/\//i.test(href)) {
      ev.preventDefault();
      openExternal(href);
    }
  }, true);

  /* ---------- pantallas propias (configuración, ingreso, cuenta) ---------- */
  const CSS = `
  .pm-ov{position:fixed;inset:0;z-index:100;background:var(--bg);display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;overflow-y:auto}
  .pm-ov.dim{background:rgba(10,16,20,.55)}
  .pm-box{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);width:100%;max-width:440px;padding:24px;display:flex;flex-direction:column;gap:14px}
  .pm-box.wide{max-width:680px}
  .pm-box h2{font-family:var(--f-display);margin:0;font-size:22px}
  .pm-box p{margin:0}
  .pm-err{color:var(--bad);font-size:13px;min-height:1em}
  .pm-ok{color:var(--ok);font-size:13px}
  .pm-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
  .pm-sw{display:flex;gap:4px;border-bottom:1px solid var(--line)}
  .pm-sw button{border:0;background:none;padding:8px 10px;font-family:var(--f-display);font-weight:600;font-size:15px;color:var(--muted);border-bottom:3px solid transparent;margin-bottom:-1px;cursor:pointer}
  .pm-sw button[aria-selected="true"]{color:var(--fg);border-bottom-color:var(--accent)}
  .pm-users td select{width:auto}
  #who[data-pm]{cursor:pointer;border-radius:8px;padding:2px 6px}
  #who[data-pm]:hover{background:var(--surface-2)}
  `;
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);

  function overlay(html, dim) {
    let el = document.getElementById("pm-ov");
    if (!el) { el = document.createElement("div"); el.id = "pm-ov"; document.body.appendChild(el); }
    el.className = "pm-ov" + (dim ? " dim" : "");
    el.innerHTML = html;
    return el;
  }
  function closeOverlay() { const el = document.getElementById("pm-ov"); if (el) el.remove(); }
  const field = (id, label, attrs) => `<label class="f"><span>${label}</span><input id="${id}" ${attrs || ""}></label>`;

  function setupScreen(msg) {
    const el = overlay(`<form class="pm-box" id="pm-setup">
      <h2>Conectar con la base de datos</h2>
      <p class="hint">Copiá estos datos de Supabase → <b>Project Settings → API</b>. Se piden una sola vez en esta computadora.</p>
      ${field("pm-url", "Project URL", 'placeholder="https://xxxx.supabase.co" required inputmode="url"')}
      ${field("pm-key", "Clave anon public", 'required')}
      ${field("pm-pub", "Dirección de la versión web (opcional, para QR/NFC)", 'placeholder="https://..." inputmode="url"')}
      <div class="pm-err" id="pm-err">${esc(msg || "")}</div>
      <div class="pm-row"><button class="btn primary" type="submit">Guardar y continuar</button></div></form>`);
    el.querySelector("#pm-url").value = CFG.supabaseUrl;
    el.querySelector("#pm-key").value = CFG.supabaseAnonKey;
    el.querySelector("#pm-pub").value = CFG.publicUrl;
    el.querySelector("#pm-setup").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const url = el.querySelector("#pm-url").value.trim();
      if (!/^https:\/\/.+/i.test(url)) { el.querySelector("#pm-err").textContent = "La dirección tiene que empezar con https://"; return; }
      writeCfg({ supabaseUrl: url, supabaseAnonKey: el.querySelector("#pm-key").value.trim(), publicUrl: el.querySelector("#pm-pub").value.trim() });
      location.reload();
    });
  }

  function loginScreen(mode, msg) {
    mode = mode || "in";
    const el = overlay(`<form class="pm-box" id="pm-login">
      <h2>Plan de Mantenimiento</h2>
      <nav class="pm-sw" role="tablist"><button type="button" role="tab" data-m="in" aria-selected="${mode === "in"}">Ingresar</button><button type="button" role="tab" data-m="up" aria-selected="${mode === "up"}">Crear usuario</button></nav>
      ${mode === "up" ? field("pm-name", "Nombre y apellido", 'required autocomplete="name"') : ""}
      ${field("pm-mail", "Email", 'type="email" required autocomplete="email"')}
      ${field("pm-pass", "Contraseña", 'type="password" required minlength="6" autocomplete="' + (mode === "up" ? "new-password" : "current-password") + '"')}
      <div class="pm-err" id="pm-err">${esc(msg || "")}</div>
      <div class="pm-row">${mode === "in" ? '<button class="btn link" type="button" id="pm-forgot">Olvidé la contraseña</button>' : ""}<button class="btn primary" type="submit">${mode === "up" ? "Crear usuario" : "Ingresar"}</button></div>
      ${mode === "up" ? '<p class="hint">El primer usuario queda como administrador. Los siguientes no ven nada hasta que el administrador los habilite.</p>' : ""}
      <p class="hint" style="text-align:right"><button class="btn link" type="button" id="pm-cfg">Cambiar base de datos</button></p>
    </form>`);
    el.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => loginScreen(b.dataset.m)));
    el.querySelector("#pm-cfg").addEventListener("click", () => setupScreen());
    const err = el.querySelector("#pm-err");
    const fg = el.querySelector("#pm-forgot");
    if (fg) fg.addEventListener("click", async () => {
      const mail = el.querySelector("#pm-mail").value.trim();
      if (!mail) { err.textContent = "Escribí tu email y volvé a tocar “Olvidé la contraseña”."; return; }
      const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: CFG.publicUrl || undefined });
      err.className = error ? "pm-err" : "pm-ok";
      err.textContent = error ? traducir(error) : "Te enviamos un email para cambiar la contraseña.";
    });
    el.querySelector("#pm-login").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = el.querySelector("button[type=submit]");
      btn.disabled = true; err.className = "pm-err"; err.textContent = "";
      const email = el.querySelector("#pm-mail").value.trim();
      const password = el.querySelector("#pm-pass").value;
      let res;
      if (mode === "up") {
        res = await sb.auth.signUp({ email, password, options: { data: { nombre: el.querySelector("#pm-name").value.trim() } } });
        if (!res.error && !res.data.session) {
          btn.disabled = false; err.className = "pm-ok";
          err.textContent = "Usuario creado. Revisá tu email para confirmarlo y después ingresá.";
          return;
        }
      } else {
        res = await sb.auth.signInWithPassword({ email, password });
      }
      btn.disabled = false;
      if (res.error) { err.textContent = traducir(res.error); return; }
      // onAuthStateChange continúa el arranque
    });
  }
  function traducir(e) {
    const m = (e && e.message) || String(e);
    if (/Invalid login credentials/i.test(m)) return "Email o contraseña incorrectos.";
    if (/Email not confirmed/i.test(m)) return "Todavía no confirmaste el email: revisá tu casilla.";
    if (/already registered/i.test(m)) return "Ese email ya tiene usuario: usá Ingresar.";
    if (/Password should be/i.test(m)) return "La contraseña tiene que tener al menos 6 caracteres.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sin conexión con el servidor. Revisá internet o los datos de la base.";
    return m;
  }

  /* ---------- arranque ---------- */
  if (!window.supabase || !window.supabase.createClient) { setupScreen("No se cargó la librería de Supabase."); return; }
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) { setupScreen(); return; }
  try {
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch (e) { setupScreen("Los datos de conexión no son válidos: " + e.message); return; }

  let started = false;
  let me = null;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { passwordScreen(); return; }
    if (session && !started) { started = true; setTimeout(() => start(session), 0); }
    else if (!session && started) { location.reload(); }
  });
  sb.auth.getSession().then(({ data }) => { if (!data.session) loginScreen(); });

  function passwordScreen() {
    const el = overlay(`<form class="pm-box" id="pm-pw"><h2>Nueva contraseña</h2>${field("pm-np", "Contraseña nueva", 'type="password" minlength="6" required autocomplete="new-password"')}<div class="pm-err" id="pm-err"></div><div class="pm-row"><button class="btn primary" type="submit">Guardar</button></div></form>`);
    el.querySelector("#pm-pw").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const { error } = await sb.auth.updateUser({ password: el.querySelector("#pm-np").value });
      if (error) el.querySelector("#pm-err").textContent = traducir(error); else closeOverlay();
    });
  }

  async function start(session) {
    closeOverlay();
    const uid = session.user.id;
    let prof = null;
    for (let i = 0; i < 3 && !prof; i++) {
      const { data } = await sb.from("perfiles").select("*").eq("id", uid).maybeSingle();
      prof = data;
      if (!prof) await new Promise((r) => setTimeout(r, 800));
    }
    if (!prof) {
      overlay(`<div class="pm-box"><h2>Falta preparar la base de datos</h2><p>Tu usuario no tiene perfil. Verificá que se haya ejecutado el archivo <b>supabase/esquema.sql</b> en el SQL Editor de Supabase, y volvé a ingresar.</p><div class="pm-row"><button class="btn" id="pm-out">Cerrar sesión</button></div></div>`)
        .querySelector("#pm-out").addEventListener("click", () => sb.auth.signOut());
      return;
    }
    if (prof.rol === "pendiente") {
      overlay(`<div class="pm-box"><h2>Usuario pendiente de aprobación</h2><p>Hola ${esc(prof.nombre)}. Tu usuario ya está creado, pero un administrador tiene que habilitarlo (Cuenta → Usuarios) antes de que puedas ver los datos.</p><div class="pm-row"><button class="btn" id="pm-out">Cerrar sesión</button><button class="btn primary" id="pm-re">Ya me habilitaron</button></div></div>`);
      document.getElementById("pm-out").addEventListener("click", () => sb.auth.signOut());
      document.getElementById("pm-re").addEventListener("click", () => location.reload());
      return;
    }
    me = { id: uid, name: prof.nombre || session.user.email, email: session.user.email, rol: prof.rol, color: colorFor(uid) };

    provide("user", {
      me: async () => ({ id: me.id, name: me.name, color: me.color }),
      isOwner: async () => me.rol === "admin",
      canEdit: async () => me.rol === "admin",
      can: async (perm) => (perm === "data.write" ? me.rol !== "lectura" : null),
      profiles: async (ids) => {
        const { data, error } = await sb.from("perfiles").select("id,nombre").in("id", ids);
        if (error) throw error;
        const out = {};
        (data || []).forEach((p) => (out[p.id] = { name: p.nombre }));
        return out;
      }
    });
    provide("assets", me.rol === "admin" ? assetsApi() : null);
    provide("sample", CFG.anthropicKey ? sampleApi() : null);
    provide("db", dbApi());

    sb.channel("perfil-" + uid)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "perfiles", filter: "id=eq." + uid }, (p) => {
        if (p.new && p.new.rol !== me.rol) { alert("Tu rol cambió a “" + p.new.rol + "”. La aplicación se va a recargar."); location.reload(); }
      }).subscribe();

    addAccountButton();
  }

  function colorFor(id) {
    const c = ["#1D6A73", "#2D7A4C", "#9A6B00", "#B8322A", "#5B4B9A", "#33658A", "#8A4F7D"];
    let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return c[h % c.length];
  }

  /* ---------- base de datos (interfaz tipo colección/documento) ---------- */
  function dbApi() {
    const cache = new Map();      // col -> Map(id -> data)
    const loading = new Map();    // col -> Promise
    const colSubs = new Map();    // col -> Set(fn)
    const docSubs = new Map();    // "col/id" -> Set(fn)
    const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
    const newId = () => { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; const r = crypto.getRandomValues(new Uint8Array(20)); for (const b of r) s += a[b % 36]; return s; };

    function err(e) {
      const msg = (e && e.message) || String(e);
      const code = e && e.code;
      if (code === "42501" || /row-level security|permission denied/i.test(msg)) return { code: "invalid_argument", message: "Sin permiso" };
      if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return { code: "unavailable", message: "Sin conexión" };
      if (code === "P0002") return { code: "not_found", message: msg };
      return { code: code || "error", message: msg };
    }

    async function fetchCol(col) {
      const rows = [];
      const step = 1000;
      for (let from = 0; ; from += step) {
        const { data, error } = await sb.from("docs").select("id,data").eq("col", col).range(from, from + step - 1);
        if (error) throw err(error);
        rows.push(...data);
        if (data.length < step) break;
      }
      const m = new Map(rows.map((r) => [r.id, r.data]));
      cache.set(col, m);
      return m;
    }
    function ensure(col) {
      if (!loading.has(col)) loading.set(col, fetchCol(col).catch((e) => { loading.delete(col); throw e; }));
      return loading.get(col);
    }
    function notify(col, id) {
      (colSubs.get(col) || new Set()).forEach((fn) => fn());
      if (id != null) (docSubs.get(col + "/" + id) || new Set()).forEach((fn) => fn());
    }
    function applyLocal(col, id, data) {
      const m = cache.get(col);
      if (m) { if (data === undefined) m.delete(id); else m.set(id, data); }
      notify(col, id);
    }

    // Tiempo real
    let subscribedOnce = false;
    function refetchAll() {
      for (const col of [...cache.keys()]) fetchCol(col).then(() => { (colSubs.get(col) || new Set()).forEach((fn) => fn()); for (const k of docSubs.keys()) if (k.startsWith(col + "/")) docSubs.get(k).forEach((fn) => fn()); }).catch(() => {});
    }
    sb.channel("docs")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, (p) => {
        const row = p.eventType === "DELETE" ? p.old : p.new;
        if (!row || !row.col) return;
        applyLocal(row.col, row.id, p.eventType === "DELETE" ? undefined : row.data);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { if (subscribedOnce) refetchAll(); subscribedOnce = true; }
      });
    window.addEventListener("online", refetchAll);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refetchAll(); });

    function docSnap(id, data) { return { id, exists: data !== undefined, data: () => clone(data) }; }

    function query(col, opts) {
      return {
        orderBy: (f, dir) => query(col, Object.assign({}, opts, { order: [f, dir || "asc"] })),
        limit: (n) => query(col, Object.assign({}, opts, { limit: n })),
        add: async (data) => {
          const id = newId();
          const { error } = await sb.from("docs").insert({ col, id, data });
          if (error) throw err(error);
          applyLocal(col, id, clone(data));
          return { id };
        },
        doc: (id) => docRef(col, id),
        onSnapshot(cb, onErr) {
          let active = true;
          const emit = () => {
            if (!active) return;
            let list = [...(cache.get(col) || new Map()).entries()];
            if (opts.order) {
              const [f, dir] = opts.order; const s = dir === "desc" ? -1 : 1;
              list.sort((a, b) => { const x = a[1] && a[1][f], y = b[1] && b[1][f]; return (x == null ? -1 : y == null ? 1 : x < y ? -1 : x > y ? 1 : 0) * s; });
            }
            if (opts.limit) list = list.slice(0, opts.limit);
            const docs = list.map(([id, d]) => docSnap(id, d));
            cb({ docs, size: docs.length, empty: !docs.length });
          };
          if (!colSubs.has(col)) colSubs.set(col, new Set());
          colSubs.get(col).add(emit);
          ensure(col).then(emit, (e) => onErr && onErr(e));
          return () => { active = false; colSubs.get(col).delete(emit); };
        },
        async get() {
          await ensure(col);
          const docs = [...cache.get(col).entries()].map(([id, d]) => docSnap(id, d));
          return { docs, size: docs.length, empty: !docs.length };
        }
      };
    }
    function docRef(col, id) {
      const key = col + "/" + id;
      return {
        id,
        async set(data) {
          const { error } = await sb.from("docs").upsert({ col, id, data, actualizado: new Date().toISOString() });
          if (error) throw err(error);
          applyLocal(col, id, clone(data));
        },
        async update(patch) {
          const { data, error } = await sb.rpc("doc_update", { p_col: col, p_id: id, p_patch: patch });
          if (error) throw err(error);
          applyLocal(col, id, data && data.data);
        },
        async delete() {
          const { error } = await sb.from("docs").delete().eq("col", col).eq("id", id);
          if (error) throw err(error);
          applyLocal(col, id, undefined);
        },
        async get() {
          await ensure(col);
          return docSnap(id, cache.get(col).get(id));
        },
        onSnapshot(cb, onErr) {
          let active = true;
          const emit = () => { if (active) cb(docSnap(id, (cache.get(col) || new Map()).get(id))); };
          if (!docSubs.has(key)) docSubs.set(key, new Set());
          docSubs.get(key).add(emit);
          ensure(col).then(emit, (e) => onErr && onErr(e));
          return () => { active = false; docSubs.get(key).delete(emit); };
        }
      };
    }
    return {
      collection: (col) => query(col, {}),
      doc: (path) => { const i = path.lastIndexOf("/"); return docRef(path.slice(0, i), path.slice(i + 1)); }
    };
  }

  /* ---------- archivos (manuales) ---------- */
  function assetsApi() {
    return {
      async upload(file, opts) {
        const ext = ((file.name || "").match(/\.[A-Za-z0-9]{1,8}$/) || [""])[0].toLowerCase();
        const path = crypto.randomUUID() + ext;
        const { error } = await sb.storage.from("manuales").upload(path, file, { contentType: (opts && opts.type) || file.type || "application/octet-stream" });
        if (error) {
          const m = error.message || "";
          throw { code: /exceeded|too large|413/i.test(m) ? "too_large" : /mime|type/i.test(m) ? "unsupported_type" : /security|denied|403/i.test(m) ? "not_granted" : "invalid_request", message: m };
        }
        return { id: path, sizeBytes: file.size };
      },
      async delete(id) {
        const { error } = await sb.storage.from("manuales").remove([id]);
        if (error) throw error;
      }
    };
  }

  /* ---------- sugerencias con IA (opcional, con clave propia de Anthropic) ---------- */
  function sampleApi() {
    return {
      async json(prompt) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": CFG.anthropicKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "server-side-fallback-2026-07-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: "claude-opus-5-5",
            max_tokens: 16000,
            fallbacks: "default",
            output_config: {
              effort: "medium",
              format: {
                type: "json_schema",
                schema: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          texto: { type: "string" },
                          cada: { type: "integer" },
                          unidad: { type: "string", enum: ["dias", "semanas", "meses", "anios", "horas"] },
                          detalle: { type: "string" }
                        },
                        required: ["texto", "cada", "unidad", "detalle"],
                        additionalProperties: false
                      }
                    }
                  },
                  required: ["items"],
                  additionalProperties: false
                }
              }
            },
            messages: [{ role: "user", content: prompt }]
          })
        });
        if (res.status === 429) throw { code: "rate_limited" };
        if (res.status === 401 || res.status === 403) throw { code: "not_granted" };
        if (!res.ok) throw { code: "error", message: "HTTP " + res.status };
        const msg = await res.json();
        if (msg.stop_reason === "refusal") throw { code: "error", message: "refusal" };
        const txt = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
        const parsed = JSON.parse(txt);
        return Array.isArray(parsed) ? parsed : parsed.items || [];
      }
    };
  }

  /* ---------- botón Cuenta: perfil, usuarios, configuración, salir ---------- */
  function addAccountButton() {
    if (document.querySelector("#who[data-pm]")) return;
    const who = document.getElementById("who");
    if (!who) return;
    // El bloque de usuario (avatar y nombre) abre la cuenta; la app lo redibuja, el elemento queda.
    who.id = "who"; who.dataset.pm = "1";
    who.setAttribute("role", "button"); who.tabIndex = 0; who.title = "Cuenta: perfil, usuarios y configuración";
    const open = () => accountScreen(me.rol === "admin" ? "usuarios" : "perfil");
    who.addEventListener("click", open);
    who.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
  }

  async function accountScreen(tab) {
    const tabs = [["perfil", "Mi perfil"]].concat(me.rol === "admin" ? [["usuarios", "Usuarios"]] : []).concat([["config", "Configuración"]]);
    let body = "";
    if (tab === "perfil") {
      body = `${field("pm-n", "Nombre", "")}<p class="hint">Email: ${esc(me.email)} · Rol: <b>${esc(rolLabel(me.rol))}</b></p>
        <div class="pm-err" id="pm-err"></div>
        <div class="pm-row"><button class="btn danger" type="button" id="pm-out">Cerrar sesión</button><button class="btn primary" type="button" id="pm-save">Guardar nombre</button></div>`;
    } else if (tab === "usuarios") {
      const { data, error } = await sb.from("perfiles").select("*").order("creado");
      body = error ? `<p class="pm-err">${esc(error.message)}</p>` :
        `<p class="hint">Los usuarios se crean desde la pantalla de ingreso (“Crear usuario”). Los nuevos aparecen como <b>Sin acceso</b> hasta que les asignes un rol: <b>Solo lectura</b> ve todo, <b>Técnico</b> carga fallas, intervenciones y tareas; <b>Administrador</b> además da de alta equipos, manuales y usuarios.</p>
        <div class="tbl-wrap"><table class="pm-users"><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th></tr></thead><tbody>${(data || []).map((p) => `<tr><td>${esc(p.nombre)}</td><td>${esc(p.email || "")}</td><td><select data-uid="${esc(p.id)}" ${p.id === me.id ? "disabled title=\"No podés cambiar tu propio rol\"" : ""}>${["admin", "tecnico", "lectura", "pendiente"].map((r) => `<option value="${r}" ${r === p.rol ? "selected" : ""}>${rolLabel(r)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>
        <div class="pm-err" id="pm-err"></div>`;
    } else {
      body = `${field("pm-pub", "Dirección de la versión web (para QR/NFC)", 'placeholder="https://..." inputmode="url"')}
        ${field("pm-ak", "Clave de API de Anthropic (opcional, para “Sugerir ítems con IA”)", 'type="password" placeholder="sk-ant-..."')}
        <p class="hint">La clave de IA queda guardada solo en esta computadora. Base de datos conectada: ${esc(CFG.supabaseUrl)}</p>
        <div class="pm-err" id="pm-err"></div>
        <div class="pm-row"><button class="btn" type="button" id="pm-db">Cambiar base de datos</button><button class="btn primary" type="button" id="pm-save">Guardar</button></div>`;
    }
    const el = overlay(`<div class="pm-box wide" role="dialog" aria-modal="true"><div class="mh"><h2>Cuenta</h2><button class="btn sm x" type="button" id="pm-x" aria-label="Cerrar">✕</button></div>
      <nav class="pm-sw">${tabs.map(([k, l]) => `<button type="button" data-t="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}</nav>${body}</div>`, true);
    el.addEventListener("click", (ev) => { if (ev.target === el) closeOverlay(); });
    el.querySelector("#pm-x").addEventListener("click", closeOverlay);
    el.querySelectorAll("[data-t]").forEach((x) => x.addEventListener("click", () => accountScreen(x.dataset.t)));
    const errEl = el.querySelector("#pm-err");
    if (tab === "perfil") {
      el.querySelector("#pm-n").value = me.name;
      el.querySelector("#pm-out").addEventListener("click", () => sb.auth.signOut());
      el.querySelector("#pm-save").addEventListener("click", async () => {
        const n = el.querySelector("#pm-n").value.trim(); if (!n) return;
        const { error } = await sb.from("perfiles").update({ nombre: n }).eq("id", me.id);
        if (error) { errEl.textContent = error.message; return; }
        me.name = n; location.reload();
      });
    } else if (tab === "usuarios") {
      el.querySelectorAll("select[data-uid]").forEach((s) => s.addEventListener("change", async () => {
        const { error } = await sb.from("perfiles").update({ rol: s.value }).eq("id", s.dataset.uid);
        errEl.className = error ? "pm-err" : "pm-ok";
        errEl.textContent = error ? error.message : "Rol actualizado.";
      }));
    } else if (tab === "config") {
      el.querySelector("#pm-pub").value = CFG.publicUrl;
      el.querySelector("#pm-ak").value = CFG.anthropicKey;
      el.querySelector("#pm-db").addEventListener("click", () => setupScreen());
      el.querySelector("#pm-save").addEventListener("click", () => {
        writeCfg({ publicUrl: el.querySelector("#pm-pub").value.trim(), anthropicKey: el.querySelector("#pm-ak").value.trim() });
        location.reload();
      });
    }
  }
  const rolLabel = (r) => ({ admin: "Administrador", tecnico: "Técnico", lectura: "Solo lectura", pendiente: "Sin acceso (pendiente)" }[r] || r);
})();
