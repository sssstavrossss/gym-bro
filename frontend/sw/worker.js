// Gym Bro's service worker. The build fills in VERSION and SHELL (sw/plugin.ts): every file the
// app needs to open, so it opens with no connection. The app keeps its own data offline
// (src/offline/); this file only serves the app itself, and the reminder notifications.

const VERSION = "__VERSION__";
const SHELL = /*__SHELL__*/ [];
/**
 * The dev server's worker keeps nothing and takes no pages: one that controls the page sits
 * between Vite and the page, and WebKit test mocks (page.route) no longer see the requests.
 */
const SERVES_APP = SHELL.length > 0;
const SHELL_CACHE = `gymbro-shell-${VERSION}`;
/** Exercise photos opened so far. Not tied to a version: the photo path names its free-exercise-db commit. */
const PHOTO_CACHE = "gymbro-exercise-photos";
/** A slow network still wins if it answers within this; after that the kept app opens. */
const NAVIGATION_WAIT_MS = 3000;

if (SERVES_APP) self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // "reload" skips the HTTP cache, so the kept index.html matches this build's files.
    await cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

if (SERVES_APP) self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("gymbro-shell-") && name !== SHELL_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

if (SERVES_APP) self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API answers are the app's business (src/api.ts keeps them for offline).
  if (url.pathname.startsWith("/api/") || url.pathname === "/config.json") return;
  if (url.pathname.startsWith("/exercise-photos/")) {
    event.respondWith(keptPhoto(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(openApp(request));
    return;
  }
  if (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname)) {
    event.respondWith(keptFile(request, url.pathname.startsWith("/assets/")));
  }
});

/** Any page of the app: the network when it answers in time, else the kept index.html. */
async function openApp(request) {
  const network = fetch(request);
  const kept = await caches.match("/index.html", { cacheName: SHELL_CACHE, ignoreVary: true });
  if (!kept) return network;
  let timer = 0;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(kept), NAVIGATION_WAIT_MS); });
  try {
    return await Promise.race([network.catch(() => kept), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fingerprinted files never change, so the kept copy is right. One the build didn't list is kept once fetched. */
async function keptFile(request, keep) {
  // ignoreVary: a module script asks with an Origin header the install request didn't have.
  const kept = await caches.match(request, { cacheName: SHELL_CACHE, ignoreVary: true });
  if (kept) return kept;
  const response = await fetch(request);
  if (keep && response.ok) {
    const copy = response.clone();
    void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

/** A photo never changes at its path, so the kept copy is right; one opened once shows offline after. */
async function keptPhoto(request) {
  const cache = await caches.open(PHOTO_CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone());
  return response;
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "Gym Bro";
  const body = data.body || "Time to recalculate your target";
  const url = data.url || "/today?recalculate=1";
  event.waitUntil(self.registration.showNotification(title, { body, data: { url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/today?recalculate=1";
  event.waitUntil(self.clients.openWindow(url));
});
