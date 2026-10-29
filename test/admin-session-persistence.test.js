'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { AdminSessionManager, createAdminAuth } = require('../lib/admin-auth');
const { createSessionStoreFromEnv } = require('../lib/admin-session-store');
const { createSessionSync } = require('../lib/admin-session-sync');

const TEST_EMAIL = 'admin@example.com';
const FAKE_LOGIN = { email: TEST_EMAIL, password: 'x'.repeat(8) };
const FOUR_HUNDRED_DAYS_S = 400 * 24 * 60 * 60;

const adminProvider = async credentials => ({
  data: {
    user: { email: credentials.email, app_metadata: { role: 'admin' } },
    session: {},
  },
  error: null,
});

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async load(hash) { return rows.has(hash) ? structuredClone(rows.get(hash)) : null; },
    async insert(hash, value) { rows.set(hash, structuredClone(value)); },
    async updateCsrf(hash, csrfHashes) {
      if (!rows.has(hash)) return false;
      rows.get(hash).csrfHashes = [...csrfHashes];
      return true;
    },
    async remove(hash) { rows.delete(hash); },
  };
}

async function startServer(t, auth) {
  const app = express();
  app.use(express.json());
  app.post('/api/admin-auth/login', auth.login);
  app.get('/api/admin-auth/session', auth.currentSession);
  app.post('/api/admin-auth/logout', auth.requireAdmin, auth.logout);
  app.post('/api/admin/mutation', auth.requireAdmin, (_req, res) => res.status(204).end());
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function setCookieFor(response, name) {
  const all = response.headers.get('set-cookie') || '';
  const start = all.indexOf(`${name}=`);
  if (start < 0) return '';
  const remainder = all.slice(start);
  const nextCookie = remainder.slice(1).search(/,\s*[A-Za-z0-9_]+=/);
  return nextCookie < 0 ? remainder : remainder.slice(0, nextCookie + 1);
}

async function login(origin) {
  const response = await fetch(`${origin}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(FAKE_LOGIN),
  });
  return {
    response,
    cookie: setCookieFor(response, 'lumane_admin_session').split(';', 1)[0],
    csrf: setCookieFor(response, 'lumane_admin_csrf').split(';', 1)[0].split('=', 2)[1],
  };
}

test('default sessions never expire on their own', () => {
  let now = 1_000;
  const manager = new AdminSessionManager({ now: () => now });
  const created = manager.create(TEST_EMAIL);
  assert.equal(created.expiresAt, null);
  now += 10 * 365 * 24 * 60 * 60 * 1000;
  assert.ok(manager.authenticate(created.token));
});

test('login cookies use the 400-day browser maximum', async (t) => {
  const origin = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: null }));
  const { response } = await login(origin);
  assert.equal(response.status, 200);
  assert.match(setCookieFor(response, 'lumane_admin_session'), new RegExp(`Max-Age=${FOUR_HUNDRED_DAYS_S}`));
  assert.match(setCookieFor(response, 'lumane_admin_csrf'), new RegExp(`Max-Age=${FOUR_HUNDRED_DAYS_S}`));
});

test('store keeps only hashes, never the raw session or CSRF value', async (t) => {
  const store = memoryStore();
  const origin = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: store }));
  const { cookie, csrf } = await login(origin);
  const raw = cookie.split('=', 2)[1];
  assert.equal(store.rows.size, 1);
  const [[key, row]] = store.rows;
  assert.match(key, /^[0-9a-f]{64}$/);
  const serialized = JSON.stringify([key, row]);
  assert.equal(serialized.includes(raw), false);
  assert.equal(serialized.includes(csrf), false);
});

test('login survives a server restart (new memory, same store) including CSRF', async (t) => {
  const store = memoryStore();
  const first = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: store }));
  const { cookie, csrf } = await login(first);

  const restarted = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: store }));
  const session = await fetch(`${restarted}/api/admin-auth/session`, { headers: { cookie } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).email, TEST_EMAIL);

  const mutation = await fetch(`${restarted}/api/admin/mutation`, {
    method: 'POST',
    headers: { cookie, origin: restarted, 'x-csrf-token': csrf },
  });
  assert.equal(mutation.status, 204);
});

test('session check re-issues the session cookie so the 400-day limit slides', async (t) => {
  const origin = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: memoryStore() }));
  const { cookie } = await login(origin);
  const check = await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie } });
  assert.equal(check.status, 200);
  const reissued = setCookieFor(check, 'lumane_admin_session');
  assert.equal(reissued.split(';', 1)[0], cookie);
  assert.match(reissued, new RegExp(`Max-Age=${FOUR_HUNDRED_DAYS_S}`));
  assert.match(reissued, /HttpOnly/i);
});

test('logout removes the stored session so a restart does not revive it', async (t) => {
  const store = memoryStore();
  const origin = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: store }));
  const { cookie, csrf } = await login(origin);
  const logout = await fetch(`${origin}/api/admin-auth/logout`, {
    method: 'POST',
    headers: { cookie, origin, 'x-csrf-token': csrf },
  });
  assert.equal(logout.status, 204);
  assert.equal(store.rows.size, 0);

  const restarted = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: store }));
  const session = await fetch(`${restarted}/api/admin-auth/session`, { headers: { cookie } });
  assert.equal(session.status, 401);
});

test('logout during a DB outage still refuses that device and deletes the row once the DB is back', async (t) => {
  const store = memoryStore();
  let down = false;
  const flaky = { ...store, async remove(hash) { if (down) throw new Error('db down'); return store.remove(hash); } };
  t.mock.method(console, 'warn', () => {});
  // 장애 중에도 다시 지우기가 시도되므로, 복구 직후 바로 다시 시도되도록 간격을 0 으로 둔다.
  const origin = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: flaky, retryCooldownMs: 0 }));
  const loggedOut = await login(origin);
  const other = await login(origin);
  assert.equal(store.rows.size, 2);

  down = true;
  const logout = await fetch(`${origin}/api/admin-auth/logout`, {
    method: 'POST',
    headers: { cookie: loggedOut.cookie, origin, 'x-csrf-token': loggedOut.csrf },
  });
  assert.equal(logout.status, 204);
  assert.equal(store.rows.size, 2, 'row survives because the delete failed');
  const refused = await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie: loggedOut.cookie } });
  assert.equal(refused.status, 401, 'logged-out device is refused even though its row still exists');

  down = false;
  const otherCheck = await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie: other.cookie } });
  assert.equal(otherCheck.status, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.rows.size, 1, 'the pending delete is retried once the DB is back');
});

test('a stuck (never answering) delete times out: logout and requests never hang, retries recover', async (t) => {
  const store = memoryStore();
  let hang = true;
  const stuck = { ...store, async remove(hash) { return hang ? new Promise(() => {}) : store.remove(hash); } };
  t.mock.method(console, 'warn', () => {});
  const origin = await startServer(t, createAdminAuth({
    signInWithPassword: adminProvider, sessionStore: stuck, storeTimeoutMs: 50, retryCooldownMs: 0,
  }));
  const loggedOut = await login(origin);
  const other = await login(origin);

  let started = Date.now();
  const logout = await fetch(`${origin}/api/admin-auth/logout`, {
    method: 'POST',
    headers: { cookie: loggedOut.cookie, origin, 'x-csrf-token': loggedOut.csrf },
  });
  assert.equal(logout.status, 204);
  assert.ok(Date.now() - started < 2_000, 'logout must not hang on a stuck delete');
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie: loggedOut.cookie } })).status, 401);

  started = Date.now();
  const check = await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie: other.cookie } });
  assert.equal(check.status, 200);
  assert.ok(Date.now() - started < 2_000, 'request must not wait for the pending delete');

  hang = false;
  await new Promise(resolve => setTimeout(resolve, 150)); // the stuck retry times out
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie: other.cookie } })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(store.rows.size, 1, 'retries resume after the stuck attempt times out');
});

test('a fully hung DB never hangs login or session checks', async (t) => {
  const store = memoryStore();
  let hang = false;
  const never = () => new Promise(() => {});
  const hung = {
    async load(hash) { return hang ? never() : store.load(hash); },
    async insert(hash, value) { return hang ? never() : store.insert(hash, value); },
    async updateCsrf(hash, hashes) { return hang ? never() : store.updateCsrf(hash, hashes); },
    async remove(hash) { return hang ? never() : store.remove(hash); },
  };
  t.mock.method(console, 'warn', () => {});
  const origin = await startServer(t, createAdminAuth({
    signInWithPassword: adminProvider, sessionStore: hung, storeTimeoutMs: 50, recheckMs: 0,
  }));
  const loggedIn = await login(origin);
  hang = true;

  let started = Date.now();
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie: loggedIn.cookie } })).status, 200);
  assert.ok(Date.now() - started < 2_000, 'session check of a logged-in device must not hang');

  started = Date.now();
  const { response } = await login(origin);
  assert.equal(response.status, 503);
  assert.ok(Date.now() - started < 2_000, 'login must not hang');
});

test('a failed DB re-check is read only once per session check, not again inside the same request', async (t) => {
  const store = memoryStore();
  let loads = 0;
  let failLoad = false;
  const counting = {
    ...store,
    async load(hash) { loads++; if (failLoad) throw new Error('db down'); return store.load(hash); },
  };
  t.mock.method(console, 'warn', () => {});
  const origin = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: counting, recheckMs: 200 }));
  const { cookie } = await login(origin);
  await new Promise(resolve => setTimeout(resolve, 250)); // the re-check is now due
  failLoad = true;
  loads = 0;
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie } })).status, 200);
  assert.equal(loads, 1, 'second resolveSession in the same request must not read the DB again');
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie } })).status, 200);
  assert.equal(loads, 1, 'during the outage the next request also skips the read until the re-check is due again');
});

test('a row deleted in the database logs that device out after restart', async (t) => {
  const store = memoryStore();
  const first = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: store }));
  const { cookie } = await login(first);
  store.rows.clear();
  const restarted = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: store }));
  const session = await fetch(`${restarted}/api/admin-auth/session`, { headers: { cookie } });
  assert.equal(session.status, 401);
});

test('a row deleted in the database logs that device out without a restart', async (t) => {
  const store = memoryStore();
  const origin = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: store, recheckMs: 0 }));
  const { cookie } = await login(origin);
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie } })).status, 200);
  store.rows.clear();
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie } })).status, 401);
});

test('a deleted row logs out an actively polling device even with the default 5-minute recheck', async (t) => {
  const store = memoryStore();
  const origin = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: store }));
  const { cookie } = await login(origin);
  for (let i = 0; i < 3; i++) {
    assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie } })).status, 200);
  }
  store.rows.clear();
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie } })).status, 401);
  assert.equal(store.rows.size, 0, 'the deleted row must not be recreated');
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie } })).status, 401);
});

test('login is refused (503) when the session cannot be stored, leaving no session behind', async (t) => {
  const store = memoryStore();
  const auth = createAdminAuth({
    signInWithPassword: adminProvider,
    sessionStore: { ...store, async insert() { throw new Error('db down'); } },
  });
  t.mock.method(console, 'warn', () => {});
  const origin = await startServer(t, auth);
  const { response, cookie } = await login(origin);
  assert.equal(response.status, 503);
  assert.equal(cookie, '');
  assert.equal(auth.sessionManager.sessions.size, 0);
});

test('before the SQL is run (table missing) login falls back to memory-only', async (t) => {
  const missing = Object.assign(new Error('relation "lumane.admin_sessions" does not exist'), { code: '42P01' });
  const auth = createAdminAuth({
    signInWithPassword: adminProvider,
    sessionStore: {
      async load() { throw missing; },
      async insert() { throw missing; },
      async updateCsrf() { throw missing; },
      async remove() { throw missing; },
    },
  });
  t.mock.method(console, 'warn', () => {});
  const origin = await startServer(t, auth);
  const { response, cookie } = await login(origin);
  assert.equal(response.status, 200);
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie } })).status, 200);
});

test('store read failures never crash: unknown device is 401, logged-in device keeps working', async (t) => {
  const store = memoryStore();
  let down = false;
  const sometimesDown = {
    ...store,
    async load(hash) { if (down) throw new Error('db down'); return store.load(hash); },
    async updateCsrf(hash, hashes) { if (down) throw new Error('db down'); return store.updateCsrf(hash, hashes); },
  };
  t.mock.method(console, 'warn', () => {});
  const origin = await startServer(t, createAdminAuth({ signInWithPassword: adminProvider, sessionStore: sometimesDown, recheckMs: 0 }));
  const { cookie } = await login(origin);
  down = true;
  const unknown = await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie: 'lumane_admin_session=unknown' } });
  assert.equal(unknown.status, 401);
  assert.equal((await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie } })).status, 200);
});

test('restore rejects malformed stored rows', () => {
  const manager = new AdminSessionManager();
  const goodHash = 'a'.repeat(64);
  assert.equal(manager.restore('not-hex', { email: TEST_EMAIL, csrfHashes: [goodHash], createdAt: 1 }), false);
  assert.equal(manager.restore(goodHash, { email: '', csrfHashes: [goodHash], createdAt: 1 }), false);
  assert.equal(manager.restore(goodHash, { email: TEST_EMAIL, csrfHashes: ['bad'], createdAt: 1 }), false);
  assert.equal(manager.restore(goodHash, { email: TEST_EMAIL, csrfHashes: [goodHash], createdAt: NaN }), false);
  assert.equal(manager.sessions.size, 0);
});

test('without Supabase environment variables no store is created', () => {
  assert.equal(createSessionStoreFromEnv({}), null);
  assert.equal(createSessionStoreFromEnv({ SUPABASE_URL: 'http://x' }), null);
});

// 저장소 읽기를 손으로 끝내는 가짜 저장소 · 동시에 일어나는 요청 순서를 재현하려고 쓴다.
function gatedStore(store) {
  const gates = [];
  return {
    ...store,
    gates,
    async load(hash) {
      const row = await store.load(hash);
      return new Promise(resolve => gates.push(() => resolve(row)));
    },
    // 읽기가 실제로 대기열에 들어올 때까지 기다린 뒤 하나를 끝낸다.
    async release() {
      while (gates.length === 0) await new Promise(resolve => setImmediate(resolve));
      gates.shift()();
    },
  };
}

async function seedSession(store) {
  const seed = new AdminSessionManager();
  const created = seed.create(TEST_EMAIL);
  await store.insert(created.tokenHash, seed.snapshot(created.tokenHash));
  return created;
}

test('logout during an in-flight DB read never lets that read revive the session', async () => {
  const store = memoryStore();
  const gated = gatedStore(store);
  const created = await seedSession(store);
  const manager = new AdminSessionManager(); // fresh memory = just restarted
  const sync = createSessionSync({ sessionManager: manager, sessionStore: gated });

  const pending = sync.resolveSession(created.token); // reads the still-existing row
  await sync.forget(created.tokenHash);               // logout deletes the row meanwhile
  await gated.release();                              // the old read now returns the stale row
  assert.equal(await pending, null);
  assert.equal(manager.sessions.size, 0, 'the stale row must not be restored into memory');
  assert.equal(await sync.resolveSession(created.token), null);
});

test('two concurrent restores keep the CSRF value issued by the first one', async () => {
  const store = memoryStore();
  const gated = gatedStore(store);
  const created = await seedSession(store);
  const manager = new AdminSessionManager();
  const sync = createSessionSync({ sessionManager: manager, sessionStore: gated });

  const first = sync.resolveSession(created.token);
  const second = sync.resolveSession(created.token);
  await gated.release();
  assert.ok(await first);
  const fresh = manager.rotateCsrf(created.token); // the first request issued a new CSRF value
  await gated.release();                           // the slower read lands afterwards
  assert.ok(await second);
  assert.equal(manager.verifyCsrf(created.token, fresh), true, 'fresh CSRF must survive the late restore');
});

test('the logged-out device\'s own requests also trigger the pending delete retry', async (t) => {
  const store = memoryStore();
  let down = true;
  const flaky = { ...store, async remove(hash) { if (down) throw new Error('db down'); return store.remove(hash); } };
  t.mock.method(console, 'warn', () => {});
  const created = await seedSession(store);
  const manager = new AdminSessionManager();
  const sync = createSessionSync({ sessionManager: manager, sessionStore: flaky, retryCooldownMs: 0 });

  await sync.forget(created.tokenHash);
  assert.equal(store.rows.size, 1, 'delete failed during the outage');
  down = false;
  assert.equal(await sync.resolveSession(created.token), null, 'still refused');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.rows.size, 0, 'the retry ran from the logged-out device\'s own request');
});
