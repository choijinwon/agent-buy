import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
const origin = 'https://example.test';
const oldCacheName = 'mwo-satji-shell-v2';
const newCacheName = 'mwo-satji-shell-v3';
const corePaths = ['/index.html', '/styles.css', '/app.js', '/domain.js', '/vault.js', '/device-store.js', '/manifest.webmanifest'];

function response(body = 'app file', properties = {}) {
  return { body, ok: true, redirected: false, type: 'basic', clone() { return response(body, properties); }, ...properties };
}

function createWorker({ scope = `${origin}/`, failFetchPath, invalidPath, rejectPutPath } = {}) {
  const listeners = new Map();
  const oldEntries = new Map([[`${origin}/index.html`, response('previous app')]]);
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
      if (offline || url.pathname === failFetchPath) throw new Error('network unavailable');
      if (url.pathname === invalidPath) return response('missing', { ok: false });
      return response(url.pathname);
    },
  };
  vm.runInNewContext(source, context);
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

test('a successful install serves every core module and the app offline', async () => {
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
    await worker.lifecycle('activate');
    assert.deepEqual([...worker.stores.keys()], ['other-app-cache']);
  }
});

test('API, authentication, external, query and write requests are never intercepted', () => {
  const worker = createWorker();
  const paths = ['/api/records', '/auth/login', '/vault.js?cache=other', '/private.json'];
  for (const path of paths) assert.equal(worker.fetch(`${origin}${path}`), undefined);
  assert.equal(worker.fetch('https://external.test/app.js'), undefined);
  assert.equal(worker.fetch(`${origin}/app.js`, { method: 'POST' }), undefined);
  assert.equal(worker.fetch(`${origin}/?login=1`, { mode: 'navigate' }), undefined);
  assert.equal(worker.fetch(`${origin}/auth/login`, { mode: 'navigate' }), undefined);
  assert.deepEqual(worker.fetchCalls, []);
});
