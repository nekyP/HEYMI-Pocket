import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const scope = 'https://pocket.example/HEYMI-Pocket/';

function response(url, body = 'public shell', options = {}) {
  return {
    url, body, ok: true, redirected: false, type: 'basic',
    headers: new Headers(), ...options,
    clone() { return response(this.url, this.body, this); },
  };
}

function worker() {
  const listeners = new Map(), stores = new Map(), requests = [];
  let network = async request => response(request.url);
  let claimed = false, skipped = false, failWrites = false;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(key, value) { if (failWrites) throw new Error('quota'); store.set(key, value.clone()); },
        async match(key) { return store.get(key)?.clone(); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(key) { return stores.delete(key); },
  };
  class Request {
    constructor(input, init = {}) {
      Object.assign(this, typeof input === 'string' ? { url: input, method: 'GET', mode: 'cors', headers: new Headers() } : input, init);
    }
  }
  vm.runInNewContext(source, {
    URL, Request, Response, caches,
    self: {
      registration: { scope },
      addEventListener: (name, listener) => listeners.set(name, listener),
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
    fetch: async request => { requests.push(request); return network(request); },
  });
  return {
    stores, requests,
    setNetwork(fn) { network = fn; },
    failWrites() { failWrites = true; },
    async lifecycle(name) {
      let done;
      listeners.get(name)({ waitUntil: promise => { done = promise; } });
      await done;
      return { claimed, skipped };
    },
    fetch(path, init = {}) {
      let result;
      listeners.get('fetch')({
        request: new Request(new URL(path, scope).href, init),
        respondWith: promise => { result = promise; },
      });
      return result;
    },
    cached(path) {
      const current = [...stores].find(([name]) => name.startsWith('heymi-pocket-'))?.[1];
      return current?.get(new URL(path, scope).href)?.body;
    },
  };
}

test('API/unknown/authenticated requests never enter the offline cache handler', () => {
  const w = worker();
  for (const [path, init] of [
    ['api/pair/receipt', { mode: 'navigate' }],
    ['unknown.html', { mode: 'navigate' }],
    ['app.js', { method: 'POST' }],
    ['app.js', { headers: new Headers({ authorization: 'Bearer synthetic-test-value' }) }],
    ['?token=synthetic-test-value', { mode: 'navigate' }],
    ['app.js?session=synthetic-test-value', {}],
    ['https://elsewhere.example/app.js', {}],
    ['../private.html', { mode: 'navigate' }],
  ]) assert.equal(w.fetch(path, init), undefined, path);
  assert.equal(w.requests.length, 0);
  assert.equal(w.stores.size, 0);
});

test('root, index, privacy and versioned assets retain offline behavior at a subpath', async () => {
  const w = worker();
  const installed = await w.lifecycle('install');
  assert.equal(installed.skipped, true);
  assert.equal(w.cached('./'), 'public shell');
  await w.fetch('index.html?tab=you', { mode: 'navigate' });
  await w.fetch('app.js?v=1.0.0-beta.3');
  assert.ok(w.requests.every(request => request.credentials === 'omit' && request.redirect === 'error'));
  w.setNetwork(async () => { throw new TypeError('offline'); });
  assert.equal((await w.fetch('?tab=play', { mode: 'navigate' })).body, 'public shell');
  assert.equal((await w.fetch('index.html', { mode: 'navigate' })).body, 'public shell');
  assert.equal((await w.fetch('privacy.html', { mode: 'navigate' })).body, 'public shell');
  assert.equal((await w.fetch('app.js?v=1.0.0-beta.3')).body, 'public shell');
});

test('private, no-store, redirected and off-origin responses cannot replace a public shell', async () => {
  const w = worker();
  await w.lifecycle('install');
  for (const options of [
    { headers: new Headers({ 'cache-control': 'max-age=0, private' }) },
    { headers: new Headers({ 'cache-control': 'No-Store' }) },
    { redirected: true },
    { type: 'cors' },
    { url: 'https://elsewhere.example/HEYMI-Pocket/' },
    { url: new URL('api/pair/receipt', scope).href },
    { ok: false },
  ]) {
    w.setNetwork(async request => response(request.url, 'sensitive test response', options));
    assert.equal((await w.fetch('./', { mode: 'navigate' })).body, 'sensitive test response');
    assert.equal(w.cached('./'), 'public shell');
  }
});

test('install rejects unsafe responses before populating the shell cache', async () => {
  const w = worker();
  w.setNetwork(async request => response(request.url, 'private', { headers: new Headers({ 'cache-control': 'private' }) }));
  await assert.rejects(w.lifecycle('install'), /Unsafe offline shell response/);
  assert.equal(w.stores.size, 0);
});

test('activation removes the old possibly polluted cache while preserving other apps', async () => {
  const w = worker();
  w.stores.set('heymi-pocket-beta-1.0.1', new Map([[scope, response(scope, 'polluted')]]));
  w.stores.set('another-app', new Map());
  await w.lifecycle('install');
  assert.equal((await w.lifecycle('activate')).claimed, true);
  assert.equal(w.stores.has('heymi-pocket-beta-1.0.1'), false);
  assert.equal(w.stores.has('another-app'), true);
  w.setNetwork(async () => { throw new TypeError('offline'); });
  assert.equal((await w.fetch('./', { mode: 'navigate' })).body, 'public shell');
});

test('storage quota failure preserves successful network responses', async () => {
  const w = worker();
  w.failWrites();
  assert.equal((await w.fetch('./', { mode: 'navigate' })).body, 'public shell');
});
