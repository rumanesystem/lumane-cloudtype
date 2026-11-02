const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// fetchLiveSessions 를 실제 파일에서 꺼내 1초 폴링 한 번을 흉내 낸다.
async function pollOnce({ liveSelectedId, savedConvId, sessions }) {
  const selected = [];
  const context = vm.createContext({
    String,
    SERVER: '',
    serverOnline: true,
    document: { hidden: false },
    adminHeaders: () => ({}),
    adminFetch: async () => ({ ok: true, json: async () => ({ sessions }) }),
    renderLiveSessionList() {},
    selectLiveSession: id => selected.push(id),
    liveSelectedId,
    _selectedSavedConvId: savedConvId,
  });
  const src = read('js/admin-live-sessions.js').replace(/\r\n/g, '\n');
  const fn = src.match(/async function fetchLiveSessions\(\) \{[\s\S]*?\n\}\n/)[0];
  vm.runInContext(fn, context, { filename: 'js/admin-live-sessions.js' });
  await vm.runInContext('fetchLiveSessions()', context);
  return { selected, liveSelectedId: vm.runInContext('liveSelectedId', context) };
}

test('viewing a saved conversation is not replaced by a live session on poll', async () => {
  const result = await pollOnce({
    liveSelectedId: 'ended-session',
    savedConvId: '102',
    sessions: [{ id: 'live-A' }],
  });
  assert.deepEqual(result.selected, []);
  assert.equal(result.liveSelectedId, 'ended-session');
});

test('a selected live session that ended still moves to the next live session', async () => {
  const result = await pollOnce({
    liveSelectedId: 'live-A',
    savedConvId: null,
    sessions: [{ id: 'live-B' }],
  });
  assert.deepEqual(result.selected, ['live-B']);
});

test('with nothing selected the first live session is auto-selected', async () => {
  const result = await pollOnce({ liveSelectedId: null, savedConvId: null, sessions: [{ id: 'live-B' }] });
  assert.deepEqual(result.selected, ['live-B']);
});
