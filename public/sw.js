// Exists so the page is installable as an app (needed to appear in the share
// sheet). No caching: the queue must always come from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => e.respondWith(fetch(e.request)));
