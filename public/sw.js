// Service worker: permite instalar la app y abrirla sin señal (la app guarda los datos en IndexedDB).
// La página y los archivos se buscan primero en la red; si no hay señal, se usa la copia guardada.
const CACHE = "mantenimiento-v3";
// Funciona en la raíz o en una subcarpeta (GitHub Pages: /plan-mantenimiento/)
const BASE = new URL(self.registration.scope).pathname;
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll([BASE, BASE + "index.html", BASE + "icono-192.png", BASE + "icono.svg"]).catch(() => {}))); });
// Al activarse borra las copias viejas (incluida la de W-Main) y toma el control
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const fuentes = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && !fuentes) return;
  // Las fuentes no cambian: primero la copia guardada
  if (fuentes) {
    e.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => { const k = r.clone(); caches.open(CACHE).then((x) => x.put(req, k)); return r; })));
    return;
  }
  e.respondWith(fetch(req).then((r) => {
    if (r.ok) { const k = r.clone(); caches.open(CACHE).then((x) => x.put(req, k)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((c) => c || (req.mode === "navigate" ? caches.match(BASE + "index.html") : undefined))));
});

// Notificaciones push: las manda la función «avisos» de Supabase
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: "Mantenimiento", cuerpo: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "Mantenimiento", {
    body: d.cuerpo || "", icon: "/icono-192.png", badge: "/icono-192.png", tag: d.tag, renotify: !!d.urgente,
    requireInteraction: !!d.urgente, vibrate: d.urgente ? [300, 120, 300, 120, 300] : [150], data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const u = (e.notification.data && e.notification.data.url) || "/";
  const url = new URL(BASE + u.replace(/^\//, ""), self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
    for (const v of ventanas) if (v.url.startsWith(self.location.origin) && "focus" in v) { v.navigate(url); return v.focus(); }
    return self.clients.openWindow(url);
  }));
});
