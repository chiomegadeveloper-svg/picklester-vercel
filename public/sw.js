const CACHE = "picklester-v26-ui-restore";
self.addEventListener("install", (event) => event.waitUntil(Promise.all([
  caches.open(CACHE).then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/picklester-logo.png", "/icon-192.png", "/icon-512.png"])),
  self.skipWaiting(),
])));
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  self.clients.claim(),
])));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const request = event.request.mode === "navigate"
    ? new Request(event.request, { cache: "no-store" })
    : event.request;
  event.respondWith(fetch(request).then((response) => {
    const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
});
