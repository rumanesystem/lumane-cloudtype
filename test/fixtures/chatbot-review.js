'use strict';

// Isolated UI -> real handler -> in-memory persistence. Never import server.js or dotenv.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function createFixture() {
  const app = express();
  app.use(express.json());
  const rows = {}, writes = [], notifications = [], modelCalls = [], requests = [];
  const db = schema => ({ from(table) {
    const key = `${schema}.${table}`;
    rows[key] ||= [];
    let filters = [], operation = 'select', payload, options;
    const query = {
      select() { return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      is(key, value) { filters.push(row => (row[key] ?? null) === value); return query; },
      gte(key, value) { filters.push(row => row[key] >= value); return query; },
      upsert(value, opts) { operation = 'upsert'; payload = value; options = opts; return query; },
      update(value) { operation = 'update'; payload = value; return query; },
      maybeSingle() { return query.then(result => ({ ...result, data: result.data[0] || null })); },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (operation === 'upsert') {
            for (const item of [].concat(payload)) {
              const keys = options.onConflict.split(',');
              const old = rows[key].find(row => keys.every(k => row[k] === item[k]));
              if (old) Object.assign(old, clone(item));
              else rows[key].push(clone(item));
            }
          } else if (operation === 'update') {
            rows[key].filter(row => filters.every(fn => fn(row))).forEach(row => Object.assign(row, clone(payload)));
          }
          if (operation !== 'select') writes.push({ schema, table, operation, payload: clone(payload) });
          return { data: clone(rows[key].filter(row => filters.every(fn => fn(row)))), error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  } });
  const context = vm.createContext({
    ...require('../../lib/product-quote'),
    ...require('../../lib/conversation-contract'),
    ...require('../../lib/session-recovery'),
    ...require('../../lib/optional-sync'),
    ...require('../../lib/supabase-reliability'),
    app, sessions: new Map(), sessionHydrations: new Map(),
    sessionSerializer: new (require('../../lib/session-serializer').SessionSerializer)(),
    MAX_ACTIVE_SESSIONS: 100, SESSION_ID_RE: /^S-\d{13}-(?:[a-f0-9]{32}|[a-z0-9]{5})$/,
    TEMP_NAME_RE: /^\d{2}\/\d{2}\s\d{2}:\d{2}$/,
    supabase: db('public'), supabaseCustomer: db('customer'),
    chatRateLimit: (_req, _res, next) => next(),
    sessionRegisterRateLimit: (_req, _res, next) => next(),
    isSessionBlocked: () => false, customerSchemaAvailable: true,
    notifySlack: (...args) => notifications.push(args),
    isRelevantMessage: async () => true,
    buildApiMessages: async messages => messages,
    getSystemPrompt: () => 'ISOLATED FIXTURE: deterministic model double, no real model call',
    addTokenUsage: async () => {}, AI_PROVIDER: 'fixture',
    crypto: require('node:crypto'), console, setTimeout, clearTimeout,
    client: { messages: { create: async request => {
      const input = request.messages.filter(m => m.role === 'user').at(-1).content;
      modelCalls.push(clone(request));
      let text = '드레스룸 상담을 도와드리겠습니다. 궁금한 내용을 말씀해 주세요. (로컬 모의 응답)';
      if (/견적|최종|수정/.test(input)) {
        const base = /수정2/.test(input) ? 1500000 : /수정/.test(input) ? 1350000 : 1200000;
        const discounted = /신규아파트/.test(input) ? base * 0.9 : base;
        text = `가상고객 고객님\n견적서\n총 합계: ${base.toLocaleString('ko-KR')}원`;
        if (discounted !== base) text += `\n할인 후 금액: ${discounted.toLocaleString('ko-KR')}원`;
        text += '\n배송비: 30,000원 별도';
        if (/최종/.test(input)) text += `\n최종 금액: ${(discounted + 30000).toLocaleString('ko-KR')}원`;
        text += '\n(금액 비교용 로컬 모의 응답; 운영 견적 아님)';
      }
      return { content: [{ type: 'text', text }], usage: {} };
    } } },
  });
  function load(start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    if (from < 0 || to <= from) throw new Error(`Missing real server boundary: ${start}`);
    vm.runInContext(source.slice(from, to), context);
  }
  app.use((req, _res, next) => { requests.push({ method: req.method, url: req.url }); next(); });
  load('function withSerializedSession(handler)', '// 토큰 사용량');
  load('function getOrCreateSession(sessionId)', '// ── 대화 종료 시 save_reason');
  load("app.post('/api/chat',", '// ── 재방문 감지 +');
  load('async function detectReturningCustomer(sess)', '// ──');
  app.get('/api/health', (_req, res) => res.json({ ok: true, status: 'ok' }));
  app.get('/api/version', (_req, res) => res.json({ version: 'isolated-pr91' }));
  app.get('/api/session/status', (_req, res) => res.json({ mode: 'ai', pendingMsgs: [], messages: [] }));
  for (const endpoint of ['typing', 'mark-read']) app.post(`/api/session/${endpoint}`, (_req, res) => res.json({ ok: true }));
  app.post('/api/track-visit', (_req, res) => res.json({ ok: true }));
  app.get('/__fixture/state', (_req, res) => res.json({ rows, writes, notifications, modelCalls, requests }));
  app.post('/__fixture/restart', (_req, res) => { context.sessions.clear(); res.json({ ok: true }); });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not provided by isolated fixture' }));
  app.use((req, res, next) => {
    res.set('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'");
    if (req.path === '/' || req.path === '/chat.html') {
      const html = fs.readFileSync(path.join(root, 'chat.html'), 'utf8')
        .replace(/<link\b[^>]*https:\/\/[^>]*>/g, '')
        .replace(/<script\b[^>]*src="https:\/\/[^>]*><\/script>/g, '')
        .replace('<body', '<body data-fixture="isolated"')
        .replace('</body>', '<div style="position:fixed;top:0;left:0;z-index:99999;background:#ffe999;color:#222;font-size:12px">LOCAL FIXTURE · 모의 모델/저장소 · 운영 연결 없음</div></body>');
      return res.type('html').send(html);
    }
    if (req.path === '/js/config.js') return res.type('js').send(fs.readFileSync(path.join(root, 'js/config.js'), 'utf8').replace(/export const SERVER = '[^']*';/, "export const SERVER = '';"));
    if (req.path === '/js/chat.js') return res.type('js').send(fs.readFileSync(path.join(root, 'js/chat.js'), 'utf8').replace('Notification.requestPermission();', '/* Local fixture does not request desktop notification permission. */'));
    if (req.path === '/css/base.css') return res.type('css').send(fs.readFileSync(path.join(root, 'css/base.css'), 'utf8').replace(/@import url\('https:[^\n]+\n/g, ''));
    if (!/^\/(?:js|css|images|assets)\//.test(req.path)) return res.sendStatus(404);
    next();
  });
  app.use(express.static(root, { dotfiles: 'deny' }));
  return { app, context, rows, writes, notifications, modelCalls };
}

if (require.main === module) {
  createFixture().app.listen(43191, '127.0.0.1', () => console.log('Isolated PR91 fixture: http://127.0.0.1:43191/chat.html'));
}
module.exports = { createFixture };
