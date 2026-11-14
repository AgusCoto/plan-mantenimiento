// Service worker: permite instalar la app y abrirla sin señal (la app guarda los datos en IndexedDB).
// La página y los archivos se buscan primero en la red; si no hay señal, se usa la copia guardada.
const CACHE = "mantenimiento-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/index.html", "/icono-192.png", "/icono.svg"]).catch(() => {}))); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
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
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((c) => c || (req.mode === "navigate" ? caches.match("/index.html") : undefined))));
});
