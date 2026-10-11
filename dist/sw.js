/* Static app shell only. Purchase records stay in the browser's local storage. */
const CACHE_PREFIX = 'mwo-satji-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const IS_LOCAL_PREVIEW = ['localhost', '127.0.0.1', '[::1]', '::1']
  .includes(new URL(self.registration.scope).hostname);
const SHELL_PATHS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './domain.js',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];
const SHELL_URLS = SHELL_PATHS.map((path) => new URL(path, self.registration.scope).href);
const STATIC_URLS = new Set(SHELL_URLS);
const INDEX_URL = new URL('./index.html', self.registration.scope).href;
const NAVIGATION_URLS = new Set([
  self.registration.scope,
  INDEX_URL,
]);

function mayCache(response) {
  return response.ok && !response.redirected && response.type === 'basic';
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (IS_LOCAL_PREVIEW) {
      await self.skipWaiting();
      return;
    }
    const cache = await caches.open(CACHE_NAME);
    // A missing optional icon must not prevent the rest of the app going offline.
    await Promise.allSettled(SHELL_URLS.map(async (url) => {
      const response = await fetch(new Request(url, { cache: 'reload', redirect: 'error' }));
      if (mayCache(response)) await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && (IS_LOCAL_PREVIEW || name !== CACHE_NAME))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  // Local previews must always show the latest files during development.
  if (IS_LOCAL_PREVIEW) return;
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Only known app URLs are eligible; API, auth routes, and query URLs pass through.
  if (request.mode === 'navigate') {
    if (!NAVIGATION_URLS.has(url.href)) return;
    event.respondWith((async () => {
      try {
        // Do not persist navigation responses: redirects or authentication pages
        // must never replace the public index stored during installation.
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(INDEX_URL)
          || await cache.match(self.registration.scope)
          || new Response('인터넷에 연결한 뒤 뭐샀지를 한 번 열어 주세요.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
      }
    })());
    return;
  }

  if (!STATIC_URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (mayCache(response)) await cache.put(request, response.clone());
    return response;
  })());
});
