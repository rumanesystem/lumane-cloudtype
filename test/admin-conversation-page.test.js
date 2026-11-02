const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseConversationPage,
  mergeConversationPage,
  fetchConversationPage,
  MAX_PAGE,
} = require('../lib/admin-conversation-page');

const rows = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: to - i }));

// supabase 흉내: id 내림차순 · range · in · count · 한 번에 최대 1000줄 (PostgREST max-rows)
function fakeSupabase(tables, maxRows = 1000) {
  const calls = [];
  return {
    calls,
    from(table) {
      const all = [...(tables[table] || [])].sort((a, b) => b.id - a.id);
      const q = { cols: '*', count: false, start: 0, end: Infinity, ids: null };
      const run = () => {
        calls.push({ table, ...q });
        let data = q.ids ? all.filter(r => q.ids.includes(r.id)) : all.slice(q.start, q.end + 1);
        data = data.slice(0, maxRows).map(r => (q.cols === 'id' ? { id: r.id } : { ...r }));
        return Promise.resolve({ data, error: null, count: q.count ? all.length : null });
      };
      const chain = {
        select(cols, opts) { q.cols = cols; q.count = !!(opts && opts.count); return chain; },
        is() { return chain; },
        order() { return chain; },
        range(s, e) { q.start = s; q.end = e; return run(); },
        in(_col, ids) { q.ids = ids; return run(); },
      };
      return chain;
    },
  };
}

test('without page the list keeps the old newest-200 behaviour', () => {
  assert.equal(parseConversationPage({}), null);
  const merged = mergeConversationPage(rows(1, 250), [], null);
  assert.equal(merged.length, 200);
  assert.equal(merged[0].id, 250);
});

test('page and pageSize are parsed and clamped, huge pages are capped', () => {
  assert.deepEqual(parseConversationPage({ page: '3', pageSize: '30' }), { page: 3, size: 30 });
  assert.deepEqual(parseConversationPage({ page: '0' }), { page: 1, size: 30 });
  assert.deepEqual(parseConversationPage({ page: 'abc', pageSize: '9999' }), { page: 1, size: 100 });
  assert.equal(parseConversationPage({ page: '999999999' }).page, MAX_PAGE);
  assert.equal(parseConversationPage({ page: '9'.repeat(400) }).page, 1);
});

test('page 2 of 30 returns the 31st-60th newest across both tables', async () => {
  const db = fakeSupabase({ conversations: rows(1, 50), test_conversations: rows(51, 75) });
  const { conversations, total } = await fetchConversationPage(db, { page: 2, size: 30 });
  assert.equal(total, 75);
  assert.equal(conversations.length, 30);
  assert.equal(conversations[0].id, 45);
  assert.equal(conversations[29].id, 16);
});

test('pages past the 1000-row DB limit are still complete', async () => {
  const db = fakeSupabase({ conversations: rows(1, 1100), test_conversations: [] });
  const p34 = await fetchConversationPage(db, { page: 34, size: 30 });
  const p37 = await fetchConversationPage(db, { page: 37, size: 30 });
  assert.equal(p34.conversations.length, 30);
  assert.equal(p34.conversations[0].id, 1100 - 33 * 30);
  assert.equal(p37.conversations.length, 20);
  assert.equal(p37.total, 1100);
});

test('only the chosen page rows are loaded with full content', async () => {
  const db = fakeSupabase({ conversations: rows(1, 90), test_conversations: [] });
  await fetchConversationPage(db, { page: 3, size: 30 });
  const fullCalls = db.calls.filter(c => c.cols === '*');
  assert.equal(fullCalls.length, 1);
  assert.equal(fullCalls[0].ids.length, 30);
});
