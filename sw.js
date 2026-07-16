const CACHE_PREFIX = "heymi-pocket-";
const CACHE_NAME = `${CACHE_PREFIX}beta-1.0.0`;
const SCOPE_URL = new URL(self.registration.scope);
const APP_URL = new URL("./", SCOPE_URL).href;
const PRIVACY_URL = new URL("./privacy.html", SCOPE_URL).href;
const SHELL_FILES = [
  "./",
  "./app.css",
  "./app.js",
  "./privacy.html",
  "./icon.svg",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./assets/origin.png",
  "./assets/default.png",
  "./assets/dragon.png",
  "./assets/cat.png"
];
const SHELL_URLS = SHELL_FILES.map((file) => new URL(file, SCOPE_URL).href);
const SHELL_KEYS = new Set(SHELL_URLS.map((value) => {
  const url = new URL(value);
  url.search = "";
  return url.href;
}));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== SCOPE_URL.origin || !requestUrl.pathname.startsWith(SCOPE_URL.pathname)) return;

  if (event.request.mode === "navigate") {
    const fallbackUrl = requestUrl.pathname === new URL(PRIVACY_URL).pathname ? PRIVACY_URL : APP_URL;
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(fallbackUrl, response.clone()));
          return response;
        })
        .catch(() => caches.match(fallbackUrl))
    );
    return;
  }

  const cacheKey = new URL(requestUrl);
  cacheKey.search = "";
  if (!SHELL_KEYS.has(cacheKey.href)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey.href, response.clone()));
        return response;
      })
      .catch(() => caches.match(cacheKey.href))
  );
});
