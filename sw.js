/* Litoteca service worker.
 * VERSION bump: si cambias cualquier archivo de PRECACHE, cambia VERSION también.
 * En activate se borran todos los cachés cuyo nombre no sea la VERSION actual. */
const VERSION = "litoteca-v1";
const PRECACHE = [
  "/",
  "/index.html",
  "/assets/app.css",
  "/assets/app.js",
  "/assets/fichas.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(PRECACHE);
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== VERSION) {
            return caches.delete(key);
          }
        })
      );
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") {
    return;
  }
  if (request.url.indexOf(self.location.origin) !== 0) {
    return;
  }
  var url = new URL(request.url);
  if (url.pathname === "/api/predict") {
    event.respondWith(fetch(request));
    return;
  }
  if (url.pathname.indexOf("/assets/") === 0 || request.mode === "navigate") {
    var cacheP = caches.open(VERSION);
    var refresco = cacheP.then(function (cache) {
      return fetch(request).then(function (response) {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      });
    });
    event.waitUntil(refresco.catch(function () {}));
    event.respondWith(
      cacheP.then(function (cache) {
        return cache.match(request).then(function (hit) {
          if (hit) {
            return hit;
          }
          return refresco;
        });
      }).then(function (resp) {
        return resp;
      }).catch(function () {
        if (request.mode === "navigate") {
          return cacheP.then(function (cache) {
            return cache.match("/index.html").then(function (cachedIndex) {
              if (cachedIndex) {
                return cachedIndex;
              }
              throw new Error("no offline fallback");
            });
          });
        }
        throw new Error("no offline asset");
      })
    );
    return;
  }
  // otros GET same-origin: no interceptar
});