'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('first protected API 401 clears known pollers and redirects exactly once', async () => {
  const cleared = [];
  const redirects = [];
  let networkCalls = 0;
  const context = vm.createContext({
    AbortSignal,
    Response,
    URL,
    SERVER: '',
    clearInterval: timer => cleared.push(timer),
    console,
    document: {
      cookie: '',
      addEventListener() {},
      getElementById() { return null; },
    },
    fetch: async () => {
      networkCalls++;
      return new Response(null, { status: 401 });
    },
    setTimeout,
    window: {
      location: {
        origin: 'https://admin.example',
        replace: url => redirects.push(url),
      },
    },
  });
  vm.runInContext(read('js/admin-config.js'), context, { filename: 'js/admin-config.js' });
  vm.runInContext(`
    livePollTimer = 'live';
    liveMsgPollTimer = 'message';
    bgPollTimer = 'background';
    historyBgPollTimer = 'history';
    convPollTimer = 'conversation';
    adminHealthTimer = 'health';
    adminSessionTimer = 'session';
    adminUpdateTimer = 'update';
  `, context);

  const first = await context.window.adminFetch('/api/admin/sessions');
  const second = await context.window.adminFetch('/api/quotes');

  assert.equal(first.status, 401);
  assert.equal(second.status, 401);
  assert.equal(networkCalls, 1, 'requests after auth loss must not reach the network');
  assert.deepEqual(redirects, ['/admin']);
  assert.deepEqual(new Set(cleared), new Set([
    'live', 'message', 'background', 'history', 'conversation', 'health', 'session', 'update',
  ]));
});

test('live selection does not schedule a message poller after its load receives 401', async () => {
  let authActive = true;
  const intervals = [];
  const context = vm.createContext({
    URL,
    SERVER: '',
    clearInterval() {},
    console,
    document: { hidden: false, getElementById() { return null; } },
    adminFetch: async () => {
      authActive = false;
      return new Response(null, { status: 401 });
    },
    adminHeaders: () => ({}),
    isAdminAuthActive: () => authActive,
    liveAdminMode: false,
    liveMsgPollTimer: null,
    liveSelectedId: null,
    markSessionSeen() {},
    requestAnimationFrame() { throw new Error('must not render after auth loss'); },
    serverOnline: true,
    setInterval: callback => {
      intervals.push(callback);
      return intervals.length;
    },
    setLiveSelectedByClick() {},
    setSelectedSavedConvId() {},
    window: { innerWidth: 1024 },
  });
  vm.runInContext(read('js/admin-live-messages.js'), context, { filename: 'js/admin-live-messages.js' });

  await vm.runInContext(`selectLiveSession('session-1')`, context);

  assert.equal(intervals.length, 0);
  assert.equal(vm.runInContext('liveMsgPollTimer', context), null);
});

test('admin page protected API callsites use the shared fetch boundary', () => {
  const adminFiles = fs.readdirSync(path.join(ROOT, 'js'))
    .filter(name => /^admin.*\.js$/.test(name) && name !== 'admin-login.js');
  const rawProtectedFetch = /\bfetch\s*\(\s*(?:`[^`]*\/api\/(?:admin\/|quotes)|['"][^'"]*\/api\/(?:admin\/|quotes))/;

  for (const name of adminFiles) {
    const source = read(`js/${name}`);
    assert.doesNotMatch(source, rawProtectedFetch, `${name} bypasses adminFetch`);
  }
  assert.match(read('js/admin-config.js'), /async function adminFetch\(input, init\)/);
  assert.match(read('js/admin.js'), /fetch\(`\$\{SERVER\}\/api\/(?:health|version)/);
  assert.match(read('js/admin-mode.js'), /fetch\(`\$\{SERVER\}\/api\/upload/);
});
