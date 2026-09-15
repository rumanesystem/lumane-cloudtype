'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  assertSafeExternalUrl,
  rateLimitKey,
  readTextLimited,
  validateUpload,
} = require('../lib/security-boundaries');

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

test('upload validation accepts matching image content and rejects disguised HTML', () => {
  assert.doesNotThrow(() => validateUpload({
    originalname: 'room.png',
    mimetype: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }));

  assert.throws(() => validateUpload({
    originalname: 'attack.png',
    mimetype: 'image/png',
    buffer: Buffer.from('<html><script>alert(1)</script></html>'),
  }), /content/i);
});

test('upload validation rejects extension and MIME mismatches', () => {
  assert.throws(() => validateUpload({
    originalname: 'document.pdf',
    mimetype: 'image/png',
    buffer: Buffer.from('%PDF-1.7'),
  }), /MIME/i);
});

test('external URL validation blocks credentials, unusual ports, and private addresses', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34' }];
  await assert.rejects(assertSafeExternalUrl('https://user:pass@example.com', publicLookup), /credentials/i);
  await assert.rejects(assertSafeExternalUrl('https://example.com:8080', publicLookup), /port/i);
  await assert.rejects(assertSafeExternalUrl('http://internal.example', async () => [{ address: '127.0.0.1' }]), /private/i);
  const safe = await assertSafeExternalUrl('https://example.com/path', publicLookup);
  assert.equal(safe.hostname, 'example.com');
});

test('remote text reads stop at the configured byte limit', async () => {
  const small = new Response('hello');
  assert.equal(await readTextLimited(small, 10), 'hello');
  const large = new Response('x'.repeat(20));
  await assert.rejects(readTextLimited(large, 10), /too large/i);
});

test('rate limiter groups repeated HTTP requests from the same IP', async (t) => {
  const app = express();
  app.get('/limited', rateLimit({
    windowMs: 60_000,
    max: 2,
    keyGenerator: rateLimitKey,
    standardHeaders: false,
    legacyHeaders: false,
  }), (_req, res) => res.status(204).end());

  const server = await listen(app);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/limited`;

  const statuses = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    statuses.push((await fetch(url)).status);
  }

  assert.deepEqual(statuses, [204, 204, 429]);
});

test('route wiring protects costly writes and uses narrow body limits', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /defaultJsonParser = express\.json\(\{ limit: '100kb' \}\)/);
  assert.match(server, /req\.path === '\/api\/quote' \? quoteJsonParser : defaultJsonParser/);
  assert.match(server, /app\.post\('\/api\/upload', uploadRateLimit, uploadMw\.single/);
  assert.match(server, /app\.post\('\/api\/session\/register', sessionRegisterRateLimit/);
  assert.match(server, /app\.post\('\/api\/admin-auth\/login', adminLoginRateLimit, adminAuth\.login/);
  assert.match(server, /app\.post\('\/api\/summarize', requireAdmin/);
  assert.match(server, /app\.use\('\/api\/admin', requireAdmin\)/);
  assert.match(server, /app\.use\('\/api\/quotes', requireAdmin\)/);
  assert.doesNotMatch(server, /app\.use\('\/api\/(?:admin|quotes)', [^\n]*RateLimit/);
  assert.match(server, /keyGenerator: rateLimitKey/);
  assert.doesNotMatch(server, /keyGenerator: ipKeyGenerator/);
  assert.match(server, /MAX_ACTIVE_SESSIONS = 1000/);
});

test('quote list database failures remain observable to the admin client', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = server.slice(
    server.indexOf("app.get('/api/quotes'"),
    server.indexOf("app.patch('/api/quotes/:id'"),
  );
  assert.match(route, /res\.status\(500\)\.json\(\{ error: '견적 목록을 불러오지 못했습니다\.' \}\)/);
  assert.doesNotMatch(route, /catch[\s\S]*res\.json\(\{ quotes: \[\] \}\)/);
});

test('saved conversation detail selects the test table only through an explicit query', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = server.slice(
    server.indexOf("app.get('/api/admin/conversations/:id'"),
    server.indexOf("// (삭제: /api/admin/conversations/:id/resend-notion"),
  );
  assert.match(route, /req\.query\.is_test === 'true' \? 'test_conversations' : 'conversations'/);
  assert.match(route, /supabase\s*\.from\(table\)/);
});

test('legacy administrator bearer deployment contract is removed', () => {
  const root = path.join(__dirname, '..');
  for (const relativePath of [
    'lib/admin-auth.js',
    'server.js',
    '.github/workflows/deploy-main.yml',
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(source, /ADMIN_TOKEN|ALLOW_LEGACY_ADMIN_TOKEN|legacyToken|allowLegacyToken|legacyMatches/);
  }
});

test('Notion database keeps the existing runtime target with an optional environment override', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(
    server,
    /const NOTION_DB_ID = process\.env\.NOTION_DB_ID \|\| '221b622e-5115-4d07-b1fa-ed7fa52c6895'/
  );
});

test('admin browser bundles use same-origin session and CSRF cookies', () => {
  for (const relativePath of ['js/admin-config.js', 'preview_site/js/admin-config.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    assert.doesNotMatch(source, /ADMIN_TOKEN|sessionStorage|Authorization/);
    assert.match(source, /const SERVER = ''/);
    assert.match(source, /X-CSRF-Token/);
  }
});

test('admin CDN scripts are pinned with verified subresource integrity', () => {
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(
    adminHtml,
    /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/0\.18\.5\/xlsx\.full\.min\.js" integrity="sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw" crossorigin="anonymous" referrerpolicy="no-referrer"><\/script>/
  );
  assert.match(
    adminHtml,
    /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.4\.1\/dist\/chart\.umd\.min\.js" integrity="sha384-9nhczxUqK87bcKHh20fSQcTGD4qq5GhayNYSYWqwBkINBhOfQLg\/P5HG5lF1urn4" crossorigin="anonymous" referrerpolicy="no-referrer"><\/script>/
  );
});

test('new browser sessions use cryptographic identifiers while legacy IDs remain accepted', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'js', 'chat.js'), 'utf8');
  assert.match(server, /\[a-f0-9\]\{32\}/);
  assert.match(server, /\[a-z0-9\]\{5\}/);
  assert.match(client, /crypto\.randomUUID/);
  assert.match(client, /crypto\.getRandomValues/);
});
