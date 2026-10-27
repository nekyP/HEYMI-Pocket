const CACHE_PREFIX = "heymi-pocket-";
const CACHE_NAME = `${CACHE_PREFIX}beta-1.0.2`;
const SCOPE_URL = new URL(self.registration.scope);
const APP_URL = new URL("./", SCOPE_URL).href;
const PRIVACY_URL = new URL("./privacy.html", SCOPE_URL).href;
const INDEX_URL = new URL("./index.html", SCOPE_URL).href;
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

function shellKey(request) {
  if (request.method !== "GET" || request.headers.has("authorization")) return null;
  const url = new URL(request.url);
  if (url.origin !== SCOPE_URL.origin) return null;
  const key = `${url.origin}${url.pathname}`;
  const navigation = request.mode === "navigate";
  if (navigation && ![APP_URL, INDEX_URL, PRIVACY_URL].includes(key)) return null;
  if (!navigation && !SHELL_KEYS.has(key)) return null;
  // Preserve app tabs and shipped versioned assets without accepting credential
  // or arbitrary server query parameters into the shared offline shell.
  for (const [name, value] of url.searchParams) {
    if (name === "v" && /^[A-Za-z0-9._-]{1,64}$/.test(value)) continue;
    if (navigation && key !== PRIVACY_URL && name === "tab" && ["home", "pet", "play", "remote", "you"].includes(value)) continue;
    return null;
  }
  return key === INDEX_URL ? APP_URL : key;
}

function cacheable(response, requestUrl) {
  if (!response.ok || response.redirected || response.type !== "basic") return false;
  const responseUrl = new URL(response.url);
  const expectedUrl = new URL(requestUrl);
  if (responseUrl.origin !== expectedUrl.origin || responseUrl.pathname !== expectedUrl.pathname) return false;
  return !/(?:^|,)\s*(?:private|no-store)\b/i.test(response.headers.get("cache-control") || "");
}

async function shellResponse(request, key) {
  try {
    // Shell resources are public static files. Never forward ambient cookies or
    // follow a login/API redirect while refreshing their shared cache entries.
    const response = await fetch(new Request(request, { credentials: "omit", redirect: "error" }));
    if (cacheable(response, request.url)) {
      // Cache storage failure must not discard a successful network response.
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(key, response.clone());
      } catch { /* Offline storage may be unavailable or full. */ }
    }
    return response;
  } catch {
    const cached = await (await caches.open(CACHE_NAME)).match(key);
    if (cached) return cached;
    return Response.error();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const responses = await Promise.all(SHELL_URLS.map(async (url) => {
      const response = await fetch(new Request(url, { cache: "reload", credentials: "omit", redirect: "error" }));
      if (!cacheable(response, url)) throw new Error("Unsafe offline shell response");
      return [url, response];
    }));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const key = shellKey(event.request);
  if (key) event.respondWith(shellResponse(event.request, key));
});
