'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { rateLimit } = require('express-rate-limit');
const { rateLimitKey } = require('../lib/security-boundaries');
const {
  AdminSessionManager,
  createAdminAuth,
  createAdminPageHandler,
} = require('../lib/admin-auth');

const TEST_EMAIL = 'admin@example.com';

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function createFixture(t, provider) {
  const auth = createAdminAuth({ signInWithPassword: provider });
  const app = express();
  app.use(express.json());
  app.post('/api/admin-auth/login', auth.login);
  app.get('/api/admin-auth/session', auth.currentSession);
  app.post('/api/admin-auth/logout', auth.requireAdmin, auth.logout);
  app.post('/api/admin/mutation', auth.requireAdmin, (_req, res) => res.status(204).end());
  const pageGate = createAdminPageHandler({ adminAuth: auth, rootDir: path.resolve(__dirname, '..') });
  app.get('/admin', pageGate);
  app.get('/admin.html', pageGate);
  const server = await listen(app);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  return { auth, origin: `http://127.0.0.1:${port}` };
}

function setCookieFor(response, name) {
  const all = response.headers.get('set-cookie') || '';
  const start = all.indexOf(`${name}=`);
  if (start < 0) return '';
  const remainder = all.slice(start);
  const nextCookie = remainder.slice(1).search(/,\s*[A-Za-z0-9_]+=/);
  return nextCookie < 0 ? remainder : remainder.slice(0, nextCookie + 1);
}

function cookieFrom(response) {
  return setCookieFor(response, 'lumane_admin_session').split(';', 1)[0];
}

function csrfFrom(response) {
  return setCookieFor(response, 'lumane_admin_csrf').split(';', 1)[0].split('=', 2)[1];
}

async function successfulLogin(origin) {
  const response = await fetch(`${origin}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: 'correct horse battery staple' }),
  });
  return { response, body: await response.json(), cookie: cookieFrom(response) };
}

test('session manager stores only hashed bearer and CSRF secrets', () => {
  const manager = new AdminSessionManager();
  const created = manager.create(TEST_EMAIL);
  const [[storedKey, storedSession]] = manager.sessions;

  assert.notEqual(storedKey, created.token);
  assert.equal(storedKey.length, 64);
  assert.equal(Object.hasOwn(storedSession, 'token'), false);
  assert.equal(Object.hasOwn(storedSession, 'csrfToken'), false);
  assert.equal(manager.verifyCsrf(created.token, created.csrfToken), true);
  assert.equal(manager.verifyCsrf(created.token, 'wrong'), false);
});

test('idle and absolute expiration are enforced independently', () => {
  let now = 1_000;
  const idle = new AdminSessionManager({
    idleTtlMs: 100,
    absoluteTtlMs: 1_000,
    now: () => now,
  });
  const idleSession = idle.create(TEST_EMAIL);
  now = 1_099;
  assert.ok(idle.authenticate(idleSession.token));
  now = 1_199;
  assert.equal(idle.authenticate(idleSession.token), null);

  now = 5_000;
  const absolute = new AdminSessionManager({
    idleTtlMs: 10_000,
    absoluteTtlMs: 500,
    now: () => now,
  });
  const absoluteSession = absolute.create(TEST_EMAIL);
  now = 5_499;
  assert.ok(absolute.authenticate(absoluteSession.token));
  now = 5_500;
  assert.equal(absolute.authenticate(absoluteSession.token), null);
});

test('two devices receive isolated sessions and logout revokes only one', () => {
  const manager = new AdminSessionManager();
  const first = manager.create(TEST_EMAIL);
  const second = manager.create(TEST_EMAIL);

  assert.notEqual(first.token, second.token);
  assert.ok(manager.authenticate(first.token));
  assert.ok(manager.authenticate(second.token));
  manager.destroy(first.token);
  assert.equal(manager.authenticate(first.token), null);
  assert.ok(manager.authenticate(second.token));
});

test('maximum session bound evicts the oldest device session', () => {
  let now = 0;
  let sequence = 0;
  const manager = new AdminSessionManager({
    maxSessions: 2,
    now: () => now++,
    tokenFactory: () => `token-${++sequence}`,
  });
  const first = manager.create(TEST_EMAIL);
  const second = manager.create(TEST_EMAIL);
  const third = manager.create(TEST_EMAIL);

  assert.equal(manager.sessions.size, 2);
  assert.equal(manager.authenticate(first.token), null);
  assert.ok(manager.authenticate(second.token));
  assert.ok(manager.authenticate(third.token));
});

test('successful provider login sets strict secure HttpOnly cookie and returns current session', async (t) => {
  const calls = [];
  const { origin } = await createFixture(t, async credentials => {
    calls.push(credentials);
    return {
      data: {
        user: { email: TEST_EMAIL, app_metadata: { role: ' admin ' } },
        session: { access_token: 'provider-token-not-forwarded' },
      },
      error: null,
    };
  });
  const login = await successfulLogin(origin);

  assert.equal(login.response.status, 200);
  assert.deepEqual(calls, [{ email: TEST_EMAIL, password: 'correct horse battery staple' }]);
  const setCookie = login.response.headers.get('set-cookie');
  const sessionCookie = setCookieFor(login.response, 'lumane_admin_session');
  const csrfCookie = setCookieFor(login.response, 'lumane_admin_csrf');
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /Secure/i);
  assert.match(sessionCookie, /SameSite=Strict/i);
  assert.doesNotMatch(csrfCookie, /HttpOnly/i);
  assert.match(csrfCookie, /Secure/i);
  assert.match(csrfCookie, /SameSite=Strict/i);
  assert.doesNotMatch(JSON.stringify(login.body), /provider-token-not-forwarded/);
  assert.doesNotMatch(JSON.stringify(login.body), /csrf/i);

  const current = await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie: login.cookie } });
  assert.equal(current.status, 200);
  const body = await current.json();
  assert.equal(body.email, TEST_EMAIL);
  assert.ok(csrfFrom(current));
});

test('operator role receives the same administrator session access', async (t) => {
  const operatorEmail = 'operator@example.com';
  const { origin } = await createFixture(t, async credentials => ({
    data: {
      user: { email: credentials.email, app_metadata: { role: 'OPERATOR' } },
      session: { access_token: 'discarded' },
    },
    error: null,
  }));

  const login = await fetch(`${origin}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: operatorEmail, password: 'valid password' }),
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).email, operatorEmail);
  assert.ok(cookieFrom(login));
});

test('missing or unrelated app metadata roles and invalid credentials use generic 401', async (t) => {
  let providerCalls = 0;
  const { origin } = await createFixture(t, async credentials => {
    providerCalls++;
    if (credentials.email === 'missing-role@example.com') {
      return {
        data: {
          user: {
            email: credentials.email,
            role: 'authenticated',
            user_metadata: { role: 'admin' },
            app_metadata: {},
          },
          session: { access_token: 'discarded' },
        },
        error: null,
      };
    }
    if (credentials.email === 'other-role@example.com') {
      return {
        data: {
          user: { email: credentials.email, app_metadata: { role: 'viewer' } },
          session: { access_token: 'discarded' },
        },
        error: null,
      };
    }
    return { data: { user: null, session: null }, error: new Error('invalid credentials') };
  });

  const responses = await Promise.all([
    ['missing-role@example.com', 'valid'],
    ['other-role@example.com', 'valid'],
    [TEST_EMAIL, 'wrong'],
  ].map(([email, password]) => fetch(`${origin}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })));

  assert.deepEqual(responses.map(response => response.status), [401, 401, 401]);
  const bodies = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(bodies[1], bodies[2]);
  assert.equal(providerCalls, 3);
});

test('Authorization bearer values never grant administrator access', async (t) => {
  const auth = createAdminAuth({
    signInWithPassword: async () => ({ data: null, error: new Error('unused') }),
    // Deprecated caller options must not be able to restore the removed bypass.
    legacyToken: 'formerly-valid-token',
    allowLegacyToken: true,
  });
  const app = express();
  app.post('/api/admin/mutation', auth.requireAdmin, (_req, res) => res.status(204).end());
  const server = await listen(app);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  for (const authorization of ['Bearer formerly-valid-token', 'Bearer anything', 'Basic abc']) {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/mutation`, {
      method: 'POST',
      headers: { authorization },
    });
    assert.equal(response.status, 401);
  }
});

test('stale administrator API failures do not consume the login limiter', async (t) => {
  const auth = createAdminAuth({
    signInWithPassword: async credentials => ({
      data: {
        user: { email: credentials.email, app_metadata: { role: 'admin' } },
        session: { access_token: 'discarded' },
      },
      error: null,
    }),
  });
  const loginLimiter = rateLimit({
    windowMs: 60_000,
    max: 2,
    keyGenerator: rateLimitKey,
    skipSuccessfulRequests: true,
    standardHeaders: false,
    legacyHeaders: false,
  });
  const app = express();
  app.use(express.json());
  app.post('/api/admin-auth/login', loginLimiter, auth.login);
  app.get('/api/admin/stale-poll', auth.requireAdmin, (_req, res) => res.status(204).end());
  const server = await listen(app);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 20; attempt++) {
    const stale = await fetch(`${origin}/api/admin/stale-poll`);
    assert.equal(stale.status, 401);
  }

  const login = await successfulLogin(origin);
  assert.equal(login.response.status, 200);
  assert.ok(login.cookie);
});

test('session mutation requires same origin and CSRF; logout clears the session', async (t) => {
  const { origin } = await createFixture(t, async () => ({
    data: {
      user: { email: TEST_EMAIL, app_metadata: { role: 'admin' } },
      session: { access_token: 'discarded' },
    },
    error: null,
  }));
  const login = await successfulLogin(origin);

  const missingCsrf = await fetch(`${origin}/api/admin/mutation`, {
    method: 'POST',
    headers: { cookie: login.cookie, origin },
  });
  assert.equal(missingCsrf.status, 403);

  const mutation = await fetch(`${origin}/api/admin/mutation`, {
    method: 'POST',
    headers: { cookie: login.cookie, origin, 'x-csrf-token': csrfFrom(login.response) },
  });
  assert.equal(mutation.status, 204);

  const logout = await fetch(`${origin}/api/admin-auth/logout`, {
    method: 'POST',
    headers: { cookie: login.cookie, origin, 'x-csrf-token': csrfFrom(login.response) },
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i);

  const current = await fetch(`${origin}/api/admin-auth/session`, { headers: { cookie: login.cookie } });
  assert.equal(current.status, 401);
});

test('admin HTML is gated and refreshes a strict secure CSRF cookie', async (t) => {
  const { origin } = await createFixture(t, async () => ({
    data: {
      user: { email: TEST_EMAIL, app_metadata: { role: 'admin' } },
      session: { access_token: 'discarded' },
    },
    error: null,
  }));

  const anonymous = await fetch(`${origin}/admin`);
  assert.equal(anonymous.status, 200);
  assert.match(await anonymous.text(), /id="adminLoginForm"/);

  const login = await successfulLogin(origin);
  const authenticated = await fetch(`${origin}/admin`, { headers: { cookie: login.cookie } });
  assert.equal(authenticated.status, 200);
  assert.match(await authenticated.text(), /js\/admin-config\.js/);
  const csrfCookie = setCookieFor(authenticated, 'lumane_admin_csrf');
  assert.match(csrfCookie, /Secure/i);
  assert.match(csrfCookie, /SameSite=Strict/i);
  assert.doesNotMatch(csrfCookie, /HttpOnly/i);
});

test('browser auth bundles contain no shared bearer credential storage', () => {
  for (const relativePath of ['js/admin-config.js', 'preview_site/js/admin-config.js', 'js/admin-login.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
    assert.doesNotMatch(source, /ADMIN_TOKEN|sessionStorage|localStorage|Authorization/);
    assert.doesNotMatch(source, /prompt\(['"]관리자 인증 토큰/);
  }

  const config = fs.readFileSync(path.resolve(__dirname, '..', 'js/admin-config.js'), 'utf8');
  const admin = fs.readFileSync(path.resolve(__dirname, '..', 'js/admin.js'), 'utf8');
  const login = fs.readFileSync(path.resolve(__dirname, '..', 'js/admin-login.js'), 'utf8');
  assert.match(config, /X-CSRF-Token/);
  assert.match(config, /api\/admin-auth\/logout/);
  assert.match(admin, /60 \* 1000/);
  assert.match(admin, /window\.location\.hash\.slice\(1\)/);
  assert.match(login, /pathname\.startsWith\('\/admin-react'\)/);
});

test('administrator initialization stops when the initial session check fails', () => {
  const root = path.resolve(__dirname, '..');
  const config = fs.readFileSync(path.join(root, 'js/admin-config.js'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'js/admin-dashboard.js'), 'utf8');

  assert.match(config, /if \(response\.ok\) return true;/);
  assert.match(config, /if \(response\.status === 401\) redirectToAdminLogin\(\);/);
  assert.match(config, /function stopAdminActivity\(\)/);
  assert.match(admin, /const authenticated = await verifyAdminSession\(\);\s*if \(!authenticated\) return;\s*\n\s*await checkServer\(\);/);
  assert.match(admin, /adminSessionTimer = setInterval\(verifyAdminSession, 60 \* 1000\)/);
  assert.doesNotMatch(dashboard, /DOMContentLoaded[^\n]*prewarmSourceStats/);
});

test('React administrator route preserves the existing authenticated page boundary', () => {
  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /createAdminPageHandler\(\{ adminAuth, rootDir: __dirname, adminFile: 'dist\/admin\/index\.html' \}\)/);
  assert.match(server, /app\.get\('\/admin-react', _serveReactAdminPage\)/);
  assert.match(server, /app\.use\('\/admin-react\/assets', express\.static/);
});
