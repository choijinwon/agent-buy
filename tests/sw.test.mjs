import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const origin = 'https://example.test';
const oldCacheName = 'mwo-satji-shell-v3';
const newCacheName = 'mwo-satji-shell-v5';
const corePaths = ['/index.html', '/styles.css?v=5', '/app.js?v=5', '/domain.js', '/vault.js', '/device-store.js', '/manifest.webmanifest'];

// Frozen v3 static fetch behavior. During an update it can still control a page
// whose freshly fetched HTML requests the v5 assets, before v5 claims clients.
const previousWorkerSource = `
const CACHE_NAME = 'mwo-satji-shell-v3';
const STATIC_URLS = new Set([
  './index.html', './styles.css', './app.js', './domain.js', './vault.js',
  './device-store.js', './manifest.webmanifest', './assets/icon.svg',
  './assets/icon-192.png', './assets/icon-512.png',
].map(path => new URL(path, self.registration.scope).href));
function mayCache(response) {
  return response.ok && !response.redirected && response.type === 'basic';
}
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
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
`;

// v4 uses the same exact-URL static handler with revisioned CSS/script URLs.
const previousRevisionedWorkerSource = previousWorkerSource
  .replace('mwo-satji-shell-v3', 'mwo-satji-shell-v4')
  .replace("'./styles.css', './app.js'", "'./styles.css?v=4', './app.js?v=4'");

function response(body = 'app file', properties = {}) {
  return { body, ok: true, redirected: false, type: 'basic', clone() { return response(body, properties); }, ...properties };
}

function createWorker({ scope = `${origin}/`, failFetchPath, invalidPath, rejectPutPath, workerSource = source } = {}) {
  const listeners = new Map();
  const oldEntries = new Map([
    [`${origin}/index.html`, response('previous app')],
    [`${origin}/styles.css`, response('previous styles')],
    [`${origin}/app.js`, response('previous script')],
  ]);
  const stores = new Map([[oldCacheName, oldEntries], ['other-app-cache', new Map()]]);
  const fetchCalls = [];
  let skipped = false;
  let claimed = false;
  let offline = false;
  const toUrl = (value) => typeof value === 'string' ? value : value.url;
  const context = {
    URL, Request, Response,
    self: {
      registration: { scope },
      location: { origin: new URL(scope).origin },
      addEventListener(type, listener) { listeners.set(type, listener); },
      async skipWaiting() { skipped = true; },
      clients: { async claim() { claimed = true; } },
    },
    caches: {
      async open(name) {
        if (!stores.has(name)) stores.set(name, new Map());
        const entries = stores.get(name);
        return {
          async put(key, value) {
            if (new URL(toUrl(key)).pathname === rejectPutPath) throw new Error('quota exceeded');
            entries.set(toUrl(key), value);
          },
          async match(key) { return entries.get(toUrl(key)); },
        };
      },
      async keys() { return [...stores.keys()]; },
      async delete(name) { return stores.delete(name); },
    },
    async fetch(request) {
      const url = new URL(toUrl(request));
      fetchCalls.push(url.href);
      const path = `${url.pathname}${url.search}`;
      if (offline || path === failFetchPath) throw new Error('network unavailable');
      if (path === invalidPath) return response('missing', { ok: false });
      return response(path);
    },
  };
  vm.runInNewContext(workerSource, context);
  return {
    stores, fetchCalls,
    get skipped() { return skipped; },
    get claimed() { return claimed; },
    goOffline() { offline = true; },
    lifecycle(type) {
      let work;
      listeners.get(type)({ waitUntil(promise) { work = promise; } });
      return work;
    },
    fetch(url, options = {}) {
      let work;
      listeners.get('fetch')({
        request: { url, method: 'GET', mode: 'cors', ...options },
        respondWith(promise) { work = promise; },
      });
      return work;
    },
  };
}

test('a successful install serves every core module and revisioned CSS/script offline', async () => {
  const worker = createWorker();
  await worker.lifecycle('install');
  assert.equal(worker.skipped, true);
  await worker.lifecycle('activate');
  assert.equal(worker.claimed, true);
  assert.equal(worker.stores.has(oldCacheName), false);
  assert.equal(worker.stores.has('other-app-cache'), true);
  worker.goOffline();
  for (const path of corePaths) {
    assert.equal((await worker.fetch(`${origin}${path}`)).body, path);
  }
  assert.equal((await worker.fetch(`${origin}/`, { mode: 'navigate' })).body, '/index.html');
});

test('HTML requests exactly the revisioned CSS and script precached for this release', async () => {
  const stylePath = indexHtml.match(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/)?.[1];
  const scriptPath = indexHtml.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
  assert.deepEqual([stylePath, scriptPath], ['./styles.css?v=5', './app.js?v=5']);
  const worker = createWorker();
  await worker.lifecycle('install');
  worker.goOffline();
  for (const path of [stylePath, scriptPath]) {
    const url = new URL(path, `${origin}/`);
    assert.equal((await worker.fetch(url.href)).body, `${url.pathname}${url.search}`);
  }
});

test('controlling v3 and v4 workers cannot substitute old cached assets for v5 requests', async () => {
  for (const [workerSource, revision] of [[previousWorkerSource, 3], [previousRevisionedWorkerSource, 4]]) {
    const worker = createWorker({ workerSource });
    const suffix = revision === 4 ? '?v=4' : '';
    worker.stores.set(`mwo-satji-shell-v${revision}`, new Map([
      [`${origin}/styles.css${suffix}`, response('previous styles')],
      [`${origin}/app.js${suffix}`, response('previous script')],
    ]));
    assert.equal((await worker.fetch(`${origin}/styles.css${suffix}`)).body, 'previous styles');
    assert.equal((await worker.fetch(`${origin}/app.js${suffix}`)).body, 'previous script');
    for (const path of ['/styles.css?v=5', '/app.js?v=5']) {
      assert.equal(worker.fetch(`${origin}${path}`), undefined);
    }
    assert.deepEqual(worker.fetchCalls, []);
  }
});

test('any missing core file prevents activation and preserves the previous version', async (t) => {
  for (const path of corePaths) {
    await t.test(path, async () => {
      const worker = createWorker({ invalidPath: path });
      await assert.rejects(worker.lifecycle('install'), /App shell unavailable/);
      assert.equal(worker.skipped, false);
      assert.equal(worker.stores.get(oldCacheName).get(`${origin}/index.html`).body, 'previous app');
      assert.equal(worker.stores.has(newCacheName), false);
    });
  }
});

test('core network and storage failures leave no partial new cache', async () => {
  for (const options of [{ failFetchPath: '/vault.js' }, { rejectPutPath: '/device-store.js' }]) {
    const worker = createWorker(options);
    await assert.rejects(worker.lifecycle('install'));
    assert.equal(worker.skipped, false);
    assert.equal(worker.stores.has(oldCacheName), true);
    assert.equal(worker.stores.has(newCacheName), false);
  }
});

test('a missing optional icon allows installation of the complete core', async () => {
  const worker = createWorker({ failFetchPath: '/assets/icon-512.png' });
  await worker.lifecycle('install');
  assert.equal(worker.skipped, true);
  for (const path of corePaths) assert.equal(worker.stores.get(newCacheName).has(`${origin}${path}`), true);
});

test('local previews bypass cache and remove only this app caches', async () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const scope = `http://${hostname}:4173/`;
    const worker = createWorker({ scope });
    await worker.lifecycle('install');
    assert.deepEqual(worker.fetchCalls, []);
    assert.equal(worker.fetch(`${scope}app.js`), undefined);
    assert.equal(worker.fetch(`${scope}app.js?v=5`), undefined);
    assert.equal(worker.fetch(`${scope}styles.css?v=5`), undefined);
    await worker.lifecycle('activate');
    assert.deepEqual([...worker.stores.keys()], ['other-app-cache']);
  }
});

test('only exact release asset URLs are intercepted; APIs, auth and other queries pass through', () => {
  const worker = createWorker();
  const paths = [
    '/api/records', '/auth/login', '/vault.js?cache=other', '/private.json',
    '/styles.css', '/app.js', '/styles.css?v=4', '/app.js?v=6',
    '/styles.css?v=5&other=1', '/app.js?v=5&v=5', '/app.js?other=1&v=5',
  ];
  for (const path of paths) assert.equal(worker.fetch(`${origin}${path}`), undefined);
  assert.equal(worker.fetch('https://external.test/app.js'), undefined);
  assert.equal(worker.fetch(`${origin}/app.js?v=5`, { method: 'POST' }), undefined);
  assert.equal(worker.fetch(`${origin}/?login=1`, { mode: 'navigate' }), undefined);
  assert.equal(worker.fetch(`${origin}/auth/login`, { mode: 'navigate' }), undefined);
  assert.deepEqual(worker.fetchCalls, []);
});
